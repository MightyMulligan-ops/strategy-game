import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { MatchRepository } from "../src/repository.js";
import { configurationRuntime, restoreStoredTurn } from "../src/turn-storage.js";
import { initialTurnFixture } from "./initial-turn-fixture.js";
import { initialTurnMigration } from "./initial-turn-migration.js";

describe("version-aware initial turn storage (database-free)", () => {
  it("recognizes every additive migration statement without executing SQL", () => {
    const ddl = initialTurnMigration(); expect(ddl.functions).toHaveLength(6); expect(ddl.triggers).toHaveLength(17);
    expect(ddl.statements).toHaveLength(23); expect(new Set(ddl.triggers.map((t) => t.name)).size).toBe(17);
  });
  it.each([2, 4, 10, 40])("restores immutable exact %i-player state from the real archive", (count) => {
    const f = initialTurnFixture(count); const before = structuredClone(f.row);
    const restored = restoreStoredTurn(f.row);
    expect(restored.kind).toBe("initial_world"); expect(restored.state).toEqual(f.plan.state); expect(restored.snapshot).toEqual(f.plan.snapshot);
    expect(restored.state.drafts.every((d) => !d.ready && d.revision === 0 && d.orders.length === 0)).toBe(true);
    expect(Object.isFrozen(restored.state.drafts)).toBe(true); expect(f.row).toEqual(before);
  });
  it("accepts roster row order independently from canonical snapshot ordering", () => {
    const f = initialTurnFixture(4); f.row.players.reverse(); f.row.match.participants.reverse();
    expect(restoreStoredTurn(f.row).state).toEqual(f.plan.state);
  });
  it.each([
    "missing world", "seed", "archive payload", "digest", "snapshot id", "config", "pins", "unknown profile", "partial pins", "stripped profile",
    "participant", "inactive participant", "draft", "ready", "revision", "history", "orders", "clock", "deadline", "snapshot column", "match version", "turn number", "legacy mode"
  ])("rejects corrupt %s without interpreting it as an empty world", (kind) => {
    const f = initialTurnFixture(); const row = f.row; const payload = row.startingSnapshot.payload as Record<string, unknown>;
    if (kind === "missing world") row.match.world = null;
    if (kind === "seed") row.match.world!.seed++;
    if (kind === "archive payload") (row.match.world!.payload as Record<string, unknown>).seed = 124;
    if (kind === "digest") (payload.worldRef as Record<string, unknown>).digest = `sha256:${"a".repeat(64)}`;
    if (kind === "snapshot id") payload.snapshotId = row.startingSnapshot.snapshotId = `initial-world:${"a".repeat(64)}`;
    if (kind === "config") row.match.configuration!.turnDurationMs = 2n;
    if (kind === "pins") row.match.configuration!.rulesetVersion = "2";
    if (kind === "unknown profile") row.match.configuration!.simulationVersion = "future-runtime";
    if (kind === "partial pins") row.match.configuration!.pinnedRuleset = null;
    if (kind === "stripped profile") { payload.schemaVersion = 1; delete payload.kind; delete payload.worldRef; }
    if (kind === "participant") row.match.participants.pop();
    if (kind === "inactive participant") row.match.participants[0]!.active = false;
    if (kind === "draft") row.players.pop();
    if (kind === "ready") row.players[0]!.ready = true;
    if (kind === "revision") row.players[0]!.revision = 1n;
    if (kind === "history") row.players[0]!.revisions = [];
    if (kind === "orders") row.players[0]!.revisions[0]!.orders = [{}];
    if (kind === "clock") row.lastObservedAtMs++;
    if (kind === "deadline") row.deadlineAtMs++;
    if (kind === "snapshot column") row.startingSnapshot.completedTurnNumber = 1n;
    if (kind === "match version") row.match.currentStateVersion = 1n;
    if (kind === "turn number") row.number = 2n;
    if (kind === "legacy mode") Object.assign(row.match.configuration!, { rulesetId: null, rulesetVersion: null, simulationVersion: null, pinnedRuleset: null });
    expect(() => restoreStoredTurn(row)).toThrow();
  });
  it("recognizes all-null legacy pins but rejects partial and mismatched profiles", () => {
    const f = initialTurnFixture(); const c = f.row.match.configuration!;
    expect(configurationRuntime(c)).toBe("initial_world");
    Object.assign(c, { rulesetId: null, rulesetVersion: null, simulationVersion: null, pinnedRuleset: null });
    expect(configurationRuntime(c)).toBe("legacy"); c.rulesetId = "initial-world";
    expect(() => configurationRuntime(c)).toThrow();
  });
  it.each(["submitCommand", "observeDeadline", "prepareResolution", "commitResolution", "openFollowingTurn"] as const)("rejects %s before time reads or SQL mutation", async (method) => {
    const f = initialTurnFixture(); const clock = vi.fn(() => 11_000); const write = vi.fn(() => { throw new Error("No write permitted"); });
    const tx = { $queryRaw: vi.fn(async () => [{ matchId: f.row.matchId }]), turn: { findUnique: vi.fn(async () => f.row), update: write, create: write },
      match: { updateMany: write }, frozenTurnInputRecord: { create: write, update: write }, playerTurnState: { update: write }, playerSubmissionRevision: { create: write } };
    const client = { $transaction: async (work: (arg: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
    const r = new MatchRepository(client); let result: Promise<unknown>;
    if (method === "submitCommand") result = r.submitCommand(f.row.matchId, 1, "p00", {}, clock);
    else if (method === "observeDeadline") result = r.observeDeadline(f.row.matchId, 1, clock);
    else if (method === "prepareResolution") result = r.prepareResolution(f.row.matchId, 1, 123);
    else if (method === "commitResolution") result = r.commitResolution(f.row.matchId, 1, {});
    else result = r.openFollowingTurn(f.row.matchId, 1, 12_000);
    await expect(result).rejects.toMatchObject({ code: "unsupported_runtime_operation" });
    expect(clock).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
});
