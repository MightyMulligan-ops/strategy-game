import { randomBytes } from "node:crypto";
import { generateWorld } from "@strategy-game/game-engine";
import { PublicWorldSchema, ReadWorldRequestSchema, ReadWorldResponseSchema, UsernameSchema } from "@strategy-game/shared-types";
import type { PublicWorld, ReadWorldResponse } from "@strategy-game/shared-types";
import { GeneratedWorldSchema, InitialWorldArchiveSchema, WORLD_GENERATOR_VERSION } from "@strategy-game/shared-types/server";
import type { GeneratedWorld } from "@strategy-game/shared-types/server";
import type { MatchWorld, Prisma, PrismaClient } from "./generated/prisma/client.js";
import { json } from "./mappings.js";

export class WorldError extends Error {
  constructor(readonly code: "UNAUTHENTICATED" | "USERNAME_REQUIRED" | "NOT_FOUND" | "INVALID_REQUEST" | "INTERNAL_ERROR") { super(code); }
}
const MAX_BYTES = 2 * 1024 * 1024;
function bounded(value: object) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_BYTES) throw new WorldError("INTERNAL_ERROR");
}
export function makeInitialWorld(players: readonly string[]): GeneratedWorld {
  const result = generateWorld({ schemaVersion: 1, generatorVersion: WORLD_GENERATOR_VERSION,
    seed: randomBytes(4).readUInt32BE(), players, settings: { regionSide: 5 } });
  if (!result.ok) throw new WorldError("INTERNAL_ERROR");
  return result.world;
}
export async function insertInitialWorld(tx: Prisma.TransactionClient, matchId: string, world: GeneratedWorld, players: readonly string[]) {
  const parsed = GeneratedWorldSchema.parse(world);
  if (parsed.settings.regionSide !== 5 || JSON.stringify([...parsed.players].sort()) !== JSON.stringify([...players].sort())) throw new WorldError("INTERNAL_ERROR");
  bounded(parsed);
  await tx.matchWorld.create({ data: { matchId, schemaVersion: parsed.schemaVersion,
    generatorVersion: parsed.generatorVersion, seed: BigInt(parsed.seed), payload: json(parsed) } });
  return InitialWorldArchiveSchema.parse({ matchId, schemaVersion: parsed.schemaVersion, generatorVersion: parsed.generatorVersion, payload: parsed });
}
export function restoreWorldArchive(stored: MatchWorld) {
  const archive = InitialWorldArchiveSchema.parse({ matchId: stored.matchId, schemaVersion: stored.schemaVersion,
    generatorVersion: stored.generatorVersion, payload: stored.payload });
  if (stored.seed !== BigInt(archive.payload.seed) || archive.payload.settings.regionSide !== 5) throw new WorldError("INTERNAL_ERROR");
  bounded(archive.payload); return archive;
}
type Player = { playerId: string; username: string | null };
/** Allowlist projection. No seed, raw payload, generation settings or units. */
export function projectWorld(stored: MatchWorld, players: readonly Player[]): PublicWorld {
  const w = GeneratedWorldSchema.parse(stored.payload);
  if (stored.schemaVersion !== w.schemaVersion || stored.generatorVersion !== w.generatorVersion || stored.seed !== BigInt(w.seed) ||
      JSON.stringify([...w.players].sort()) !== JSON.stringify(players.map((p) => p.playerId).sort())) throw new WorldError("INTERNAL_ERROR");
  bounded(w);
  const owners = new Map(w.startingState.ownership.map((o) => [o.territoryId, o.ownerPlayerId]));
  const capitals = new Set(w.startingState.starts.map((s) => s.capitalTerritoryId));
  const cities = new Map(w.startingState.cities.map((c) => [c.territoryId, c]));
  const nodes = new Map(w.startingState.resourceNodes.map((n) => [n.territoryId, n]));
  const result = PublicWorldSchema.parse({
    visibility: "INITIAL_SHARED", bounds: { width: w.bounds.width, height: w.bounds.height },
    grid: { columns: w.grid.columns, rows: w.grid.rows },
    players: [...players].sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
      .map((p) => ({ playerId: p.playerId, username: UsernameSchema.parse(p.username) })),
    territories: w.territories.map((t) => {
      const city = cities.get(t.territoryId); const node = nodes.get(t.territoryId);
      return { territoryId: t.territoryId, row: t.row, column: t.column,
        polygon: t.polygon.map((p) => ({ x: p.x, y: p.y })), center: { x: t.center.x, y: t.center.y }, terrain: t.terrain,
        ownerPlayerId: owners.get(t.territoryId), capital: capitals.has(t.territoryId),
        city: city ? { cityId: city.cityId, kind: city.kind } : null,
        resources: node ? [{ nodeId: node.nodeId, kind: node.kind, stockpile: node.stockpile }] : [] };
    }), links: w.links.map((e) => ({ a: e.a, b: e.b }))
  });
  bounded(result); return result;
}
export class WorldRepository {
  constructor(private readonly client: PrismaClient) {}
  async getWorld(matchId: string, identityId: string): Promise<ReadWorldResponse> {
    if (!ReadWorldRequestSchema.safeParse({ schemaVersion: 1, matchId }).success) throw new WorldError("INVALID_REQUEST");
    return this.client.$transaction(async (tx) => {
      const profile = await tx.playerIdentity.findUnique({ where: { id: identityId }, select: { username: true } });
      if (!profile) throw new WorldError("UNAUTHENTICATED");
      if (!UsernameSchema.safeParse(profile.username).success) throw new WorldError("USERNAME_REQUIRED");
      // Check membership before retrieving the authoritative payload.
      const member = await tx.matchParticipant.findUnique({ where: { matchId_identityId: { matchId, identityId } }, select: { active: true } });
      if (!member?.active) throw new WorldError("NOT_FOUND");
      const match = await tx.match.findUnique({ where: { id: matchId }, include: {
        world: true, participants: { where: { active: true }, select: { playerId: true, identity: { select: { username: true } } } }
      } });
      if (!match) throw new WorldError("NOT_FOUND");
      if (match.status === "OPEN" && match.world) throw new WorldError("INTERNAL_ERROR");
      const envelope = { schemaVersion: 1, matchId };
      if (match.status === "OPEN") return ReadWorldResponseSchema.parse({ ...envelope, state: "NOT_STARTED" });
      if (!match.world) return ReadWorldResponseSchema.parse({ ...envelope, state: "UNINITIALIZED" });
      return ReadWorldResponseSchema.parse({ ...envelope, state: "READY", world: projectWorld(match.world,
        match.participants.map((p) => ({ playerId: p.playerId, username: p.identity.username }))) });
    }, { isolationLevel: "RepeatableRead" });
  }
}
