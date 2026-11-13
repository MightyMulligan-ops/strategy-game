import { MovementDraftCommandSchema, MovementDraftOrdersSchema, MovementRouteSchema } from "@strategy-game/shared-types";
import { MOVEMENT_DRAFT_RUNTIME_PROFILE, MovementDraftRuntimeProfileSchema, MovementDraftSnapshotSchema } from "@strategy-game/shared-types/server";
import type { MovementDraftErrorCode, MovementDraftOrder, MovementRoute } from "@strategy-game/shared-types";
import type { InitialWorldArchive, MovementDraftSnapshot } from "@strategy-game/shared-types/server";
import type { PlayerTurnDraft } from "./turn.js";
import { createTurn } from "./turn.js";
import { planInitialArmies } from "./initial-armies.js";
import { auditHash, canonicalJson } from "./determinism.js";
import { evaluateStartingFootMovement, geographicDistance } from "./army-movement.js";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export class MovementDraftFailure extends Error {
  constructor(readonly code: MovementDraftErrorCode) { super(code); }
}
export function planMovementDrafts(config: unknown, players: unknown, archive: unknown, runtime: unknown = MOVEMENT_DRAFT_RUNTIME_PROFILE) {
  const profile = MovementDraftRuntimeProfileSchema.parse(runtime);
  const base = planInitialArmies(config, players, archive);
  const { snapshotId: initialArmiesSnapshotId, ...army } = base.snapshot;
  const metadata = { ...army, schemaVersion: 4 as const, kind: "movement_drafts" as const,
    ruleset: profile.ruleset, simulationVersion: profile.simulationVersion, initialArmiesSnapshotId };
  return freeze({ runtimeProfile: profile, snapshot: MovementDraftSnapshotSchema.parse({ ...metadata,
    snapshotId: `movement-drafts:${auditHash({ snapshot: metadata, runtimeProfile: profile })}` }) });
}
export function initializeMovementDrafts(config: unknown, players: unknown, archive: unknown, openedAtMs: number, runtime: unknown = MOVEMENT_DRAFT_RUNTIME_PROFILE) {
  const plan = planMovementDrafts(config, players, archive, runtime);
  return freeze({ ...plan, state: createTurn(plan.snapshot.config, plan.snapshot.players, openedAtMs) });
}
export function validateMovementDraftSnapshot(input: unknown, archive: unknown, runtime: unknown = MOVEMENT_DRAFT_RUNTIME_PROFILE) {
  const snapshot = MovementDraftSnapshotSchema.parse(input);
  const expected = planMovementDrafts(snapshot.config, snapshot.players, archive, runtime).snapshot;
  if (canonicalJson(expected) !== canonicalJson(snapshot)) throw new MovementDraftFailure("INTERNAL_ERROR");
  return freeze(snapshot);
}
/** Complete candidate assessment. Authoritative positions, unit membership and source never change. */
export function previewMovementDraft(snapshot: MovementDraftSnapshot, archive: InitialWorldArchive, actor: string, input: unknown): MovementRoute {
  const parsed = MovementDraftOrdersSchema.safeParse(input);
  const formation = snapshot.formations.find((f) => f.ownerPlayerId === actor);
  if (!parsed.success || !formation || parsed.data.some((o) => o.stackId !== formation.formationId)) throw new MovementDraftFailure("INVALID_DRAFT");
  const members = formation.unitIds.map((id) => snapshot.units.find((u) => u.unitId === id)!);
  if (members.length !== 6 || members.some((m) => !m || m.ownerPlayerId !== actor) || members.filter((m) => m.kind === "LEADER").length !== 1 || members.filter((m) => m.kind === "INFANTRY").length !== 5) throw new MovementDraftFailure("INVALID_DRAFT");
  const destinations = parsed.data.map((o) => o.destination);
  if (destinations.length && !evaluateStartingFootMovement({ ownerPlayerId: actor, from: formation.position, destinations, bounds: archive.payload.bounds, members }).eligible) throw new MovementDraftFailure("INVALID_DRAFT");
  let from = formation.position, distance = 0;
  const segments = parsed.data.map((order, index) => {
    const length = geographicDistance(from, order.destination); distance += length;
    const segment = { orderId: order.orderId, moveNumber: index + 1, from: { ...from }, destination: { ...order.destination }, distance: length, cumulative: distance };
    from = order.destination; return segment;
  });
  return freeze(MovementRouteSchema.parse({ formationId: formation.formationId, range: 250, distance, remaining: 250 - distance, segments }));
}
/** No lifecycle observation/closure. Callers supply one trusted sample after serialization. */
export function reviseMovementDraft(snapshot: MovementDraftSnapshot, archive: InitialWorldArchive, draft: PlayerTurnDraft,
  input: unknown, now: number, openedAtMs: number, deadlineAtMs: number) {
  const parsed = MovementDraftCommandSchema.safeParse(input);
  if (!parsed.success) throw new MovementDraftFailure("INVALID_REQUEST");
  const command = parsed.data;
  if (command.gameId !== snapshot.config.gameId || command.turnNumber !== 1) throw new MovementDraftFailure("WRONG_TURN");
  if (!Number.isSafeInteger(now) || now < openedAtMs || !Number.isSafeInteger(deadlineAtMs)) throw new MovementDraftFailure("INTERNAL_ERROR");
  if (now >= deadlineAtMs) throw new MovementDraftFailure("DEADLINE_PASSED");
  if (draft.ready) throw new MovementDraftFailure("INTERNAL_ERROR");
  if (command.expectedRevision !== draft.revision) throw new MovementDraftFailure("STALE_REVISION");
  if (draft.revision === Number.MAX_SAFE_INTEGER) throw new MovementDraftFailure("REVISION_EXHAUSTED");
  if (command.kind === "cancel_order" && !draft.orders.some((o) => o.orderId === command.orderId)) throw new MovementDraftFailure("ORDER_NOT_FOUND");
  const orders = (command.kind === "replace_orders" ? command.orders : draft.orders.filter((o) => o.orderId !== command.orderId)) as readonly MovementDraftOrder[];
  const route = previewMovementDraft(snapshot, archive, draft.playerId, orders);
  return freeze({ draft: { playerId: draft.playerId, revision: draft.revision + 1, ready: false, orders }, route });
}
