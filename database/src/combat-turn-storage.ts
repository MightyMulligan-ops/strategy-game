import {isDeepStrictEqual as same} from "node:util";
import {GameConfigSchema} from "@strategy-game/shared-types";
import {COMBAT_TURN_RUNTIME_PROFILE} from "@strategy-game/shared-types/server";
import type {CombatInitialSnapshot,CombatTurnResult,PinnedRuleset} from "@strategy-game/shared-types/server";
import {createTurn} from "@strategy-game/game-engine";
import {validateCombatInitialSnapshot,freezeCombatInput,resolveCombatTurn} from "@strategy-game/game-engine/server";
import type {TurnState} from "@strategy-game/game-engine";
import type {StoredTurnRow} from "./turn-storage.js";
import {restoreClosureDrafts} from "./closure-storage.js";
import {restoreWorldArchive} from "./world-repository.js";
import {restoreTurnRecord,json,safeNumber} from "./mappings.js";
import {PersistenceError} from "./errors.js";
export type CombatAggregate={kind:"combat_turn";row:StoredTurnRow;snapshot:CombatInitialSnapshot;state:TurnState;pinned:PinnedRuleset;result:CombatTurnResult|null};
type VerifiedCombat=Omit<CombatAggregate,"row">;
function invalid():never{throw new PersistenceError("invalid_storage","Combat turn storage is inconsistent")}
function restoreCombat(row: StoredTurnRow): VerifiedCombat {
  if (!row.match.world || !row.match.configuration) return invalid();
  const configuration = row.match.configuration, config = GameConfigSchema.parse(configuration.config);
  const profile = COMBAT_TURN_RUNTIME_PROFILE;
  if (configuration.matchId !== row.matchId || configuration.schemaVersion !== 1 || config.gameId !== row.matchId ||
      configuration.turnDurationMs !== BigInt(config.turnDurationMs) || configuration.rulesetId !== profile.ruleset.rulesetId ||
      configuration.rulesetVersion !== profile.ruleset.version || configuration.simulationVersion !== profile.simulationVersion) return invalid();
  const archive = restoreWorldArchive(row.match.world);
  const snapshot = validateCombatInitialSnapshot(row.startingSnapshot.payload, archive, row.match.configuration.pinnedRuleset);
  const resolved = row.status === "RESOLVED";
  const players = [...row.players].sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);
  const roster = players.map(p => ({ schemaVersion: 1, gameId: row.matchId, playerId: p.playerId, active: p.active }));
  const activeIds = row.match.participants.map(p => p.playerId).sort();
  if ((row.status !== "OPEN" && row.status !== "CLOSED" && !resolved) ||
      row.match.id !== row.matchId || row.match.status !== "RUNNING" ||
      row.match.currentStateVersion !== (resolved ? 1n : 0n) || row.number !== 1n || row.startingStateVersion !== 0n ||
      row.startingSnapshot.matchId !== row.matchId || row.startingSnapshot.stateVersion !== 0n ||
      row.startingSnapshot.completedTurnNumber !== 0n || row.startingSnapshot.snapshotId !== snapshot.snapshotId ||
      !same(snapshot.config, row.match.configuration.config) || !same(snapshot.players, roster) ||
      !same(activeIds, roster.map(p => p.playerId)) || row.match.participants.some(p => !p.active || p.matchId !== row.matchId)) return invalid();

  const expected = createTurn(snapshot.config, snapshot.players, safeNumber(row.openedAtMs));
  const turn = restoreTurnRecord(row);
  const closedTurn = turn.status === "resolved" ? { ...turn, status: "closed" as const } : turn;
  if (closedTurn.status !== "open" && closedTurn.status !== "closed") return invalid();
  if (closedTurn.openedAtMs !== expected.turn.openedAtMs || closedTurn.deadlineAtMs !== expected.turn.deadlineAtMs ||
      row.lastObservedAtMs < row.openedAtMs || (row.status === "OPEN" && row.lastObservedAtMs >= row.deadlineAtMs) ||
      (closedTurn.status === "closed" && (closedTurn.closedAtMs > safeNumber(row.lastObservedAtMs) ||
        (closedTurn.closeReason === "all_ready" && row.lastObservedAtMs >= row.deadlineAtMs)))) return invalid();
  const state = Object.freeze({ ...expected, turn: closedTurn, lastObservedAtMs: safeNumber(row.lastObservedAtMs),
    drafts: restoreClosureDrafts(row, snapshot, archive) });
  if (closedTurn.status === "open") {
    if (row.frozenInput !== null || state.drafts.every(d => d.ready)) return invalid();
  } else {
    const frozen = freezeCombatInput(state, snapshot, archive);
    if (!row.frozenInput || row.frozenInput.seed !== BigInt(frozen.resolutionSeed) || !same(row.frozenInput.payload, json(frozen))) return invalid();
  }
  let result: CombatTurnResult | null = null;
  if (resolved) {
    if (!row.resolution || !row.frozenInput) return invalid();
    result = resolveCombatTurn(snapshot, row.frozenInput.payload, archive);
    if (row.resolution.resolutionId !== result.resolutionId || row.resolution.nextStateVersion !== 1n ||
        !same(row.resolution.payload, json(result))) return invalid();
  } else if (row.resolution) return invalid();
  return { kind: "combat_turn", snapshot, state: Object.freeze({ ...state, turn }),
    pinned: COMBAT_TURN_RUNTIME_PROFILE, result };
}

export function restoreCombatTurn(row:StoredTurnRow):CombatAggregate{return {...restoreCombat(row),row};}
