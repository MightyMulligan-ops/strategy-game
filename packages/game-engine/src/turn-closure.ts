import { ClosureCommandSchema, ClosureFrozenInputSchema, TURN_CLOSURE_RUNTIME_PROFILE, TurnClosureRuntimeProfileSchema, TurnClosureSnapshotSchema } from "@strategy-game/shared-types/server";
import type { InitialWorldArchive, TurnClosureSnapshot } from "@strategy-game/shared-types/server";
import type { PlayerTurnDraft, TurnState } from "./turn.js";
import { createTurn } from "./turn.js";
import { MovementDraftFailure, planMovementDrafts, previewMovementDraft } from "./movement-drafts.js";
import { auditHash, canonicalJson } from "./determinism.js";
export function planTurnClosure(config: unknown, players: unknown, archive: unknown, runtime: unknown = TURN_CLOSURE_RUNTIME_PROFILE) {
  const profile = TurnClosureRuntimeProfileSchema.parse(runtime);
  const { snapshotId: movementDraftSnapshotId, ...base } = planMovementDrafts(config, players, archive).snapshot;
  const metadata = { ...base, schemaVersion: 5 as const, kind: "turn_closure" as const, ruleset: profile.ruleset,
    simulationVersion: profile.simulationVersion, movementDraftSnapshotId };
  return Object.freeze({ runtimeProfile: profile, snapshot: TurnClosureSnapshotSchema.parse({ ...metadata,
    snapshotId: `turn-closure:${auditHash({ snapshot: metadata, runtimeProfile: profile })}` }) });
}
export function initializeTurnClosure(config: unknown, players: unknown, archive: unknown, now: number) {
  const plan = planTurnClosure(config, players, archive);
  return Object.freeze({ ...plan, state: createTurn(plan.snapshot.config, plan.snapshot.players, now) });
}
export function validateTurnClosureSnapshot(input: unknown, archive: unknown, runtime: unknown) {
  const snapshot = TurnClosureSnapshotSchema.parse(input);
  if (canonicalJson(snapshot) !== canonicalJson(planTurnClosure(snapshot.config, snapshot.players, archive, runtime).snapshot)) throw new MovementDraftFailure("INTERNAL_ERROR");
  return snapshot;
}
function clock(state: TurnState, now: number) {
  if (!Number.isSafeInteger(now) || now < state.lastObservedAtMs) throw new MovementDraftFailure("INTERNAL_ERROR");
}
export function observeClosureDeadline(state: TurnState, now: number): TurnState {
  clock(state, now);
  if (state.turn.status !== "open") return state;
  return Object.freeze({ ...state, lastObservedAtMs: now, turn: now < state.turn.deadlineAtMs ? state.turn : Object.freeze({ ...state.turn,
    status: "closed" as const, closeReason: "deadline" as const, closedAtMs: state.turn.deadlineAtMs }) });
}
export function reviseClosureDraft(snapshot: Pick<TurnClosureSnapshot,"config"|"formations"|"units">, archive: InitialWorldArchive, draft: PlayerTurnDraft, input: unknown): PlayerTurnDraft {
  const parsed = ClosureCommandSchema.safeParse(input);
  if (!parsed.success) throw new MovementDraftFailure("INVALID_REQUEST");
  const c = parsed.data;
  if (c.gameId !== snapshot.config.gameId || c.turnNumber !== 1) throw new MovementDraftFailure("WRONG_TURN");
  if (c.expectedRevision !== draft.revision) throw new MovementDraftFailure("STALE_REVISION");
  if (draft.revision === Number.MAX_SAFE_INTEGER) throw new MovementDraftFailure("REVISION_EXHAUSTED");
  if (c.kind === "set_ready") {
    if (c.ready === draft.ready) throw new MovementDraftFailure("READY_UNCHANGED");
    return Object.freeze({ ...draft, revision: draft.revision + 1, ready: c.ready });
  }
  if (draft.ready) throw new MovementDraftFailure("READY_LOCKED");
  if (c.kind === "cancel_order" && !draft.orders.some((o) => o.orderId === c.orderId)) throw new MovementDraftFailure("ORDER_NOT_FOUND");
  const orders = c.kind === "replace_orders" ? c.orders : draft.orders.filter((o) => o.orderId !== c.orderId);
  previewMovementDraft(snapshot, archive, draft.playerId, orders);
  return Object.freeze({ ...draft, revision: draft.revision + 1, orders });
}
/** Deadline observation precedes semantic rejection; callers commit returned state even on rejection. */
export function applyClosureCommand(state: TurnState, snapshot: Pick<TurnClosureSnapshot,"config"|"formations"|"units">, archive: InitialWorldArchive, actor: string, input: unknown, now: number) {
  const observed = observeClosureDeadline(state, now);
  if (observed.turn.status !== "open") return { state: observed, error: "TURN_CLOSED" as const };
  const draft = observed.drafts.find((p) => p.playerId === actor);
  if (!draft || !observed.players.some((p) => p.playerId === actor && p.active)) throw new MovementDraftFailure("NOT_FOUND");
  try {
    const next = reviseClosureDraft(snapshot, archive, draft, input);
    const drafts = Object.freeze(observed.drafts.map((d) => d.playerId === actor ? next : d));
    const turn = drafts.every((d) => d.ready) ? Object.freeze({ ...observed.turn, status: "closed" as const,
      closeReason: "all_ready" as const, closedAtMs: now }) : observed.turn;
    return { state: Object.freeze({ ...observed, drafts, turn }), draft: next };
  } catch (error) {
    if (error instanceof MovementDraftFailure) return { state, error: error.code };
    throw error;
  }
}
export function freezeClosureInput(state: TurnState, snapshot: TurnClosureSnapshot, archive: InitialWorldArchive) {
  if (state.turn.status !== "closed") throw new MovementDraftFailure("INTERNAL_ERROR");
  if (canonicalJson(state.config) !== canonicalJson(snapshot.config) || state.turn.gameId !== snapshot.config.gameId ||
      canonicalJson(state.players) !== canonicalJson(snapshot.players) || canonicalJson(state.drafts.map((d) => d.playerId)) !== canonicalJson(snapshot.players.map((p) => p.playerId))) throw new MovementDraftFailure("INTERNAL_ERROR");
  for (const draft of state.drafts) previewMovementDraft(snapshot, archive, draft.playerId, draft.orders);
  return ClosureFrozenInputSchema.parse({ schemaVersion: 2, kind: "turn_closure", runtimeProfile: TURN_CLOSURE_RUNTIME_PROFILE,
    startingSnapshotId: snapshot.snapshotId, startingStateVersion: 0, worldRef: snapshot.worldRef, worldSeed: archive.payload.seed,
    turn: state.turn, players: state.drafts.map((d) => ({ playerId: d.playerId, revision: d.revision, ready: d.ready, orders: d.orders })) });
}
