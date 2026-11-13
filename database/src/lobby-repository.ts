import { randomUUID } from "node:crypto";
import {
  classifyLobbyTurnDuration, ListLobbiesRequestSchema, LobbyDetailSchema, LobbySettingsSchema,
  LobbySummarySchema, SetLobbyReadyRequestSchema, UsernameSchema, ViewLobbyRequestSchema
} from "@strategy-game/shared-types";
import type { LobbyDetail, LobbySummary } from "@strategy-game/shared-types";
import { Prisma } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { json, safeNumber } from "./mappings.js";
import { makeInitialWorld, insertInitialWorld } from "./world-repository.js";
import { INITIAL_WORLD_RUNTIME_PROFILE, InitialWorldRuntimeProfileSchema, InitialArmiesRuntimeProfileSchema, MovementDraftRuntimeProfileSchema } from "@strategy-game/shared-types/server";
import { createTurn, initializeTurnOne, planInitialArmies, planMovementDrafts } from "@strategy-game/game-engine";
import { configurationRuntime, insertSnapshot, insertTurn } from "./turn-storage.js";

export type LobbyErrorCode = "UNAUTHENTICATED" | "USERNAME_REQUIRED" | "INVALID_INPUT" | "NOT_FOUND"
  | "LOBBY_NOT_OPEN" | "LOBBY_FULL" | "HOST_CANNOT_LEAVE" | "NOT_A_PARTICIPANT" | "INVALID_STORAGE"
  | "HOST_REQUIRED" | "NOT_ENOUGH_PARTICIPANTS" | "NOT_ALL_READY";

/** Safe domain codes; adapters must not expose unexpected database exceptions. */
export class LobbyError extends Error {
  constructor(readonly code: LobbyErrorCode) { super(code); this.name = "LobbyError"; }
}

const lobbyInclude = {
  configuration: true,
  participants: {
    where: { active: true }, orderBy: { playerId: "asc" },
    select: { playerId: true, identityId: true, lobbyReady: true, identity: { select: { username: true } } }
  }
} as const;
type LobbyRow = Prisma.MatchGetPayload<{ include: typeof lobbyInclude }>;
type Transaction = Prisma.TransactionClient;

async function registeredUsername(tx: Transaction, identityId: string): Promise<string> {
  if (!identityId || identityId.trim() !== identityId) throw new LobbyError("UNAUTHENTICATED");
  const row = await tx.playerIdentity.findUnique({ where: { id: identityId }, select: { username: true } });
  if (!row) throw new LobbyError("UNAUTHENTICATED");
  const result = UsernameSchema.safeParse(row.username);
  if (!result.success) throw new LobbyError("USERNAME_REQUIRED");
  return result.data;
}

function lobbyId(input: string): string {
  const result = ViewLobbyRequestSchema.safeParse({ schemaVersion: 1, lobbyId: input });
  if (!result.success) throw new LobbyError("INVALID_INPUT");
  return result.data.lobbyId;
}

async function readLobby(tx: Transaction, id: string): Promise<LobbyRow> {
  const row = await tx.match.findUnique({ where: { id }, include: lobbyInclude });
  // Legacy/internal matches have no approved public host/settings; do not invent them.
  if (!row || row.hostIdentityId === null) throw new LobbyError("NOT_FOUND");
  return row;
}

function summary(row: LobbyRow): LobbySummary {
  const config = row.configuration;
  const host = row.participants.find((member) => member.identityId === row.hostIdentityId);
  if (!config || !host || config.playerCapacity === null) throw new LobbyError("INVALID_STORAGE");
  const result = LobbySummarySchema.safeParse({
    schemaVersion: 1, lobbyId: row.id, status: row.status,
    settings: { name: config.name, playerCapacity: config.playerCapacity,
      turnDurationMs: safeNumber(config.turnDurationMs), visibility: "PUBLIC" },
    host: { playerId: host.playerId, username: host.identity.username, ready: host.lobbyReady },
    participantCount: row.participants.length,
    readyCount: row.participants.filter((participant) => participant.lobbyReady).length,
    availableSlots: row.status === "OPEN" ? config.playerCapacity - row.participants.length : 0,
    durationCategory: classifyLobbyTurnDuration(safeNumber(config.turnDurationMs))
  });
  if (!result.success) throw new LobbyError("INVALID_STORAGE");
  return result.data;
}

function detail(row: LobbyRow, identityId: string, username: string): LobbyDetail {
  const base = summary(row);
  const member = row.participants.find((participant) => participant.identityId === identityId);
  const role = member ? identityId === row.hostIdentityId ? "HOST" : "PARTICIPANT" : "NON_PARTICIPANT";
  const open = row.status === "OPEN";
  const result = LobbyDetailSchema.safeParse({
    ...base,
    participants: row.participants.map((participant) => ({ playerId: participant.playerId, username: participant.identity.username, ready: participant.lobbyReady })),
    viewer: { role, username, playerId: member?.playerId ?? null,
      canJoin: open && !member && base.availableSlots > 0,
      canLeave: open && role === "PARTICIPANT",
      canStart: open && role === "HOST" && base.participantCount >= 2 && base.readyCount === base.participantCount }
  });
  if (!result.success) throw new LobbyError("INVALID_STORAGE");
  return result.data;
}

/** Server-only. Identity IDs must come from trusted authentication, never request bodies.
 * Starting atomically persists the initial world and, for pinned new lobbies, Turn 1.
 */
export class LobbyRepository {
  constructor(private readonly client: PrismaClient, private readonly worldFactory: typeof makeInitialWorld = makeInitialWorld,
    private readonly clock: () => number = Date.now,
    private readonly creationRuntime: unknown = INITIAL_WORLD_RUNTIME_PROFILE) {}

  private async withLobby<T>(id: string, identityId: string,
    work: (tx: Transaction, row: LobbyRow, username: string) => Promise<T>): Promise<T> {
    const key = lobbyId(id);
    return this.client.$transaction(async (tx) => {
      const username = await registeredUsername(tx, identityId);
      // Membership, readiness and start share this lock before reading state.
      // ReadCommitted ensures a waiter sees the preceding writer's committed roster.
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "Match" WHERE "id" = ${key} FOR UPDATE
      `);
      if (rows.length === 0) throw new LobbyError("NOT_FOUND");
      return work(tx, await readLobby(tx, key), username);
    }, { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 10_000 });
  }

  async createLobby(identityId: string, settingsInput: unknown): Promise<LobbyDetail> {
    const parsed = LobbySettingsSchema.safeParse(settingsInput);
    if (!parsed.success) throw new LobbyError("INVALID_INPUT");
    const settings = parsed.data;
    // Trusted creation-time selection only; request fields never select a runtime.
    const oldProfile = InitialWorldRuntimeProfileSchema.safeParse(this.creationRuntime);
    const armyProfile = InitialArmiesRuntimeProfileSchema.safeParse(this.creationRuntime);
    const runtime = oldProfile.success ? oldProfile.data : armyProfile.success ? armyProfile.data : MovementDraftRuntimeProfileSchema.parse(this.creationRuntime);
    return this.client.$transaction(async (tx) => {
      const username = await registeredUsername(tx, identityId);
      const id = randomUUID();
      await tx.match.create({ data: { id, status: "OPEN", hostIdentityId: identityId, createdAt: new Date() } });
      await tx.matchConfiguration.create({ data: {
        matchId: id, schemaVersion: 1, name: settings.name, playerCapacity: settings.playerCapacity,
        turnDurationMs: BigInt(settings.turnDurationMs),
        rulesetId: runtime.ruleset.rulesetId, rulesetVersion: runtime.ruleset.version,
        simulationVersion: runtime.simulationVersion, pinnedRuleset: json(runtime),
        config: json({ schemaVersion: 1, gameId: id, turnDurationMs: settings.turnDurationMs })
      } });
      await tx.matchParticipant.create({ data: { matchId: id, playerId: randomUUID(), identityId, active: true } });
      return detail(await readLobby(tx, id), identityId, username);
    }, { timeout: 15_000, maxWait: 10_000 });
  }

  async leaveLobby(id: string, identityId: string): Promise<LobbyDetail> {
    return this.withLobby(id, identityId, async (tx, row, username) => {
      if (row.status !== "OPEN") throw new LobbyError("LOBBY_NOT_OPEN");
      if (row.hostIdentityId === identityId) throw new LobbyError("HOST_CANNOT_LEAVE");
      const member = row.participants.find((participant) => participant.identityId === identityId);
      if (!member) throw new LobbyError("NOT_A_PARTICIPANT");
      // Retain the identity/player mapping; rejoin reactivates this same slot.
      await tx.matchParticipant.update({ where: { matchId_identityId: { matchId: row.id, identityId } }, data: { active: false, lobbyReady: false } });
      return detail(await readLobby(tx, row.id), identityId, username);
    });
  }

  async joinLobby(id: string, identityId: string): Promise<{ readonly lobby: LobbyDetail; readonly outcome: "JOINED" | "ALREADY_JOINED" }> {
    return this.withLobby(id, identityId, async (tx, row, username) => {
      // Issue #9 / owner clarification: reject even duplicate retries after start.
      if (row.status !== "OPEN") throw new LobbyError("LOBBY_NOT_OPEN");
      const member = row.participants.find((participant) => participant.identityId === identityId);
      if (member) return Object.freeze({ lobby: detail(row, identityId, username), outcome: "ALREADY_JOINED" as const });
      if (summary(row).availableSlots === 0) throw new LobbyError("LOBBY_FULL");
      await tx.matchParticipant.upsert({
        where: { matchId_identityId: { matchId: row.id, identityId } },
        create: { matchId: row.id, playerId: randomUUID(), identityId, active: true, lobbyReady: false },
        update: { active: true, lobbyReady: false }
      });
      return Object.freeze({ lobby: detail(await readLobby(tx, row.id), identityId, username), outcome: "JOINED" as const });
    });
  }

  async setReady(id: string, identityId: string, ready: unknown): Promise<LobbyDetail> {
    const parsed = SetLobbyReadyRequestSchema.safeParse({ schemaVersion: 1, lobbyId: id, ready });
    if (!parsed.success) throw new LobbyError("INVALID_INPUT");
    return this.withLobby(id, identityId, async (tx, row, username) => {
      if (row.status !== "OPEN") throw new LobbyError("LOBBY_NOT_OPEN");
      if (!row.participants.some((participant) => participant.identityId === identityId)) throw new LobbyError("NOT_A_PARTICIPANT");
      // Explicit value makes a repeated request idempotent; never toggle on the server.
      await tx.matchParticipant.update({ where: { matchId_identityId: { matchId: row.id, identityId } }, data: { lobbyReady: parsed.data.ready } });
      return detail(await readLobby(tx, row.id), identityId, username);
    });
  }

  async startLobby(id: string, identityId: string): Promise<{ readonly lobby: LobbyDetail; readonly outcome: "STARTED" | "ALREADY_STARTED" }> {
    return this.withLobby(id, identityId, async (tx, row, username) => {
      // Host authorization also applies to retries, before acknowledging RUNNING.
      if (row.hostIdentityId !== identityId) throw new LobbyError("HOST_REQUIRED");
      if (row.status === "RUNNING") return Object.freeze({ lobby: detail(row, identityId, username), outcome: "ALREADY_STARTED" as const });
      if (row.participants.length < 2) throw new LobbyError("NOT_ENOUGH_PARTICIPANTS");
      if (row.participants.some((participant) => !participant.lobbyReady)) throw new LobbyError("NOT_ALL_READY");
      summary(row); // Validate host, capacity and fixed public metadata before generation.
      if (!row.configuration) throw new LobbyError("INVALID_STORAGE");
      const mode = configurationRuntime(row.configuration);
      if (mode === "empty") throw new LobbyError("INVALID_STORAGE");
      if ((mode === "initial_world" || mode === "initial_armies" || mode === "movement_drafts") && (row.currentStateVersion !== 0n ||
          await tx.gameSnapshotRecord.count({ where: { matchId: row.id } }) !== 0 ||
          await tx.turn.count({ where: { matchId: row.id } }) !== 0)) throw new LobbyError("INVALID_STORAGE");
      const players = row.participants.map((p) => p.playerId);
      const archive = await insertInitialWorld(tx, row.id, this.worldFactory(players), players);
      if (mode === "initial_world" || mode === "initial_armies" || mode === "movement_drafts") {
        // One trusted sample after lock/generation. Any failure rolls the entire transaction back.
        const roster = players.map((playerId) => ({ schemaVersion: 1 as const, gameId: row.id, playerId, active: true }));
        // Derive all armies before the only trusted clock sample; legacy v2 remains unchanged.
        const armies = mode === "movement_drafts" ? planMovementDrafts(row.configuration.config, roster, archive, row.configuration.pinnedRuleset)
          : mode === "initial_armies" ? planInitialArmies(row.configuration.config, roster, archive, row.configuration.pinnedRuleset) : null;
        const plan = armies ? { ...armies, state: createTurn(armies.snapshot.config, armies.snapshot.players, this.clock()) }
          : initializeTurnOne(row.configuration.config, roster, archive, this.clock(), row.configuration.pinnedRuleset);
        await insertSnapshot(tx, plan.snapshot);
        await insertTurn(tx, plan.state, plan.snapshot);
      }
      const updated = await tx.match.updateMany({ where: { id: row.id, status: "OPEN" }, data: { status: "RUNNING" } });
      if (updated.count !== 1) throw new LobbyError("LOBBY_NOT_OPEN");
      // Configuration and lobby Ready remain unchanged; retries never initialize anything.
      return Object.freeze({ lobby: detail(await readLobby(tx, row.id), identityId, username), outcome: "STARTED" as const });
    });
  }

  async getLobby(id: string, identityId: string): Promise<LobbyDetail> {
    const key = lobbyId(id);
    return this.client.$transaction(async (tx) => {
      const username = await registeredUsername(tx, identityId);
      return detail(await readLobby(tx, key), identityId, username);
    }, { isolationLevel: "RepeatableRead" });
  }

  async listLobbies(identityId: string, filtersInput: unknown = { schemaVersion: 1 }): Promise<readonly LobbySummary[]> {
    const parsed = ListLobbiesRequestSchema.safeParse(filtersInput);
    if (!parsed.success) throw new LobbyError("INVALID_INPUT");
    const filters = parsed.data;
    return this.client.$transaction(async (tx) => {
      await registeredUsername(tx, identityId);
      const rows = await tx.match.findMany({
        where: { hostIdentityId: { not: null }, ...(filters.status ? { status: filters.status } : {}) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: lobbyInclude
      });
      return Object.freeze(rows.map(summary).filter((lobby) => !filters.durationCategory || lobby.durationCategory === filters.durationCategory));
    }, { isolationLevel: "RepeatableRead" });
  }
}
