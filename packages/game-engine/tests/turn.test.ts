import { describe, expect, it } from "vitest";
import { applyTurnCommand, createTurn, observeDeadline, openNextTurn, transitionResolution } from "../src/index.js";
import type { TurnState } from "../src/index.js";

const config = { schemaVersion: 1, gameId: "game-1", turnDurationMs: 1_000 };
const players = [
  { schemaVersion: 1, gameId: "game-1", playerId: "alice", active: true },
  { schemaVersion: 1, gameId: "game-1", playerId: "bob", active: true },
  { schemaVersion: 1, gameId: "game-1", playerId: "spectator", active: false }
];
const move = {
  orderId: "move-1", type: "move", stackId: "stack-1", destination: { x: 5, y: 2 }
};
const attack = {
  orderId: "attack-1", type: "attack", stackId: "stack-2", targetId: "target-1"
};

function initial(duration = 1_000): TurnState {
  return createTurn({ ...config, turnDurationMs: duration }, players, 10_000);
}

function command(state: TurnState, playerId: string, action: Record<string, unknown>, now = 10_001) {
  const revision = state.drafts.find((draft) => draft.playerId === playerId)?.revision ?? 0;
  return applyTurnCommand(state, playerId, {
    schemaVersion: 1, gameId: state.config.gameId, turnNumber: state.turn.turnNumber,
    expectedRevision: revision, ...action
  }, now);
}

function accept(state: TurnState, playerId: string, action: Record<string, unknown>, now = 10_001): TurnState {
  const result = command(state, playerId, action, now);
  expect(result.accepted).toBe(true);
  return result.state;
}

describe("fixed match configuration", () => {
  it.each([1, 60_000, 86_400_000])("preserves duration %i across consecutive turns", (duration) => {
    const first = initial(duration);
    expect(first.turn.deadlineAtMs).toBe(10_000 + duration);
    const closed = observeDeadline(first, first.turn.deadlineAtMs);
    const resolving = transitionResolution(closed, "begin_resolution", closed.lastObservedAtMs);
    const resolved = transitionResolution(resolving, "complete_resolution", resolving.lastObservedAtMs);
    const next = openNextTurn(resolved, resolved.lastObservedAtMs + 20);
    expect(next.config).toEqual(first.config);
    expect(next.turn.turnNumber).toBe(2);
    expect(next.turn.deadlineAtMs - next.turn.openedAtMs).toBe(duration);
    expect(next.drafts.every((draft) => !draft.ready && draft.revision === 0 && draft.orders.length === 0)).toBe(true);
    expect(first.turn.status).toBe("open");
  });

  it("copies and freezes configuration rather than retaining mutable caller input", () => {
    const input = { ...config };
    const state = createTurn(input, players, 10_000);
    input.turnDurationMs = 2_000;
    expect(state.config.turnDurationMs).toBe(1_000);
    expect(() => Object.assign(state.config, { turnDurationMs: 2_000 })).toThrow();
  });

  it("rejects unsafe deadlines and unsupported roster inputs", () => {
    expect(() => createTurn(config, players, Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => createTurn(config, [], 10_000)).toThrow();
    expect(() => createTurn(config, players.map((player) => ({ ...player, active: false })), 10_000)).toThrow();
    expect(() => createTurn(config, [players[0], players[0]], 10_000)).toThrow();
    expect(() => createTurn(config, [{ ...players[0], gameId: "other" }], 10_000)).toThrow();
  });
});

describe("hybrid closure and Ready", () => {
  it("allows Ready and unready while another active player is not Ready", () => {
    const original = initial();
    const ready = accept(original, "alice", { kind: "set_ready", ready: true });
    expect(ready.turn.status).toBe("open");
    expect(ready.drafts[0]?.ready).toBe(true);
    const unready = accept(ready, "alice", { kind: "set_ready", ready: false }, 10_002);
    expect(unready.turn.status).toBe("open");
    expect(unready.drafts[0]?.ready).toBe(false);
    expect(unready.drafts[0]?.revision).toBe(2);
    expect(original.drafts[0]?.ready).toBe(false);
  });

  it("closes immediately on unanimous active readiness, even with no orders", () => {
    const aliceReady = accept(initial(), "alice", { kind: "set_ready", ready: true });
    const closed = accept(aliceReady, "bob", { kind: "set_ready", ready: true }, 10_100);
    expect(closed.turn).toMatchObject({ status: "closed", closeReason: "all_ready", closedAtMs: 10_100 });
    expect(closed.drafts).toHaveLength(2);
    expect(closed.drafts.every((draft) => draft.orders.length === 0)).toBe(true);
    expect(command(closed, "bob", { kind: "set_ready", ready: false }, 10_101))
      .toMatchObject({ accepted: false, reason: "turn_closed" });
  });

  it("closes a one-active-player turn on that player's Ready command", () => {
    const state = createTurn(config, [players[0]], 10_000);
    expect(accept(state, "alice", { kind: "set_ready", ready: true }).turn.status).toBe("closed");
  });

  it("closes at the deadline without submissions, Ready players, or connected clients", () => {
    const state = initial();
    expect(observeDeadline(state, 10_999).turn.status).toBe("open");
    const closed = observeDeadline(state, 12_000);
    expect(closed.turn).toMatchObject({ status: "closed", closeReason: "deadline", closedAtMs: 11_000 });
    expect(closed.drafts.every((draft) => draft.orders.length === 0)).toBe(true);
    expect(observeDeadline(closed, 13_000).turn).toEqual(closed.turn);
  });

  it("rejects a command at the exact deadline and does not let final Ready supersede it", () => {
    const state = accept(initial(), "alice", { kind: "set_ready", ready: true });
    const result = command(state, "bob", { kind: "set_ready", ready: true }, 11_000);
    expect(result).toMatchObject({ accepted: false, reason: "turn_closed" });
    expect(result.state.turn).toMatchObject({ closeReason: "deadline", closedAtMs: 11_000 });
    expect(result.state.drafts[1]?.ready).toBe(false);
  });

  it("keeps an early closure when the deadline is observed later", () => {
    let state = accept(initial(), "alice", { kind: "set_ready", ready: true });
    state = accept(state, "bob", { kind: "set_ready", ready: true }, 10_100);
    expect(observeDeadline(state, 11_000).turn).toEqual(state.turn);
  });
});

describe("order draft revisions", () => {
  it("replaces and cancels orders, clears Ready, and leaves previous snapshots unchanged", () => {
    const original = initial();
    const submitted = accept(original, "alice", { kind: "replace_orders", orders: [move, attack] });
    expect(original.drafts[0]?.orders).toEqual([]);
    expect(submitted.drafts[0]?.orders.map((order) => order.type)).toEqual(["move", "attack"]);
    expect(submitted.turn).toEqual(original.turn);
    const ready = accept(submitted, "alice", { kind: "set_ready", ready: true }, 10_002);
    const revised = accept(ready, "alice", {
      kind: "replace_orders", orders: [{ ...move, destination: { x: 7, y: 8 } }, attack]
    }, 10_003);
    expect(revised.drafts[0]).toMatchObject({ ready: false, revision: 3 });
    const readyAgain = accept(revised, "alice", { kind: "set_ready", ready: true }, 10_004);
    const cancelled = accept(readyAgain, "alice", { kind: "cancel_order", orderId: "attack-1" }, 10_005);
    expect(cancelled.drafts[0]).toMatchObject({ ready: false, revision: 5, orders: [{ type: "move" }] });
    expect(submitted.drafts[0]?.orders).toHaveLength(2);
    expect(accept(cancelled, "alice", { kind: "replace_orders", orders: [] }, 10_006).drafts[0]?.orders).toEqual([]);
  });

  it("rejects stale edits without overwriting newer orders or readiness", () => {
    const state = accept(initial(), "alice", { kind: "replace_orders", orders: [move] });
    const result = command(state, "alice", { kind: "replace_orders", orders: [attack], expectedRevision: 0 }, 10_002);
    expect(result).toMatchObject({ accepted: false, reason: "stale_revision" });
    expect(result.state.drafts).toEqual(state.drafts);
  });

  it("accepts an order just before the deadline and freezes it against late cancellation", () => {
    const input = { ...move, destination: { x: 5, y: 2 } };
    const state = accept(initial(), "alice", { kind: "replace_orders", orders: [input] }, 10_999);
    input.destination.x = 999;
    expect(state.drafts[0]?.orders[0]).toEqual(move);
    const result = command(state, "alice", { kind: "cancel_order", orderId: "move-1" }, 11_000);
    expect(result).toMatchObject({ accepted: false, reason: "turn_closed" });
    expect(result.state.drafts).toEqual(state.drafts);
  });

  it("rejects cancellation of a missing order without clearing Ready", () => {
    const state = accept(initial(), "alice", { kind: "set_ready", ready: true });
    const result = command(state, "alice", { kind: "cancel_order", orderId: "missing" }, 10_002);
    expect(result).toMatchObject({ accepted: false, reason: "order_not_found" });
    expect(result.state.drafts).toEqual(state.drafts);
  });

  it.each([
    { kind: "replace_orders", orders: [move] },
    { kind: "cancel_order", orderId: "move-1" },
    { kind: "set_ready", ready: false }
  ])("rejects commands in every closed lifecycle state: $kind", (action) => {
    const closed = observeDeadline(initial(), 11_000);
    const resolving = transitionResolution(closed, "begin_resolution", 11_000);
    const resolved = transitionResolution(resolving, "complete_resolution", 11_000);
    for (const state of [closed, resolving, resolved]) {
      const result = command(state, "alice", action, 11_001);
      expect(result).toMatchObject({ accepted: false, reason: "turn_closed" });
      expect(result.state.drafts).toEqual(state.drafts);
    }
  });

  it("rejects malformed inputs, wrong turns, inactive actors, and actor spoofing", () => {
    const state = initial();
    expect(applyTurnCommand(state, "alice", null, 10_001)).toMatchObject({ accepted: false, reason: "invalid_command" });
    expect(command(state, "alice", { kind: "set_ready", ready: true, turnNumber: 2 }))
      .toMatchObject({ accepted: false, reason: "wrong_turn" });
    expect(command(state, "alice", { kind: "set_ready", ready: true, gameId: "other" }))
      .toMatchObject({ accepted: false, reason: "wrong_turn" });
    for (const actor of ["spectator", "unknown"]) {
      expect(command(state, actor, { kind: "set_ready", ready: true }))
        .toMatchObject({ accepted: false, reason: "inactive_player" });
    }
    expect(command(state, "alice", { kind: "set_ready", ready: true, playerId: "bob" }))
      .toMatchObject({ accepted: false, reason: "invalid_command" });
  });
});

describe("lifecycle transition guards and determinism", () => {
  it("permits only closed -> resolving -> resolved, then a new open record", () => {
    const open = initial();
    expect(() => transitionResolution(open, "begin_resolution", 10_001)).toThrow();
    expect(() => transitionResolution(open, "begin_resolution", 11_000)).toThrow();
    expect(() => transitionResolution(open, "complete_resolution", 10_001)).toThrow();
    expect(() => openNextTurn(open, 10_001)).toThrow();
    const closed = observeDeadline(open, 11_000);
    expect(() => transitionResolution(closed, "complete_resolution", 11_000)).toThrow();
    const resolving = transitionResolution(closed, "begin_resolution", 11_000);
    expect(() => transitionResolution(resolving, "begin_resolution", 11_000)).toThrow();
    expect(() => openNextTurn(resolving, 11_000)).toThrow();
    const resolved = transitionResolution(resolving, "complete_resolution", 11_000);
    expect(() => transitionResolution(resolved, "complete_resolution", 11_000)).toThrow();
    expect(openNextTurn(resolved, 11_001).turn.status).toBe("open");
    expect(resolved.drafts).toEqual(closed.drafts);
  });

  it("normalizes roster input order without choosing a gameplay initiative", () => {
    expect(createTurn(config, [...players].reverse(), 10_000)).toEqual(initial());
  });

  it("produces the same frozen result for the same inputs and rejects backwards time", () => {
    const state = initial();
    const action = { kind: "replace_orders", orders: [move, attack] };
    expect(command(state, "alice", action)).toEqual(command(state, "alice", action));
    const result = accept(state, "alice", action);
    const firstOrder = result.drafts[0]?.orders[0];
    if (firstOrder?.type !== "move") throw new Error("Expected a move order fixture");
    expect(() => Object.assign(firstOrder.destination, { x: 999 })).toThrow();
    expect(() => observeDeadline(result, 10_000)).toThrow();
    expect(() => observeDeadline(state, NaN)).toThrow();
    expect(() => observeDeadline(state, 10_000.5)).toThrow();
  });
});
