import { GameConfigSchema, ReadFormationsRequestSchema, ReadFormationViewSchema, UsernameSchema } from "@strategy-game/shared-types";
import type { ReadFormationView } from "@strategy-game/shared-types";
import type { PrismaClient } from "./generated/prisma/client.js";
import { ownResolvedFormation } from "./movement-resolution-view.js";
import { configurationRuntime, readStoredTurn } from "./turn-storage.js";
import { TurnReadError } from "./turn-read-repository.js";

function invalid(): never { throw new TurnReadError("INTERNAL_ERROR"); }
/** Own-only immutable formation read. No initialization, clock observation, locks or repair. */
export class FormationReadRepository {
  constructor(private readonly client: PrismaClient) {}
  async getFormations(matchId: string, identityId: string): Promise<ReadFormationView> {
    if (!ReadFormationsRequestSchema.safeParse({ schemaVersion: 1, matchId }).success) throw new TurnReadError("INVALID_REQUEST");
    try {
      return await this.client.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const profile = await tx.playerIdentity.findUnique({ where: { id: identityId }, select: { username: true } });
        if (!profile) throw new TurnReadError("UNAUTHENTICATED");
        if (!UsernameSchema.safeParse(profile.username).success) throw new TurnReadError("USERNAME_REQUIRED");
        const member = await tx.matchParticipant.findUnique({ where: { matchId_identityId: { matchId, identityId } }, select: { active: true, playerId: true } });
        if (!member?.active) throw new TurnReadError("NOT_FOUND");
        const match = await tx.match.findUnique({ where: { id: matchId }, select: {
          id: true, status: true, currentStateVersion: true, configuration: true,
          world: { select: { matchId: true } }, turns: { select: { number: true }, orderBy: { number: "asc" }, take: 2 }
        } });
        if (!match) throw new TurnReadError("NOT_FOUND");
        const c = match.configuration;
        if (!c) return invalid();
        const config = GameConfigSchema.parse(c.config);
        if (c.matchId !== matchId || c.schemaVersion !== 1 || config.gameId !== matchId || c.turnDurationMs !== BigInt(config.turnDurationMs)) return invalid();
        const runtime = configurationRuntime(c), envelope = { schemaVersion: 1 as const, matchId };
        if (runtime === "empty") return invalid();
        if (match.status === "OPEN") {
          if (match.world || match.turns.length || match.currentStateVersion !== 0n) return invalid();
          return ReadFormationViewSchema.parse({ ...envelope, state: "NOT_STARTED" });
        }
        if (match.status !== "RUNNING") return invalid();
        if (runtime === "legacy") {
          if (match.turns.length) return invalid();
          return ReadFormationViewSchema.parse({ ...envelope, state: "UNINITIALIZED" });
        }
        if (!match.world || (match.currentStateVersion !== 0n && runtime!=="movement_resolution") || match.turns.length !== 1 || match.turns[0]?.number !== 1n) return invalid();
        const stored = await readStoredTurn(tx, matchId, 1);
        if (!stored.state.players.some((p) => p.playerId === member.playerId && p.active)) return invalid();
        if(stored.kind==="movement_resolution"){
          const f=stored.result?ownResolvedFormation(stored,member.playerId):null;
          if(f)return ReadFormationViewSchema.parse({...envelope,schemaVersion:2,state:"READY",collisionRadius:10,
            pendingEncounter:stored.result!.encounters.some(e=>e.members.some(m=>m.playerId===member.playerId)),formations:[f]});
        }
        if (stored.kind === "initial_world") return ReadFormationViewSchema.parse({ ...envelope, state: "UNSUPPORTED" });
        if (stored.kind !== "initial_armies" && stored.kind !== "movement_drafts" && stored.kind !== "turn_closure" && stored.kind !== "movement_resolution") return invalid();
        const formation = stored.snapshot.formations.find((f) => f.ownerPlayerId === member.playerId);
        if (!formation) return invalid();
        const members = new Map(stored.snapshot.units.map((u) => [u.unitId, u]));
        return ReadFormationViewSchema.parse({ ...envelope, ...(stored.kind==="movement_resolution"?{schemaVersion:2,collisionRadius:10,pendingEncounter:false}:{}),state: "READY", formations: [{
          schemaVersion: 1, formationId: formation.formationId, ownerPlayerId: member.playerId,
          position: { x: formation.position.x, y: formation.position.y },
          units: formation.unitIds.map((id) => {
            const unit = members.get(id);
            if (!unit || unit.ownerPlayerId !== member.playerId) return invalid();
            return { schemaVersion: 1, unitId: unit.unitId, originalSpawnNodeId: unit.originalSpawnNodeId,
              ...(unit.kind === "LEADER" ? { kind: "LEADER", rank: unit.rank, specialization: unit.specialization } : { kind: "INFANTRY" }) };
          })
        }] });
      }, { isolationLevel: "RepeatableRead" });
    } catch (error) { if (error instanceof TurnReadError) throw error; return invalid(); }
  }
}
