import {restoreCombatTurn} from "./combat-turn-storage.js";
import {CombatTurnRuntimeSchema} from "@strategy-game/shared-types/server";
import type {CombatInitialSnapshot} from "@strategy-game/shared-types/server";
import { isDeepStrictEqual as same } from "node:util";
import { GameConfigSchema } from "@strategy-game/shared-types";
import {
  GameSnapshotSchema, InitialWorldRuntimeProfileSchema, InitialArmiesRuntimeProfileSchema, MovementDraftRuntimeProfileSchema, TurnClosureRuntimeProfileSchema, MovementResolutionRuntimeSchema, PinnedRulesetSchema
} from "@strategy-game/shared-types/server";
import type { GameSnapshot, InitialWorldSnapshot, InitialArmiesSnapshot, MovementDraftSnapshot, TurnClosureSnapshot, MovementInitialSnapshot } from "@strategy-game/shared-types/server";
import { createTurn, validateInitialWorldSnapshot, validateInitialArmiesSnapshot, validateMovementDraftSnapshot, validateTurnClosureSnapshot, freezeClosureInput } from "@strategy-game/game-engine";
import type { TurnState } from "@strategy-game/game-engine";
import type { MatchConfiguration, Prisma } from "./generated/prisma/client.js";
import { PersistenceError } from "./errors.js";
import { json, restoreDraft, restoreTurnRecord, safeNumber, turnFields } from "./mappings.js";
import { isMovementResolutionRow, restoreMovementResolution } from "./movement-resolution-storage.js";
import { restoreClosureDrafts } from "./closure-storage.js";
import { restoreMovementDrafts } from "./movement-draft-storage.js";
import { restoreWorldArchive } from "./world-repository.js";

export const storedTurnInclude = {
  match: { include: { configuration: true, world: true, participants: { where: { active: true } } } },
  startingSnapshot: true, players: { include: { orders: true, revisions: true } }, frozenInput: true, resolution: true
} as const;
export type StoredTurnRow = Prisma.TurnGetPayload<{ include: typeof storedTurnInclude }>;

function invalid(): never { throw new PersistenceError("invalid_storage", "Stored turn initialization is inconsistent"); }
export function configurationRuntime(row: MatchConfiguration): "legacy" | "initial_world" | "initial_armies" | "movement_drafts" | "turn_closure" | "movement_resolution" | "combat_turn" | "empty" {
  const fields = [row.rulesetId, row.rulesetVersion, row.simulationVersion, row.pinnedRuleset];
  if (fields.every((value) => value === null)) return "legacy";
  if (fields.some((value) => value === null)) return invalid();
  const pinned = PinnedRulesetSchema.parse(row.pinnedRuleset);
  if (row.rulesetId !== pinned.ruleset.rulesetId || row.rulesetVersion !== pinned.ruleset.version || row.simulationVersion !== pinned.simulationVersion) return invalid();
  if (pinned.simulationVersion === "initial-world-v1") {
    InitialWorldRuntimeProfileSchema.parse(pinned); return "initial_world";
  }
  if (pinned.simulationVersion === "initial-armies-v1") {
    InitialArmiesRuntimeProfileSchema.parse(pinned); return "initial_armies";
  }
  if (pinned.simulationVersion === "movement-drafts-v1") {
    MovementDraftRuntimeProfileSchema.parse(pinned); return "movement_drafts";
  }
  if (pinned.simulationVersion === "turn-closure-v1") {
    TurnClosureRuntimeProfileSchema.parse(pinned); return "turn_closure";
  }
  if (pinned.simulationVersion === "movement-resolution-v1") { MovementResolutionRuntimeSchema.parse(pinned); return "movement_resolution"; }
  if (pinned.simulationVersion === "combat-turn-v1") { CombatTurnRuntimeSchema.parse(pinned); return "combat_turn"; }
  if (pinned.simulationVersion === "empty-turn-v1") return "empty";
  return invalid();
}

function restore(row: StoredTurnRow) {
  // Choose this cohort without invoking header accessors; its complete data
  // inspection must precede ordinary config/schema reads and cached reuse.
  if (isMovementResolutionRow(row)) return restoreMovementResolution(row);
  if (row.match.configuration?.simulationVersion === "combat-turn-v1") return restoreCombatTurn(row);
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

  if (mode === "initial_world" || mode === "initial_armies" || mode === "movement_drafts" || mode === "turn_closure") {
    if (!row.match.world) return invalid();
    const archive = restoreWorldArchive(row.match.world);
    const snapshot = mode === "turn_closure" ? validateTurnClosureSnapshot(row.startingSnapshot.payload, archive, pinned) : mode === "movement_drafts" ? validateMovementDraftSnapshot(row.startingSnapshot.payload, archive, pinned)
      : mode === "initial_armies"
      ? validateInitialArmiesSnapshot(row.startingSnapshot.payload, archive, pinned)
      : validateInitialWorldSnapshot(row.startingSnapshot.payload, archive, pinned);
    const activeIds = row.match.participants.map((p) => p.playerId).sort();
    if (row.match.id !== row.matchId || row.match.status !== "RUNNING" || row.match.currentStateVersion !== 0n ||
        row.number !== 1n || row.startingStateVersion !== 0n || row.startingSnapshot.matchId !== row.matchId ||
        row.startingSnapshot.stateVersion !== 0n || row.startingSnapshot.completedTurnNumber !== 0n ||
        row.startingSnapshot.snapshotId !== snapshot.snapshotId || !same(snapshot.config, config) ||
        !same(snapshot.players, roster) || !same(activeIds, roster.map((p) => p.playerId)) ||
        row.match.participants.some((p) => !p.active || p.matchId !== row.matchId) ||
        (mode !== "turn_closure" && row.frozenInput !== null) || row.resolution !== null) return invalid();
    if (mode === "turn_closure") {
      const closure = snapshot as TurnClosureSnapshot;
      const turn = restoreTurnRecord(row);
      if (turn.status !== "open" && turn.status !== "closed") return invalid();
      if (turn.openedAtMs !== expected.turn.openedAtMs || turn.deadlineAtMs !== expected.turn.deadlineAtMs ||
          row.lastObservedAtMs < row.openedAtMs || (row.status === "OPEN" && row.lastObservedAtMs >= row.deadlineAtMs) ||
          (turn.status === "closed" && (turn.closedAtMs > safeNumber(row.lastObservedAtMs) ||
            (turn.closeReason === "all_ready" && row.lastObservedAtMs >= row.deadlineAtMs)))) return invalid();
      const state = Object.freeze({ ...expected, turn, lastObservedAtMs: safeNumber(row.lastObservedAtMs), drafts: restoreClosureDrafts(row, closure, archive) });
      if (turn.status === "open") {
        if (row.frozenInput !== null || state.drafts.every((d) => d.ready)) return invalid();
      } else if (!row.frozenInput || row.frozenInput.seed !== null || !same(row.frozenInput.payload, json(freezeClosureInput(state, closure, archive)))) return invalid();
      return { kind: "turn_closure" as const, row, state, snapshot: closure, pinned };
    }
    const fields = turnFields(expected);
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) if (row[key] !== fields[key]) return invalid();
    if (mode === "movement_drafts") {
      const movement = snapshot as MovementDraftSnapshot;
      return { kind: "movement_drafts" as const, row, snapshot: movement, pinned,
        state: Object.freeze({ ...expected, drafts: restoreMovementDrafts(row, movement, archive) }) };
    }
    for (const p of playerRows) {
      const r = p.revisions[0];
      if (p.matchId !== row.matchId || p.turnNumber !== 1n || !p.active || p.revision !== 0n || p.ready || p.orders.length !== 0 ||
          p.revisions.length !== 1 || !r || r.matchId !== row.matchId || r.turnNumber !== 1n || r.playerId !== p.playerId ||
          r.revision !== 0n || r.kind !== "INITIAL" || r.ready || r.command !== null || !Array.isArray(r.orders) || r.orders.length !== 0) return invalid();
    }
    return mode === "initial_armies"
      ? { kind: "initial_armies" as const, row, state: expected, snapshot: snapshot as InitialArmiesSnapshot, pinned }
      : { kind: "initial_world" as const, row, state: expected, snapshot: snapshot as InitialWorldSnapshot, pinned };
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
/** Transaction-scoped restoration; callers own authorization and transaction policy. */
export async function readStoredTurn(tx: Prisma.TransactionClient, matchId: string, turnNumber: number) {
  const row = await tx.turn.findUnique({ where: { matchId_number: { matchId, number: BigInt(turnNumber) } }, include: storedTurnInclude });
  if (!row) throw new PersistenceError("not_found", "Turn not found");
  const restored=restoreStoredTurn(row);
  if((restored.kind==="movement_resolution"||restored.kind==="combat_turn")&&restored.result){
    const next=await tx.gameSnapshotRecord.findUnique({where:{matchId_stateVersion:{matchId,stateVersion:1n}}});
    if(!next||next.snapshotId!==restored.result.nextState.snapshotId||next.completedTurnNumber!==1n||!same(next.payload,json(restored.result.nextState)))return invalid();
  }
  return restored;
}
export function requireEmptyRuntime(aggregate: StoredTurn): asserts aggregate is Extract<StoredTurn, { kind: "empty" }> {
  if (aggregate.kind !== "empty") throw new PersistenceError("unsupported_runtime_operation", "Initial-world runtime supports initialization only");
}

export async function insertSnapshot(tx: Prisma.TransactionClient, snapshot: GameSnapshot | InitialWorldSnapshot | InitialArmiesSnapshot | MovementDraftSnapshot | TurnClosureSnapshot | MovementInitialSnapshot | CombatInitialSnapshot) {
  await tx.gameSnapshotRecord.create({ data: { matchId: snapshot.config.gameId, stateVersion: BigInt(snapshot.stateVersion),
    snapshotId: snapshot.snapshotId, completedTurnNumber: BigInt(snapshot.completedTurnNumber), payload: json(snapshot) } });
}
export async function insertTurn(tx: Prisma.TransactionClient, state: TurnState, snapshot: GameSnapshot | InitialWorldSnapshot | InitialArmiesSnapshot | MovementDraftSnapshot | TurnClosureSnapshot | MovementInitialSnapshot | CombatInitialSnapshot) {
  const matchId = state.config.gameId; const turnNumber = BigInt(state.turn.turnNumber);
  await tx.turn.create({ data: { matchId, number: turnNumber, startingStateVersion: BigInt(snapshot.stateVersion), ...turnFields(state) } });
  for (const player of state.players) {
    const scope = { matchId, turnNumber, playerId: player.playerId };
    await tx.playerTurnState.create({ data: { ...scope, active: player.active, revision: 0n, ready: false } });
    await tx.playerSubmissionRevision.create({ data: { ...scope, revision: 0n, kind: "INITIAL", ready: false, orders: [] } });
  }
}
