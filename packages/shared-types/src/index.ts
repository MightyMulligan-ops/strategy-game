import { z } from "zod";
export { ArmyUnitIdSchema, FormationIdSchema, OwnFormationUnitSchema, OwnFormationSchema, ReadFormationsRequestSchema, ReadFormationsResponseSchema } from "./formations-view.js";
export type { ReadFormationsResponse, OwnFormation } from "./formations-view.js";
export { ReadWorldRequestSchema, ReadWorldResponseSchema, PublicWorldSchema } from "./world-view.js";
export type { ReadWorldResponse, PublicWorld } from "./world-view.js";
import { identifier, nonnegativeInteger, positiveInteger, version } from "./primitives.js";
export { AuthenticatedPlayerSchema, OAuthProviderSchema, UsernameSchema, UsernameSelectionSchema } from "./auth.js";
export type { AuthenticatedPlayer, OAuthProvider } from "./auth.js";
export {
  LOBBY_TURN_DURATION_PRESETS_MS, classifyLobbyTurnDuration, lobbyActionRequestSchema,
  LobbyCapacitySchema, LobbyStatusSchema, LobbyDurationCategorySchema, LobbySettingsSchema,
  LobbyParticipantSchema, LobbyViewerSchema, LobbySummarySchema, LobbyDetailSchema,
  CreateLobbyRequestSchema, ListLobbiesRequestSchema, ViewLobbyRequestSchema,
  JoinLobbyRequestSchema, LeaveLobbyRequestSchema, StartLobbyRequestSchema, SetLobbyReadyRequestSchema,
  CreateLobbyResponseSchema, ListLobbiesResponseSchema, ViewLobbyResponseSchema,
  JoinLobbyResponseSchema, LeaveLobbyResponseSchema, StartLobbyResponseSchema, SetLobbyReadyResponseSchema, LobbyErrorResponseSchema
} from "./lobby.js";
export type {
  LobbyDurationCategory, LobbySettings, LobbyParticipant, LobbyViewer, LobbySummary, LobbyDetail,
  CreateLobbyRequest, ListLobbiesRequest, ViewLobbyRequest, JoinLobbyRequest, LeaveLobbyRequest, StartLobbyRequest,
  CreateLobbyResponse, ListLobbiesResponse, ViewLobbyResponse, JoinLobbyResponse, LeaveLobbyResponse,
  StartLobbyResponse, SetLobbyReadyRequest, SetLobbyReadyResponse, LobbyErrorResponse
} from "./lobby.js";

// Version 1 is deliberately small. Adding gameplay fields requires an explicit
// contract change, not permissive passthrough of unknown properties.
export const GameConfigSchema = z.strictObject({
  schemaVersion: version,
  gameId: identifier,
  turnDurationMs: positiveInteger
}).readonly();
export type GameConfig = z.infer<typeof GameConfigSchema>;

export const GamePlayerSchema = z.strictObject({
  schemaVersion: version,
  gameId: identifier,
  playerId: identifier,
  active: z.boolean()
}).readonly();
export type GamePlayer = z.infer<typeof GamePlayerSchema>;

const turnFields = {
  schemaVersion: version,
  gameId: identifier,
  turnNumber: positiveInteger,
  openedAtMs: nonnegativeInteger,
  deadlineAtMs: nonnegativeInteger
};
const closureFields = {
  closedAtMs: nonnegativeInteger,
  closeReason: z.enum(["deadline", "all_ready"])
};

// Safe lifecycle metadata only: no submissions, account identities, game state,
// random seeds, or resolution inputs belong in this transport record.
export const TurnRecordSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...turnFields, status: z.literal("open") }),
  z.strictObject({ ...turnFields, ...closureFields, status: z.literal("closed") }),
  z.strictObject({ ...turnFields, ...closureFields, status: z.literal("resolving") }),
  z.strictObject({ ...turnFields, ...closureFields, status: z.literal("resolved") })
]).superRefine((turn, context) => {
  if (turn.deadlineAtMs <= turn.openedAtMs) {
    context.addIssue({ code: "custom", message: "Deadline must follow opening" });
  }
  if (turn.status !== "open") {
    const validClosure = turn.closeReason === "deadline"
      ? turn.closedAtMs === turn.deadlineAtMs
      : turn.closedAtMs >= turn.openedAtMs && turn.closedAtMs < turn.deadlineAtMs;
    if (!validClosure) {
      context.addIssue({ code: "custom", message: "Invalid closure time for reason" });
    }
  }
}).readonly();
export type TurnRecord = z.infer<typeof TurnRecordSchema>;

export const MoveOrderSchema = z.strictObject({
  orderId: identifier,
  type: z.literal("move"),
  stackId: identifier,
  destination: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).readonly()
}).readonly();
export type MoveOrder = z.infer<typeof MoveOrderSchema>;

export const AttackOrderSchema = z.strictObject({
  orderId: identifier,
  type: z.literal("attack"),
  stackId: identifier,
  targetId: identifier
}).readonly();
export type AttackOrder = z.infer<typeof AttackOrderSchema>;

export const OrderSchema = z.discriminatedUnion("type", [MoveOrderSchema, AttackOrderSchema]);
export type Order = z.infer<typeof OrderSchema>;

export const OrderListSchema = z.array(OrderSchema).refine(
  (items) => new Set(items.map((order) => order.orderId)).size === items.length,
  "Order IDs must be unique within a submission"
).readonly();

// Derived from the position among moves in a player's ordered draft. Attacks
// never consume a movement number. Do not maintain a second mutable queue index.
export const MovementQueueEntrySchema = z.strictObject({
  playerId: identifier,
  moveNumber: positiveInteger,
  order: MoveOrderSchema
}).readonly();
export type MovementQueueEntry = z.infer<typeof MovementQueueEntrySchema>;

const commandFields = {
  schemaVersion: version,
  gameId: identifier,
  turnNumber: positiveInteger,
  expectedRevision: nonnegativeInteger
};

// Initial submission and subsequent revisions both replace the player's entire
// draft. Empty orders explicitly clear it. Actor identity comes from the server.
export const OrderSubmissionSchema = z.strictObject({
  ...commandFields,
  kind: z.literal("replace_orders"),
  orders: OrderListSchema
}).readonly();
export type OrderSubmission = z.infer<typeof OrderSubmissionSchema>;

export const OrderCancellationSchema = z.strictObject({
  ...commandFields,
  kind: z.literal("cancel_order"),
  orderId: identifier
}).readonly();
export type OrderCancellation = z.infer<typeof OrderCancellationSchema>;

export const ReadyChangeSchema = z.strictObject({
  ...commandFields,
  kind: z.literal("set_ready"),
  ready: z.boolean()
}).readonly();
export type ReadyChange = z.infer<typeof ReadyChangeSchema>;

export const TurnCommandSchema = z.discriminatedUnion("kind", [
  OrderSubmissionSchema, OrderCancellationSchema, ReadyChangeSchema
]);
export type TurnCommand = z.infer<typeof TurnCommandSchema>;

// This is an own-player view, not a public list of all players' draft orders.
// A future authenticated adapter must select the owner before serializing it.
export const OwnTurnSubmissionSchema = z.strictObject({
  schemaVersion: version,
  gameId: identifier,
  turnNumber: positiveInteger,
  revision: nonnegativeInteger,
  ready: z.boolean(),
  orders: OrderListSchema
}).readonly();
export type OwnTurnSubmission = z.infer<typeof OwnTurnSubmissionSchema>;

// 006A transport envelopes reuse the lifecycle schemas above. No server-only
// snapshot, roster, seed or frozen input belongs in this own-player view.
export const ReadTurnRequestSchema = z.strictObject({ schemaVersion: version, matchId: identifier.max(128) }).readonly();
export const SetTurnReadyRequestSchema = z.strictObject({
  schemaVersion: version, expectedRevision: nonnegativeInteger, ready: z.boolean()
}).readonly();
export type SetTurnReadyRequest = z.infer<typeof SetTurnReadyRequestSchema>;
export const TurnReadyPathSchema = z.strictObject({ matchId: identifier.max(128), turnNumber: positiveInteger }).readonly();

export const SetTurnReadyResponseSchema = z.strictObject({
  schemaVersion: version, matchId: identifier.max(128), state: z.literal("READY"),
  turn: TurnRecordSchema, own: OwnTurnSubmissionSchema
}).superRefine((view, context) => {
  if (view.turn.gameId !== view.matchId || view.own.gameId !== view.matchId || view.own.turnNumber !== view.turn.turnNumber) {
    context.addIssue({ code: "custom", message: "Turn and own submission must describe the requested match/turn" });
  }
}).readonly();
export type SetTurnReadyResponse = z.infer<typeof SetTurnReadyResponseSchema>;
export const ReadTurnResponseSchema = z.discriminatedUnion("state", [
  SetTurnReadyResponseSchema,
  z.strictObject({ schemaVersion: version, matchId: identifier.max(128), state: z.enum(["NOT_STARTED", "UNINITIALIZED"]) }).readonly()
]);
export type ReadTurnResponse = z.infer<typeof ReadTurnResponseSchema>;
export const TurnErrorResponseSchema = z.strictObject({
  schemaVersion: version,
  error: z.enum(["UNAUTHENTICATED", "USERNAME_REQUIRED", "NOT_FOUND", "INVALID_REQUEST", "INVALID_ORIGIN", "CSRF_REJECTED",
    "RATE_LIMITED", "INTERNAL_ERROR", "TURN_UNINITIALIZED", "TURN_CLOSED", "WRONG_TURN", "STALE_REVISION", "REVISION_EXHAUSTED"])
}).readonly();
export type TurnErrorResponse = z.infer<typeof TurnErrorResponseSchema>;

export { MovementDraftOrderSchema, MovementDraftOrdersSchema, MovementDraftRequestSchema, MovementDraftPathSchema,
  MovementDraftCommandSchema, MovementRouteSchema, MovementDraftReadySchema, ReadMovementDraftSchema, MovementDraftErrorSchema } from "./movement-drafts.js";
export type { MovementDraftRequest, MovementDraftCommand, MovementDraftOrder, MovementDraftReady, ReadMovementDraft, MovementRoute, MovementDraftErrorCode } from "./movement-drafts.js";

export { ClosureMovementReadySchema, ReadMovementQueueSchema } from "./movement-drafts.js";
export type { ReadMovementQueue } from "./movement-drafts.js";

export { ResolutionMovementReadySchema, ReadMovementPlanSchema } from "./movement-drafts.js";
export type { ReadMovementPlan } from "./movement-drafts.js";
export {ReadFormationViewSchema,ResolvedOwnFormationSchema,ResolutionViewSchema} from "./movement-resolution-view.js";
export type {ReadFormationView,ResolutionView} from "./movement-resolution-view.js";
