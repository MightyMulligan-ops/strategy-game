import { isDeepStrictEqual as same } from "node:util";
import { GameConfigSchema } from "@strategy-game/shared-types";
import {
  GameSnapshotSchema, InitialWorldRuntimeProfileSchema, PinnedRulesetSchema
} from "@strategy-game/shared-types/server";
import type { GameSnapshot, InitialWorldSnapshot } from "@strategy-game/shared-types/server";
import { createTurn, validateInitialWorldSnapshot } from "@strategy-game/game-engine";
import type { TurnState } from "@strategy-game/game-engine";
import type { MatchConfiguration, Prisma } from "./generated/prisma/client.js";
import { PersistenceError } from "./errors.js";
import { json, restoreDraft, restoreTurnRecord, safeNumber, turnFields } from "./mappings.js";
import { restoreWorldArchive } from "./world-repository.js";

export const storedTurnInclude = {
  match: { include: { configuration: true, world: true, participants: { where: { active: true } } } },
  startingSnapshot: true, players: { include: { orders: true, revisions: true } }, frozenInput: true, resolution: true
} as const;
export type StoredTurnRow = Prisma.TurnGetPayload<{ include: typeof storedTurnInclude }>;

function invalid(): never { throw new PersistenceError("invalid_storage", "Stored turn initialization is inconsistent"); }
export function configurationRuntime(row: MatchConfiguration): "legacy" | "initial_world" | "empty" {
  const fields = [row.rulesetId, row.rulesetVersion, row.simulationVersion, row.pinnedRuleset];
  if (fields.every((value) => value === null)) return "legacy";
  if (fields.some((value) => value === null)) return invalid();
  const pinned = PinnedRulesetSchema.parse(row.pinnedRuleset);
  if (row.rulesetId !== pinned.ruleset.rulesetId || row.rulesetVersion !== pinned.ruleset.version || row.simulationVersion !== pinned.simulationVersion) return invalid();
  if (pinned.simulationVersion === "initial-world-v1") {
    InitialWorldRuntimeProfileSchema.parse(pinned); return "initial_world";
  }
  if (pinned.simulationVersion === "empty-turn-v1") return "empty";
  return invalid();
}

function restore(row: StoredTurnRow) {
  const configuration = row.match.configuration;
  if (!configuration) return invalid();
  const config = GameConfigSchema.parse(configuration.config);
  if (configuration.matchId !== row.matchId || configuration.schemaVersion !== 1 || config.gameId !== row.matchId ||
      configuration.turnDurationMs !== BigInt(config.turnDurationMs)) return invalid();
  const mode = configurationRuntime(configuration);
  const pinned = PinnedRulesetSchema.parse(configuration.pinnedRuleset);
  const byId = (a: { playerId: string }, b: { playerId: string }) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  const playerRows = [...row.players].sort(byId);
  const roster = playerRows.map((p) => ({ schemaVersion: 1 as const, gameId: row.matchId, playerId: p.playerId, active: p.active }));
  const expected = createTurn(config, roster, safeNumber(row.openedAtMs));

  if (mode === "initial_world") {
    if (!row.match.world) return invalid();
    const snapshot = validateInitialWorldSnapshot(row.startingSnapshot.payload, restoreWorldArchive(row.match.world), pinned);
    const activeIds = row.match.participants.map((p) => p.playerId).sort();
    if (row.match.id !== row.matchId || row.match.status !== "RUNNING" || row.match.currentStateVersion !== 0n ||
        row.number !== 1n || row.startingStateVersion !== 0n || row.startingSnapshot.matchId !== row.matchId ||
        row.startingSnapshot.stateVersion !== 0n || row.startingSnapshot.completedTurnNumber !== 0n ||
        row.startingSnapshot.snapshotId !== snapshot.snapshotId || !same(snapshot.config, config) ||
        !same(snapshot.players, roster) || !same(activeIds, roster.map((p) => p.playerId)) ||
        row.match.participants.some((p) => !p.active || p.matchId !== row.matchId) ||
        row.frozenInput !== null || row.resolution !== null) return invalid();
    const fields = turnFields(expected);
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) if (row[key] !== fields[key]) return invalid();
    for (const p of playerRows) {
      const r = p.revisions[0];
      if (p.matchId !== row.matchId || p.turnNumber !== 1n || !p.active || p.revision !== 0n || p.ready || p.orders.length !== 0 ||
          p.revisions.length !== 1 || !r || r.matchId !== row.matchId || r.turnNumber !== 1n || r.playerId !== p.playerId ||
          r.revision !== 0n || r.kind !== "INITIAL" || r.ready || r.command !== null || !Array.isArray(r.orders) || r.orders.length !== 0) return invalid();
    }
    return { kind: "initial_world" as const, row, state: expected, snapshot, pinned };
  }
  if (mode !== "empty") return invalid();
  const snapshot = GameSnapshotSchema.parse(row.startingSnapshot.payload);
  if (!same(snapshot.config, config) || !same(snapshot.ruleset, pinned.ruleset) || snapshot.simulationVersion !== pinned.simulationVersion ||
      snapshot.snapshotId !== row.startingSnapshot.snapshotId || snapshot.stateVersion !== safeNumber(row.startingStateVersion) ||
      snapshot.completedTurnNumber + 1 !== safeNumber(row.number) || !same([...snapshot.players].sort(byId), roster)) return invalid();
  const state: TurnState = Object.freeze({ ...expected, turn: restoreTurnRecord(row),
    drafts: Object.freeze(playerRows.map(restoreDraft).filter((_, i) => playerRows[i]?.active)), lastObservedAtMs: safeNumber(row.lastObservedAtMs) });
  return { kind: "empty" as const, row, state, snapshot, pinned };
}

export function restoreStoredTurn(row: StoredTurnRow) {
  try { return restore(row); }
  catch (error) {
    if (error instanceof PersistenceError) throw error;
    return invalid();
  }
}
export type StoredTurn = ReturnType<typeof restoreStoredTurn>;
export function requireEmptyRuntime(aggregate: StoredTurn): asserts aggregate is Extract<StoredTurn, { kind: "empty" }> {
  if (aggregate.kind !== "empty") throw new PersistenceError("unsupported_runtime_operation", "Initial-world runtime supports initialization only");
}

export async function insertSnapshot(tx: Prisma.TransactionClient, snapshot: GameSnapshot | InitialWorldSnapshot) {
  await tx.gameSnapshotRecord.create({ data: { matchId: snapshot.config.gameId, stateVersion: BigInt(snapshot.stateVersion),
    snapshotId: snapshot.snapshotId, completedTurnNumber: BigInt(snapshot.completedTurnNumber), payload: json(snapshot) } });
}
export async function insertTurn(tx: Prisma.TransactionClient, state: TurnState, snapshot: GameSnapshot | InitialWorldSnapshot) {
  const matchId = state.config.gameId; const turnNumber = BigInt(state.turn.turnNumber);
  await tx.turn.create({ data: { matchId, number: turnNumber, startingStateVersion: BigInt(snapshot.stateVersion), ...turnFields(state) } });
  for (const player of state.players) {
    const scope = { matchId, turnNumber, playerId: player.playerId };
    await tx.playerTurnState.create({ data: { ...scope, active: player.active, revision: 0n, ready: false } });
    await tx.playerSubmissionRevision.create({ data: { ...scope, revision: 0n, kind: "INITIAL", ready: false, orders: [] } });
  }
}
