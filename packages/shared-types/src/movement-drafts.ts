import { z } from "zod";
import { MoveOrderSchema, TurnRecordSchema } from "./index.js";
import { FormationIdSchema } from "./formations-view.js";
import { WorldPointSchema } from "./world-geometry.js";
import { identifier, nonnegativeInteger, positiveInteger, version } from "./primitives.js";

// A narrower production boundary; the historical generic order contracts stay unchanged.
export const MovementDraftOrderSchema = z.lazy(() => MoveOrderSchema.unwrap().extend({
  orderId: identifier.max(128), stackId: FormationIdSchema, destination: WorldPointSchema
}).readonly());
export const MovementDraftOrdersSchema = z.array(MovementDraftOrderSchema).refine(
  (orders) => new Set(orders.map((o) => o.orderId)).size === orders.length, "Duplicate order IDs"
).readonly();
const revision = { schemaVersion: version, expectedRevision: nonnegativeInteger };
export const MovementDraftRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...revision, kind: z.literal("replace_orders"), orders: MovementDraftOrdersSchema }).readonly(),
  z.strictObject({ ...revision, kind: z.literal("cancel_order"), orderId: identifier.max(128) }).readonly()
]);
export const MovementDraftPathSchema = z.strictObject({ matchId: identifier.max(128), turnNumber: positiveInteger }).readonly();
const command = { ...revision, gameId: identifier.max(128), turnNumber: z.literal(1) };
export const MovementDraftCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...command, kind: z.literal("replace_orders"), orders: MovementDraftOrdersSchema }).readonly(),
  z.strictObject({ ...command, kind: z.literal("cancel_order"), orderId: identifier.max(128) }).readonly()
]);
export const MovementRouteSchema = z.strictObject({
  formationId: FormationIdSchema, range: z.literal(250), distance: z.number().finite().min(0).max(250),
  remaining: z.number().finite().min(0).max(250),
  segments: z.array(z.strictObject({ orderId: identifier.max(128), moveNumber: positiveInteger,
    from: WorldPointSchema, destination: WorldPointSchema,
    distance: z.number().finite().min(0).max(250), cumulative: z.number().finite().min(0).max(250)
  }).readonly()).readonly()
}).readonly();
export const MovementDraftReadySchema = z.strictObject({
  schemaVersion: version, matchId: identifier.max(128), state: z.literal("READY"),
  turn: z.lazy(() => TurnRecordSchema), own: z.strictObject({ schemaVersion: version, gameId: identifier.max(128),
    turnNumber: z.literal(1), revision: nonnegativeInteger, ready: z.literal(false), orders: MovementDraftOrdersSchema }).readonly(),
  route: MovementRouteSchema
}).superRefine((view, ctx) => {
  const { orders } = view.own;
  if (view.turn.gameId !== view.matchId || view.own.gameId !== view.matchId || view.turn.turnNumber !== 1 || view.turn.status !== "open" ||
    view.route.segments.length !== orders.length || view.route.segments.some((s, i) => s.moveNumber !== i + 1 ||
      s.orderId !== orders[i]!.orderId || orders[i]!.stackId !== view.route.formationId ||
      s.destination.x !== orders[i]!.destination.x || s.destination.y !== orders[i]!.destination.y ||
      (i > 0 && (s.from.x !== view.route.segments[i - 1]!.destination.x || s.from.y !== view.route.segments[i - 1]!.destination.y)) ||
      s.distance !== Math.sqrt((s.destination.x - s.from.x) ** 2 + (s.destination.y - s.from.y) ** 2) ||
      s.cumulative !== (i === 0 ? 0 : view.route.segments[i - 1]!.cumulative) + s.distance) ||
    view.route.distance !== (view.route.segments.at(-1)?.cumulative ?? 0) || view.route.remaining !== 250 - view.route.distance) {
    ctx.addIssue({ code: "custom", message: "Inconsistent own movement preview" });
  }
}).readonly();
export const ReadMovementDraftSchema = z.union([MovementDraftReadySchema,
  z.strictObject({ schemaVersion: version, matchId: identifier.max(128), state: z.enum(["NOT_STARTED", "UNINITIALIZED", "UNSUPPORTED"]) }).readonly()
]);
export const MovementDraftErrorSchema = z.strictObject({ schemaVersion: version,
  error: z.enum(["UNAUTHENTICATED", "USERNAME_REQUIRED", "NOT_FOUND", "INVALID_REQUEST", "INVALID_DRAFT", "INVALID_ORIGIN", "CSRF_REJECTED",
    "RATE_LIMITED", "INTERNAL_ERROR", "UNSUPPORTED_RUNTIME", "TURN_UNAVAILABLE", "WRONG_TURN", "DEADLINE_PASSED", "STALE_REVISION", "ORDER_NOT_FOUND", "REVISION_EXHAUSTED", "READY_LOCKED", "READY_UNCHANGED", "TURN_CLOSED"])
}).readonly();
export type MovementDraftRequest = z.infer<typeof MovementDraftRequestSchema>;
export type MovementDraftCommand = z.infer<typeof MovementDraftCommandSchema>;
export type MovementDraftOrder = z.infer<typeof MovementDraftOrderSchema>;
export type MovementDraftReady = z.infer<typeof MovementDraftReadySchema>;
export type ReadMovementDraft = z.infer<typeof ReadMovementDraftSchema>;
export type MovementRoute = z.infer<typeof MovementRouteSchema>;
export type MovementDraftErrorCode = z.infer<typeof MovementDraftErrorSchema>["error"];

// Explicit new transport version; the historical v1 OPEN/unready contract is not widened.
export const ClosureMovementReadySchema = z.strictObject({ ...MovementDraftReadySchema.unwrap().shape,
  schemaVersion: z.literal(2), own: z.strictObject({ ...MovementDraftReadySchema.unwrap().shape.own.unwrap().shape, ready: z.boolean() }).readonly()
}).superRefine((view, ctx) => {
  if ((view.turn.status !== "open" && view.turn.status !== "closed") || !MovementDraftReadySchema.safeParse({ ...view,
    schemaVersion: 1, turn: { schemaVersion: 1, gameId: view.turn.gameId, turnNumber: view.turn.turnNumber, status: "open",
      openedAtMs: view.turn.openedAtMs, deadlineAtMs: view.turn.deadlineAtMs }, own: { ...view.own, ready: false } }).success) {
    ctx.addIssue({ code: "custom", message: "Invalid closure movement projection" });
  }
}).readonly();
export const ReadMovementQueueSchema = z.union([ReadMovementDraftSchema, ClosureMovementReadySchema]);
export type ReadMovementQueue = z.infer<typeof ReadMovementQueueSchema>;
