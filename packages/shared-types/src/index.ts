import { z } from "zod";

// Version 1 is deliberately small. Adding gameplay fields requires an explicit
// contract change, not permissive passthrough of unknown properties.
const version = z.literal(1);
const identifier = z.string().min(1).refine(
  (value) => value.trim() === value,
  "Identifiers must not have surrounding whitespace"
);
const nonnegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveInteger = nonnegativeInteger.min(1);

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

const orders = z.array(OrderSchema).refine(
  (items) => new Set(items.map((order) => order.orderId)).size === items.length,
  "Order IDs must be unique within a submission"
).readonly();

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
  orders
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
  orders
}).readonly();
export type OwnTurnSubmission = z.infer<typeof OwnTurnSubmissionSchema>;
