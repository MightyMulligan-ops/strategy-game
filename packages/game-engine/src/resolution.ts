import {
  FrozenTurnInputSchema,
  GameSnapshotSchema,
  OrderResultSchema,
  PinnedRulesetSchema,
  ResolutionErrorSchema,
  SeedSchema,
  TurnResultSchema
} from "@strategy-game/shared-types/server";
import { INITIAL_WORLD_SIMULATION_VERSION } from "@strategy-game/shared-types/server";
import type {
  FrozenTurnInput, GameSnapshot, ResolutionError, TurnResult
} from "@strategy-game/shared-types/server";
import { auditHash, canonicalJson, compareIds } from "./determinism.js";
import { SEEDED_MOVEMENT_POLICY } from "./movement-queue.js";
import type { TurnState } from "./turn.js";

export const SIMULATION_VERSION = "empty-turn-v1";
export type TurnResolution =
  | Readonly<{ ok: true; result: TurnResult }>
  | Readonly<{ ok: false; error: ResolutionError }>;

function claimsInitialWorld(value: unknown): boolean {
  return value !== null && typeof value === "object" && (
    "kind" in value && value.kind === "initial_world" ||
    "simulationVersion" in value && value.simulationVersion === INITIAL_WORLD_SIMULATION_VERSION
  );
}

export class UnsupportedInitialWorldOperationError extends Error {
  readonly code = "unsupported_initial_world_operation";
  constructor() {
    super("initial-world-v1 supports initialization only; freezing is not supported");
    this.name = "UnsupportedInitialWorldOperationError";
  }
}

function failure(
  code: Exclude<ResolutionError["code"], "unsupported_orders">,
  message: string
): TurnResolution {
  return Object.freeze({ ok: false, error: ResolutionErrorSchema.parse({ code, message }) });
}

function pairMismatch(snapshot: GameSnapshot, frozen: FrozenTurnInput): string | undefined {
  if (frozen.startingSnapshotId !== snapshot.snapshotId ||
      frozen.turn.gameId !== snapshot.config.gameId ||
      frozen.turn.turnNumber !== snapshot.completedTurnNumber + 1 ||
      frozen.turn.deadlineAtMs - frozen.turn.openedAtMs !== snapshot.config.turnDurationMs) {
    return "Frozen turn does not match its starting snapshot and fixed match configuration";
  }
  const activeIds = snapshot.players.filter((player) => player.active).map((player) => player.playerId).sort(compareIds);
  const submittedIds = frozen.playerOrders.map((player) => player.playerId).sort(compareIds);
  if (canonicalJson(activeIds) !== canonicalJson(submittedIds)) {
    return "Frozen input must contain one queue for every active player, including empty queues";
  }
  return undefined;
}

// Capture the final revisions and their intentional array order only after
// closure. Parsing copies/freezes data; neither lifecycle nor snapshot changes.
export function freezeTurnInput(state: TurnState, startingSnapshotInput: unknown): FrozenTurnInput {
  if (claimsInitialWorld(startingSnapshotInput)) throw new UnsupportedInitialWorldOperationError();
  const snapshot = GameSnapshotSchema.parse(startingSnapshotInput);
  const byPlayer = (a: { playerId: string }, b: { playerId: string }) => compareIds(a.playerId, b.playerId);
  if (canonicalJson(state.config) !== canonicalJson(snapshot.config) ||
      canonicalJson([...state.players].sort(byPlayer)) !== canonicalJson([...snapshot.players].sort(byPlayer))) {
    throw new Error("Lifecycle and starting snapshot must describe the same match and roster");
  }
  const frozen = FrozenTurnInputSchema.parse({
    schemaVersion: 1,
    ruleset: snapshot.ruleset,
    simulationVersion: snapshot.simulationVersion,
    startingSnapshotId: snapshot.snapshotId,
    turn: state.turn,
    playerOrders: state.drafts.map(({ playerId, revision, orders }) => ({ playerId, revision, orders }))
  });
  const mismatch = pairMismatch(snapshot, frozen);
  if (mismatch) throw new Error(mismatch);
  return frozen;
}

// The four operational phases below establish an empty-world foundation.
// Future gameplay phases must be inserted only after their precedence is approved.
export function resolveTurn(
  startingSnapshotInput: unknown,
  frozenOrdersInput: unknown,
  pinnedRulesetInput: unknown,
  seedInput: unknown
): TurnResolution {
  if ([startingSnapshotInput, frozenOrdersInput, pinnedRulesetInput].some(claimsInitialWorld)) {
    return failure("version_mismatch", "initial-world-v1 supports initialization only; resolution is not supported");
  }
  // Phase 1: validate_inputs. No world/order data is silently discarded.
  const snapshotParse = GameSnapshotSchema.safeParse(startingSnapshotInput);
  const frozenParse = FrozenTurnInputSchema.safeParse(frozenOrdersInput);
  const rulesParse = PinnedRulesetSchema.safeParse(pinnedRulesetInput);
  const seedParse = SeedSchema.safeParse(seedInput);
  if (!snapshotParse.success || !frozenParse.success || !rulesParse.success || !seedParse.success) {
    return failure("invalid_input", "Malformed snapshot, frozen turn, pinned ruleset, or uint32 seed");
  }
  const snapshot = snapshotParse.data;
  const frozen = frozenParse.data;
  const pinned = rulesParse.data;
  const seed = seedParse.data;
  const metadata = { schemaVersion: 1 as const, ruleset: pinned.ruleset, simulationVersion: pinned.simulationVersion };
  if (pinned.simulationVersion !== SIMULATION_VERSION ||
      pinned.movementTieBreakPolicy !== SEEDED_MOVEMENT_POLICY ||
      snapshot.simulationVersion !== pinned.simulationVersion ||
      frozen.simulationVersion !== pinned.simulationVersion ||
      canonicalJson(snapshot.ruleset) !== canonicalJson(pinned.ruleset) ||
      canonicalJson(frozen.ruleset) !== canonicalJson(pinned.ruleset)) {
    return failure("version_mismatch", "Inputs must use the same pinned ruleset and supported simulation/tie policy");
  }
  const mismatch = pairMismatch(snapshot, frozen);
  if (mismatch) return failure("snapshot_mismatch", mismatch);
  const resolutionId = `resolution:${auditHash({ snapshot, frozen, pinned, seed })}`;

  // Phase 2: check_supported_orders. Reject the entire nonempty turn, including
  // every attack. The ordering helper is intentionally not an execution path.
  const rejected = frozen.playerOrders.flatMap((player) => player.orders.map((order) => OrderResultSchema.parse({
    ...metadata,
    orderResultId: `order-result:${auditHash({ resolutionId, playerId: player.playerId, orderId: order.orderId })}`,
    resolutionId,
    playerId: player.playerId,
    orderId: order.orderId,
    status: "rejected",
    reason: "unsupported_order"
  })));
  if (rejected.length > 0) {
    return Object.freeze({
      ok: false,
      error: ResolutionErrorSchema.parse({
        code: "unsupported_orders", message: "Only empty turns can resolve in this simulation version", orderResults: rejected
      })
    });
  }

  // Phase 3: advance_empty_state. No timers, gameplay/passive effects, or RNG
  // consumption. The seed remains in the audit identity even for an empty turn.
  if (snapshot.stateVersion === Number.MAX_SAFE_INTEGER) {
    return failure("counter_overflow", "State version cannot advance safely");
  }
  const nextState = GameSnapshotSchema.parse({
    ...snapshot,
    snapshotId: `snapshot:${resolutionId.slice("resolution:".length)}`,
    completedTurnNumber: frozen.turn.turnNumber,
    stateVersion: snapshot.stateVersion + 1
  });

  // Phase 4: emit_audit_event. One lifecycle event, no successful action results.
  return Object.freeze({
    ok: true,
    result: TurnResultSchema.parse({
      ...metadata,
      resolutionId,
      startingSnapshotId: snapshot.snapshotId,
      turnNumber: frozen.turn.turnNumber,
      seed,
      nextState,
      orderResults: [],
      domainEvents: [{
        ...metadata,
        eventId: `${resolutionId}:event:1`,
        type: "turn_resolved",
        resolutionId,
        gameId: snapshot.config.gameId,
        turnNumber: frozen.turn.turnNumber,
        startingSnapshotId: snapshot.snapshotId,
        nextSnapshotId: nextState.snapshotId,
        stateVersion: nextState.stateVersion
      }],
      phases: ["validate_inputs", "check_supported_orders", "advance_empty_state", "emit_audit_event"]
    })
  });
}
