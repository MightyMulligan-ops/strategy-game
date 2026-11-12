import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { LobbyRepository } from "../src/lobby-repository.js";
import { initialTurnFixture } from "./initial-turn-fixture.js";

function fixture(mode: "initial" | "legacy" | "running" | "unsupported" = "initial", now = 10_000) {
  const f = initialTurnFixture(); const events: string[] = [];
  const row = { ...f.row.match, status: mode === "running" ? "RUNNING" : "OPEN",
    participants: f.row.match.participants.map((p, i) => ({ ...p, identity: { username: `Player${i}` } })) };
  if (mode === "legacy") Object.assign(row.configuration!, { rulesetId: null, rulesetVersion: null, simulationVersion: null, pinnedRuleset: null });
  if (mode === "unsupported") row.configuration!.simulationVersion = "unsupported";
  const record = (name: string) => vi.fn(async (data: unknown) => { events.push(name); return data; });
  const tx = { playerIdentity: { findUnique: async () => ({ username: "Player0" }) }, $queryRaw: async () => { events.push("lock"); return [{ id: row.id }]; },
    match: { findUnique: async () => structuredClone(row), updateMany: vi.fn(async () => { events.push("running"); row.status = "RUNNING"; return { count: 1 }; }) },
    matchWorld: { create: record("world") }, gameSnapshotRecord: { count: async () => 0, create: record("snapshot") },
    turn: { count: async () => 0, create: record("turn") }, playerTurnState: { create: record("draft") }, playerSubmissionRevision: { create: record("revision") } };
  const client = { $transaction: async (work: (value: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
  const generator = vi.fn(() => { events.push("generate"); return f.archive.payload; });
  const clock = vi.fn(() => { events.push("clock"); return now; });
  return { ...f, row, tx, generator, clock, events, repository: new LobbyRepository(client, generator, clock) };
}

describe("lobby initialization orchestration (database-free injected storage)", () => {
  it("locks and generates before its only clock sample, writes all components then RUNNING", async () => {
    const f = fixture(); const before = structuredClone(f.row.configuration); const result = await f.repository.startLobby(f.row.id, f.row.hostIdentityId!);
    expect(result.outcome).toBe("STARTED"); expect(f.events).toEqual(["lock", "generate", "world", "clock", "snapshot", "turn", "draft", "revision", "draft", "revision", "running"]);
    expect(f.clock).toHaveBeenCalledTimes(1); expect(f.generator).toHaveBeenCalledTimes(1);
    expect(f.tx.playerTurnState.create.mock.calls.map(([value]) => (value as { data: object }).data)).toEqual(f.players.map((p) => ({ matchId: f.row.id, turnNumber: 1n, playerId: p.playerId, active: true, revision: 0n, ready: false })));
    expect(f.row.configuration).toEqual(before); expect(f.row.participants.every((p) => p.lobbyReady)).toBe(true);
  });
  it.each(["legacy", "running"] as const)("keeps %s on its existing no-turn/no-clock path", async (mode) => {
    const f = fixture(mode); expect((await f.repository.startLobby(f.row.id, f.row.hostIdentityId!)).outcome).toBe(mode === "running" ? "ALREADY_STARTED" : "STARTED");
    expect(f.clock).not.toHaveBeenCalled(); expect(f.tx.turn.create).not.toHaveBeenCalled(); expect(f.tx.gameSnapshotRecord.create).not.toHaveBeenCalled();
    if (mode === "running") { expect(f.generator).not.toHaveBeenCalled(); expect(f.events).toEqual(["lock"]); }
  });
  it("rejects unsupported pins before generation, time or mutation", async () => {
    const f = fixture("unsupported"); await expect(f.repository.startLobby(f.row.id, f.row.hostIdentityId!)).rejects.toThrow();
    expect(f.events).toEqual(["lock"]);
  });
  it.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER])("rejects invalid/overflowing opening time %s before a turn or RUNNING write", async (time) => {
    const f = fixture("initial", time); await expect(f.repository.startLobby(f.row.id, f.row.hostIdentityId!)).rejects.toThrow();
    expect(f.tx.turn.create).not.toHaveBeenCalled(); expect(f.tx.match.updateMany).not.toHaveBeenCalled();
    // These injected spies do not implement rollback; real atomicity is tested only in disposable CI.
  });
  it("checks host and readiness before generation/time/mutation", async () => {
    const f = fixture(); await expect(f.repository.startLobby(f.row.id, "outsider")).rejects.toMatchObject({ code: "HOST_REQUIRED" });
    f.row.participants[1]!.lobbyReady = false;
    await expect(f.repository.startLobby(f.row.id, f.row.hostIdentityId!)).rejects.toMatchObject({ code: "NOT_ALL_READY" });
    expect(f.generator).not.toHaveBeenCalled(); expect(f.clock).not.toHaveBeenCalled(); expect(f.tx.matchWorld.create).not.toHaveBeenCalled();
  });
});
