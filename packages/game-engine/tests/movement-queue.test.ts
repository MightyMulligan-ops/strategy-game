import { describe, expect, it, vi } from "vitest";
import { groupMovementOrders } from "../src/index.js";

function move(orderId: string) {
  return { orderId, type: "move", stackId: "stack", destination: { x: 1, y: 2 } };
}
const queues = [
  { playerId: "alice", revision: 4, orders: [move("a-1"), { orderId: "attack", type: "attack", stackId: "stack", targetId: "target" }, move("a-2")] },
  { playerId: "bob", revision: 0, orders: [move("b-1"), move("b-2")] },
  { playerId: "charlie", revision: 2, orders: [move("c-1")] }
];

describe("player-relative movement precedence (planning only)", () => {
  it("groups all Move 1 entries before Move 2 and excludes attacks from numbering", () => {
    const groups = groupMovementOrders(queues, 42);
    expect(groups.map((group) => group.moveNumber)).toEqual([1, 2]);
    expect(groups[0]?.moves.map((entry) => entry.order.orderId).sort()).toEqual(["a-1", "b-1", "c-1"]);
    expect(groups[1]?.moves.map((entry) => entry.order.orderId).sort()).toEqual(["a-2", "b-2"]);
    expect(groups.flatMap((group) => group.moves).every((entry) => entry.order.type === "move")).toBe(true);
  });

  it("replays seeded ties and does not depend on player submission/list order", () => {
    expect(groupMovementOrders([...queues].reverse(), 42)).toEqual(groupMovementOrders(queues, 42));
    expect(groupMovementOrders(queues, 42)).toEqual(groupMovementOrders(queues, 42));
    const permutations = new Set(Array.from({ length: 20 }, (_, seed) => JSON.stringify(groupMovementOrders(queues, seed))));
    expect(permutations.size).toBeGreaterThan(1);
  });

  it("pins the seeded-shuffle-v1 sequence so algorithm changes require an explicit version decision", () => {
    const equalQueues = ["alice", "bob", "charlie"].map((playerId) => ({
      playerId, revision: 0, orders: [move(`${playerId}-1`), move(`${playerId}-2`)]
    }));
    expect(groupMovementOrders(equalQueues, 42).map((group) => ({
      moveNumber: group.moveNumber, players: group.moves.map((entry) => entry.playerId)
    }))).toEqual([
      { moveNumber: 1, players: ["charlie", "bob", "alice"] },
      { moveNumber: 2, players: ["bob", "charlie", "alice"] }
    ]);
  });

  it("supports replacing only the within-group policy without changing numbered priority", () => {
    const reversed = groupMovementOrders(queues, 42, (entries) => [...entries].reverse());
    expect(reversed.map((group) => group.moveNumber)).toEqual([1, 2]);
    expect(reversed[0]?.moves.map((entry) => entry.playerId)).toEqual(["charlie", "bob", "alice"]);
    expect(() => groupMovementOrders(queues, 42, () => [])).toThrow("original entries");
    expect(() => groupMovementOrders(queues, 42, (entries) => entries.map(() => entries[0]!))).toThrow("original entries");
  });

  it("renumbers after reorder/cancellation while retaining the surviving order IDs", () => {
    const reordered = [{ playerId: "alice", revision: 5, orders: [move("a-2"), move("a-1")] }];
    expect(groupMovementOrders(reordered, 42).map((group) => [group.moveNumber, group.moves[0]?.order.orderId]))
      .toEqual([[1, "a-2"], [2, "a-1"]]);
    expect(groupMovementOrders([{ ...reordered[0], orders: [move("a-1")] }], 42)[0]?.moves[0])
      .toMatchObject({ moveNumber: 1, order: { orderId: "a-1" } });
  });

  it("handles empty queues, does not mutate inputs, and freezes derived groups", () => {
    const before = JSON.stringify(queues);
    const groups = groupMovementOrders(queues, 0);
    expect(JSON.stringify(queues)).toBe(before);
    expect(Object.isFrozen(queues)).toBe(false);
    expect(() => Object.assign(groups[0]?.moves[0]?.order ?? {}, { orderId: "changed" })).toThrow();
    expect(groupMovementOrders([], 42)).toEqual([]);
    expect(groupMovementOrders([{ playerId: "alice", revision: 0, orders: [] }], 42)).toEqual([]);
  });

  it("rejects duplicate players/order IDs, malformed seeds, and timestamp priority fields", () => {
    expect(() => groupMovementOrders([queues[0], queues[0]], 42)).toThrow();
    expect(() => groupMovementOrders([{ playerId: "alice", revision: 0, orders: [move("same"), move("same")] }], 42)).toThrow();
    expect(() => groupMovementOrders([{ ...queues[0], submittedAtMs: 1 }], 42)).toThrow();
    expect(() => groupMovementOrders(queues, -1)).toThrow();
  });

  it("uses neither wall-clock time nor Math.random for tie-breaking", () => {
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Clock read"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Random read"); });
    try {
      expect(groupMovementOrders(queues, 42)).toHaveLength(2);
    } finally {
      clock.mockRestore();
      random.mockRestore();
    }
  });
});
