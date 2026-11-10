import { describe, expect, it } from "vitest";
import { createTurn, observeDeadline } from "@strategy-game/game-engine";
import { createDatabaseClient } from "../src/client.js";
import { testDatabaseUrl } from "../src/environment.js";
import { orderRows, restoreDraft, restoreTurnRecord, safeNumber, turnFields } from "../src/mappings.js";
import type { PlayerOrder } from "../src/generated/prisma/client.js";

const move = (orderId: string) => ({ orderId, type: "move" as const, stackId: "stack", destination: { x: 5, y: 2 } });
const attack = { orderId: "attack", type: "attack" as const, stackId: "stack", targetId: "target" };
const draft = { playerId: "alice", revision: 3, ready: false, orders: [move("first"), attack, move("second")] };
function stored() {
  const orders = orderRows("game", 1, draft) as PlayerOrder[];
  return { matchId: "game", turnNumber: 1n, playerId: "alice", active: true, revision: 3n, ready: false, orders };
}

describe("database mappings (no database connection)", () => {
  it("preserves draft position separately from movement number and attack intent", () => {
    const before = JSON.stringify(draft);
    const rows = orderRows("game", 1, draft);
    expect(rows.map((row) => [row.orderId, row.kind, row.draftPosition, row.moveNumber]))
      .toEqual([["first", "MOVE", 1, 1], ["attack", "ATTACK", 2, null], ["second", "MOVE", 3, 2]]);
    expect(rows.every((row) => row.lastRevision === 3n)).toBe(true);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("restores by explicit position, regardless of row arrival order", () => {
    const row = stored();
    expect(restoreDraft({ ...row, orders: [...row.orders].reverse() })).toEqual(draft);
    expect(restoreDraft({ ...row, orders: [...row.orders, { ...row.orders[0]!, orderId: "canceled", active: false, draftPosition: null, moveNumber: null }] })).toEqual(draft);
  });

  it("renumbers reordered/canceled movements without changing their IDs", () => {
    const rows = orderRows("game", 1, { ...draft, revision: 4, orders: [move("second"), move("first")] });
    expect(rows.map((row) => [row.orderId, row.moveNumber])).toEqual([["second", 1], ["first", 2]]);
    expect(orderRows("game", 1, { ...draft, revision: 5, orders: [move("second")] })[0]?.moveNumber).toBe(1);
  });

  it("rejects corrupted queue numbers, identities, and malformed payloads", () => {
    const row = stored();
    for (const change of [{ moveNumber: 2 }, { draftPosition: 9 }, { orderId: "wrong" }, { kind: "ATTACK" }, { payload: {} }]) {
      expect(() => restoreDraft({ ...row, orders: [{ ...row.orders[0]!, ...change } as PlayerOrder, ...row.orders.slice(1)] })).toThrow();
    }
    expect(() => restoreDraft({ ...row, active: false })).toThrow();
  });

  it("round-trips lifecycle metadata without losing millisecond precision", () => {
    const state = createTurn({ schemaVersion: 1, gameId: "game", turnDurationMs: 1_000 }, [
      { schemaVersion: 1, gameId: "game", playerId: "alice", active: true }
    ], 123);
    for (const current of [state, observeDeadline(state, 1_200)]) {
      const row = { matchId: "game", number: 1n, startingStateVersion: 0n, ...turnFields(current) };
      expect(restoreTurnRecord(row)).toEqual(current.turn);
    }
    expect(safeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => safeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow();
    expect(() => safeNumber(-1n)).toThrow();
  });

  it("requires explicit runtime database configuration without opening a connection", () => {
    expect(() => createDatabaseClient("")).toThrow("DATABASE_URL");
    expect(() => createDatabaseClient("https://example.invalid")).toThrow("PostgreSQL");
  });

  it("allows only dedicated local test targets and never falls back to development credentials", () => {
    const local = "postgresql://local:placeholder@127.0.0.1:5434/strategy_game_test?schema=public";
    expect(testDatabaseUrl(local)).toBe(local);
    for (const target of [undefined, "invalid", "postgresql://local@127.0.0.1/strategy_game_dev", "postgresql://local@example.com/game_test", "postgresql://local@localhost/game_test?schema=other"]) {
      expect(() => testDatabaseUrl(target)).toThrow();
    }
  });
});
