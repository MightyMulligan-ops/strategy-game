import { describe, expect, it, vi } from "vitest";
import { GameSnapshotSchema, TurnResultSchema } from "@strategy-game/shared-types/server";
import {
  applyTurnCommand, createTurn, freezeTurnInput, observeDeadline, resolveTurn,
  SEEDED_MOVEMENT_POLICY, SIMULATION_VERSION
} from "../src/index.js";

const config = { schemaVersion: 1, gameId: "game-1", turnDurationMs: 1_000 };
const players = [
  { schemaVersion: 1, gameId: "game-1", playerId: "alice", active: true },
  { schemaVersion: 1, gameId: "game-1", playerId: "bob", active: true }
];
const metadata = {
  schemaVersion: 1,
  ruleset: { rulesetId: "baseline", version: "1" },
  simulationVersion: SIMULATION_VERSION
};
const pinned = { ...metadata, movementTieBreakPolicy: SEEDED_MOVEMENT_POLICY };
const move = { orderId: "move-1", type: "move", stackId: "stack-1", destination: { x: 5, y: 2 } };
const attack = { orderId: "attack-1", type: "attack", stackId: "stack-1", targetId: "target-1" };

function fixture() {
  const snapshot = GameSnapshotSchema.parse({
    ...metadata, snapshotId: "initial", config, players, completedTurnNumber: 0, stateVersion: 0
  });
  const closed = observeDeadline(createTurn(config, players, 100), 1_100);
  return { snapshot, closed, frozen: freezeTurnInput(closed, snapshot) };
}

describe("empty turn resolution", () => {
  it("advances once and emits a versioned, auditable event without actions", () => {
    const { snapshot, frozen } = fixture();
    const outcome = resolveTurn(snapshot, frozen, pinned, 42);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const result = TurnResultSchema.parse(outcome.result);
    expect(result.nextState).toMatchObject({ completedTurnNumber: 1, stateVersion: 1, config, players });
    expect(result.orderResults).toEqual([]);
    expect(result.domainEvents).toEqual([expect.objectContaining({
      ...metadata, type: "turn_resolved", resolutionId: result.resolutionId,
      startingSnapshotId: snapshot.snapshotId, nextSnapshotId: result.nextState.snapshotId,
      gameId: config.gameId, turnNumber: 1, stateVersion: 1
    })]);
    expect(result.resolutionId).toMatch(/^resolution:[a-f0-9]{64}$/);
    expect(result.domainEvents[0]?.eventId).toBe(`${result.resolutionId}:event:1`);
    expect(result.phases).toEqual(["validate_inputs", "check_supported_orders", "advance_empty_state", "emit_audit_event"]);
  });

  it("replays byte-for-byte after JSON serialization and ignores object-key insertion order", () => {
    const { snapshot, frozen } = fixture();
    const first = resolveTurn(snapshot, frozen, pinned, 0);
    expect(JSON.stringify(resolveTurn(JSON.parse(JSON.stringify(snapshot)), JSON.parse(JSON.stringify(frozen)), pinned, 0)))
      .toBe(JSON.stringify(first));
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
    expect(resolveTurn(reordered, frozen, pinned, 0)).toEqual(first);
    expect(resolveTurn(snapshot, frozen, pinned, 1)).not.toEqual(first);
  });

  it("does not read wall-clock time or uncontrolled randomness", () => {
    const { snapshot, frozen } = fixture();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Clock read"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Random read"); });
    try {
      expect(resolveTurn(snapshot, frozen, pinned, 42).ok).toBe(true);
    } finally {
      clock.mockRestore();
      random.mockRestore();
    }
  });

  it("does not mutate or freeze caller-owned inputs, and freezes nested outputs", () => {
    const fixtureData = fixture();
    const snapshot = JSON.parse(JSON.stringify(fixtureData.snapshot));
    const frozen = JSON.parse(JSON.stringify(fixtureData.frozen));
    const inputsBefore = JSON.stringify({ snapshot, frozen, pinned });
    const outcome = resolveTurn(snapshot, frozen, pinned, 42);
    expect(JSON.stringify({ snapshot, frozen, pinned })).toBe(inputsBefore);
    expect(Object.isFrozen(snapshot)).toBe(false);
    expect(Object.isFrozen(frozen)).toBe(false);
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(() => Object.assign(outcome.result.nextState.config, { turnDurationMs: 2 })).toThrow();
    expect(() => Object.assign(outcome.result.domainEvents[0] ?? {}, { type: "forged" })).toThrow();
  });

  it("rejects replaying an old frozen turn against its output snapshot", () => {
    const { snapshot, frozen } = fixture();
    const first = resolveTurn(snapshot, frozen, pinned, 42);
    if (!first.ok) throw new Error(first.error.message);
    expect(resolveTurn(first.result.nextState, frozen, pinned, 42))
      .toMatchObject({ ok: false, error: { code: "snapshot_mismatch" } });
  });

  it("resolves a later empty turn without scheduling the next opening", () => {
    const { snapshot, frozen } = fixture();
    const first = resolveTurn(snapshot, frozen, pinned, 42);
    if (!first.ok) throw new Error(first.error.message);
    const secondFrozen = {
      ...frozen, startingSnapshotId: first.result.nextState.snapshotId,
      turn: { ...frozen.turn, turnNumber: 2, openedAtMs: 2_000, deadlineAtMs: 3_000, closedAtMs: 3_000 }
    };
    expect(resolveTurn(first.result.nextState, secondFrozen, pinned, 43)).toMatchObject({
      ok: true, result: { nextState: { completedTurnNumber: 2, stateVersion: 2 } }
    });
  });
});

describe("frozen input capture", () => {
  it("requires closure and the matching snapshot/roster/configuration", () => {
    const { snapshot, closed } = fixture();
    expect(() => freezeTurnInput(createTurn(config, players, 100), snapshot)).toThrow();
    expect(() => freezeTurnInput(closed, { ...snapshot, completedTurnNumber: 1 })).toThrow();
    expect(() => freezeTurnInput(closed, { ...snapshot, config: { ...config, turnDurationMs: 2_000 } })).toThrow();
    expect(() => freezeTurnInput(closed, { ...snapshot, players: [{ ...players[0], playerId: "charlie" }] })).toThrow();
  });

  it("freezes the final reordered queue with original IDs after early Ready closure", () => {
    const { snapshot } = fixture();
    const secondMove = { ...move, orderId: "move-2" };
    let state = createTurn(config, players, 100);
    const send = (playerId: string, expectedRevision: number, action: Record<string, unknown>) => {
      const result = applyTurnCommand(state, playerId, {
        schemaVersion: 1, gameId: config.gameId, turnNumber: 1, expectedRevision, ...action
      }, 101);
      expect(result.accepted).toBe(true);
      state = result.state;
    };
    send("alice", 0, { kind: "replace_orders", orders: [move, secondMove] });
    send("alice", 1, { kind: "set_ready", ready: true });
    send("alice", 2, { kind: "replace_orders", orders: [secondMove, move] });
    expect(state.drafts[0]?.ready).toBe(false);
    send("alice", 3, { kind: "set_ready", ready: true });
    send("bob", 0, { kind: "set_ready", ready: true });
    const frozen = freezeTurnInput(state, snapshot);
    expect(frozen.turn).toMatchObject({ status: "closed", closeReason: "all_ready" });
    expect(frozen.playerOrders[0]?.orders.map((order) => order.orderId)).toEqual(["move-2", "move-1"]);
    expect(frozen.playerOrders[0]?.revision).toBe(4);
    expect(() => Object.assign(frozen.playerOrders[0]?.orders[0] ?? {}, { orderId: "changed" })).toThrow();
  });
});

describe("typed resolution rejections", () => {
  it.each([{ orders: [move] }, { orders: [attack] }, { orders: [move, attack] }])("rejects every unsupported order without advancing state: %#", ({ orders }) => {
    const { snapshot, frozen } = fixture();
    const input = { ...frozen, playerOrders: [{ playerId: "alice", revision: 1, orders }, frozen.playerOrders[1]] };
    const outcome = resolveTurn(snapshot, input, pinned, 42);
    expect(outcome).toMatchObject({ ok: false, error: { code: "unsupported_orders" } });
    if (outcome.ok || outcome.error.code !== "unsupported_orders") throw new Error("Expected unsupported orders");
    expect(outcome.error.orderResults.map((result) => result.orderId)).toEqual(orders.map((order) => order.orderId));
    expect(outcome.error.orderResults.every((result) => result.status === "rejected" && result.reason === "unsupported_order"))
      .toBe(true);
    expect(outcome.error.orderResults[0]).toMatchObject(metadata);
    expect(outcome).not.toHaveProperty("result");
    expect(snapshot.completedTurnNumber).toBe(0);
    expect(resolveTurn(snapshot, input, pinned, 42)).toEqual(outcome);
  });

  it.each([
    { ruleset: { rulesetId: "different", version: "1" } },
    { ruleset: { rulesetId: "baseline", version: "2" } },
    { simulationVersion: "future-simulation" },
    { movementTieBreakPolicy: "future-policy" }
  ])("rejects incompatible pinned metadata %#", (change) => {
    const { snapshot, frozen } = fixture();
    expect(resolveTurn(snapshot, frozen, { ...pinned, ...change }, 42))
      .toMatchObject({ ok: false, error: { code: "version_mismatch" } });
  });

  it("rejects frozen/snapshot metadata that differs from the pin", () => {
    const { snapshot, frozen } = fixture();
    expect(resolveTurn({ ...snapshot, simulationVersion: "old" }, frozen, pinned, 42))
      .toMatchObject({ ok: false, error: { code: "version_mismatch" } });
    expect(resolveTurn(snapshot, { ...frozen, ruleset: { rulesetId: "baseline", version: "old" } }, pinned, 42))
      .toMatchObject({ ok: false, error: { code: "version_mismatch" } });
  });

  it("rejects mismatched snapshots, deadlines, and omitted/inactive queues", () => {
    const { snapshot, frozen } = fixture();
    const badInputs = [
      { ...frozen, startingSnapshotId: "wrong" },
      { ...frozen, turn: { ...frozen.turn, gameId: "other" } },
      { ...frozen, turn: { ...frozen.turn, turnNumber: 2 } },
      { ...frozen, turn: { ...frozen.turn, deadlineAtMs: 1_101, closedAtMs: 1_101 } },
      { ...frozen, playerOrders: [] },
      { ...frozen, playerOrders: [{ playerId: "outsider", revision: 0, orders: [] }, frozen.playerOrders[1]] }
    ];
    for (const input of badInputs) {
      expect(resolveTurn(snapshot, input, pinned, 42)).toMatchObject({ ok: false, error: { code: "snapshot_mismatch" } });
    }
  });

  it("rejects malformed frozen inputs, schema versions, and seeds without throwing", () => {
    const { snapshot, frozen } = fixture();
    const badInputs = [
      null, {}, { ...frozen, schemaVersion: 2 }, { ...frozen, submittedAtMs: 50 },
      { ...frozen, turn: { ...frozen.turn, status: "open" } },
      { ...frozen, playerOrders: [frozen.playerOrders[0], frozen.playerOrders[0]] },
      { ...frozen, playerOrders: [{ playerId: "alice", revision: -1, orders: [] }] },
      { ...frozen, playerOrders: [{ playerId: "alice", revision: 0, orders: [{ ...move, destination: { x: Infinity, y: 0 } }] }] }
    ];
    for (const input of badInputs) {
      expect(resolveTurn(snapshot, input, pinned, 42)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    for (const seed of [-1, 1.5, NaN, Infinity, "42", 0x1_0000_0000]) {
      expect(resolveTurn(snapshot, frozen, pinned, seed)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(resolveTurn({ ...snapshot, units: [{ id: "must-not-be-dropped" }] }, frozen, pinned, 42))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("fails safely instead of overflowing the state version", () => {
    const { snapshot, frozen } = fixture();
    expect(resolveTurn({ ...snapshot, stateVersion: Number.MAX_SAFE_INTEGER }, frozen, pinned, 42))
      .toMatchObject({ ok: false, error: { code: "counter_overflow" } });
  });
});
