import { describe, expect, it } from "vitest";
import {
  AttackOrderSchema,
  GameConfigSchema,
  GamePlayerSchema,
  MoveOrderSchema,
  OrderSubmissionSchema,
  OwnTurnSubmissionSchema,
  TurnCommandSchema,
  TurnRecordSchema
} from "../src/index.js";

const move = {
  orderId: "order-1", type: "move", stackId: "stack-1", destination: { x: 12, y: -4 }
};
const attack = {
  orderId: "order-2", type: "attack", stackId: "stack-2", targetId: "target-1"
};
const submission = {
  schemaVersion: 1, gameId: "game-1", turnNumber: 1,
  expectedRevision: 0, kind: "replace_orders", orders: [move, attack]
};

describe("versioned order contracts", () => {
  it("round-trips a serializable draft with distinct move and attack intents", () => {
    const parsed = OrderSubmissionSchema.parse(JSON.parse(JSON.stringify(submission)));
    expect(parsed.orders.map((order) => order.type)).toEqual(["move", "attack"]);
    expect(parsed).toEqual(submission);
    expect(MoveOrderSchema.safeParse(attack).success).toBe(false);
    expect(AttackOrderSchema.safeParse(move).success).toBe(false);
  });

  it.each([
    null,
    [],
    { ...submission, schemaVersion: 2 },
    { ...submission, turnNumber: 0 },
    { ...submission, expectedRevision: -1 },
    { ...submission, expectedRevision: 0.5 },
    { ...submission, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...submission, playerId: "spoofed-player" },
    { ...submission, serverNowMs: 1 },
    { ...submission, orders: [move, move] },
    { ...submission, orders: [{ ...move, stackId: " " }] },
    { ...submission, orders: [{ ...move, targetId: "target-1" }] },
    { ...submission, orders: [{ ...attack, destination: { x: 1, y: 2 } }] },
    { ...submission, orders: [{ ...move, destination: { x: Infinity, y: 0 } }] },
    { ...submission, orders: [{ ...move, destination: { x: NaN, y: 0 } }] },
    { ...submission, orders: [{ ...move, destination: { x: "12", y: 0 } }] },
    { ...submission, orders: [{ ...move, destination: { x: 12, y: 0, hidden: true } }] },
    { ...submission, orders: [{ ...attack, targetId: undefined }] },
    { ...submission, orders: [{ ...move, type: "teleport" }] }
  ])("rejects malformed or over-permissive input %#", (input) => {
    expect(OrderSubmissionSchema.safeParse(input).success).toBe(false);
  });

  it("supports empty replacement, targeted cancellation, and Ready commands", () => {
    expect(TurnCommandSchema.safeParse({ ...submission, orders: [] }).success).toBe(true);
    const { orders: _orders, ...envelope } = submission;
    expect(TurnCommandSchema.safeParse({ ...envelope, kind: "cancel_order", orderId: "order-1" }).success).toBe(true);
    expect(TurnCommandSchema.safeParse({ ...envelope, kind: "set_ready", ready: false }).success).toBe(true);
    expect(TurnCommandSchema.safeParse({ ...envelope, kind: "set_ready", ready: "true" }).success).toBe(false);
  });

  it("does not admit authoritative or opponent state into transport records", () => {
    const own = {
      schemaVersion: 1, gameId: "game-1", turnNumber: 1, revision: 0, ready: false, orders: []
    };
    expect(OwnTurnSubmissionSchema.safeParse(own).success).toBe(true);
    expect(OwnTurnSubmissionSchema.safeParse({ ...own, opponents: [] }).success).toBe(false);
    expect(GamePlayerSchema.safeParse({
      schemaVersion: 1, gameId: "game-1", playerId: "player-1", active: true, accountId: "private"
    }).success).toBe(false);
  });
});

describe("configuration and turn metadata", () => {
  it.each([1, 60_000, 86_400_000])("accepts configurable duration %i without a balance default", (turnDurationMs) => {
    expect(GameConfigSchema.parse({ schemaVersion: 1, gameId: "game-1", turnDurationMs }).turnDurationMs)
      .toBe(turnDurationMs);
  });

  it.each([0, -1, 1.5, Infinity, NaN, "60000", Number.MAX_SAFE_INTEGER + 1])("rejects invalid duration %s", (turnDurationMs) => {
    expect(GameConfigSchema.safeParse({ schemaVersion: 1, gameId: "game-1", turnDurationMs }).success).toBe(false);
  });

  it("checks lifecycle metadata and rejects impossible closure timestamps", () => {
    const open = {
      schemaVersion: 1, gameId: "game-1", turnNumber: 1,
      openedAtMs: 100, deadlineAtMs: 200, status: "open"
    };
    expect(TurnRecordSchema.safeParse(open).success).toBe(true);
    expect(TurnRecordSchema.safeParse({ ...open, deadlineAtMs: 100 }).success).toBe(false);
    expect(TurnRecordSchema.safeParse({ ...open, drafts: [] }).success).toBe(false);
    expect(TurnRecordSchema.safeParse({ ...open, status: "closed" }).success).toBe(false);
    expect(TurnRecordSchema.safeParse({
      ...open, status: "closed", closeReason: "deadline", closedAtMs: 201
    }).success).toBe(false);
    expect(TurnRecordSchema.safeParse({
      ...open, status: "closed", closeReason: "all_ready", closedAtMs: 200
    }).success).toBe(false);
  });
});
