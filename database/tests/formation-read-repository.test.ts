import { describe, expect, it, vi } from "vitest";
import { FormationReadRepository } from "../src/formation-read-repository.js";
import { TurnReadRepository } from "../src/turn-read-repository.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { initialArmiesFixture } from "./initial-armies-fixture.js";
import { initialTurnFixture } from "./initial-turn-fixture.js";

function fixture(old = false, count = 2) {
  const f = old ? initialTurnFixture(count) : initialArmiesFixture(count);
  const calls: string[] = [];
  const data = { profile: { username: "Player0" } as { username: string | null } | null,
    member: { active: true, playerId: "p00" } as { active: boolean; playerId: string } | null,
    match: { ...f.row.match, turns: [{ number: 1n }] } };
  const record = <T>(name: string, value: () => T) => vi.fn(async () => { calls.push(name); return value(); });
  const tx = { $executeRaw: record("read-only", () => 0), playerIdentity: { findUnique: record("profile", () => data.profile) },
    matchParticipant: { findUnique: record("membership", () => data.member) }, match: { findUnique: record("metadata", () => data.match) },
    turn: { findUnique: record("private", () => f.row) } };
  const transaction = vi.fn(async (work: (t: typeof tx) => Promise<unknown>, _options: unknown) => work(tx));
  const client = { $transaction: transaction } as unknown as PrismaClient;
  const repo = new FormationReadRepository(client);
  return { ...f, data, calls, tx, transaction, repo, turnRepo: new TurnReadRepository(client), read: () => repo.getFormations(f.row.matchId, "account-p00") };
}
describe("own-only immutable formation projection", () => {
  it.each([2, 4, 10, 40])("projects only caller's six members for %i players including host", async (count) => {
    const f = fixture(false, count); const before = structuredClone(f.row);
    for (const playerId of ["p00", `p${String(count - 1).padStart(2, "0")}`]) {
      f.data.member!.playerId = playerId;
      const response = await f.read(); expect(response.state).toBe("READY");
      if (response.state !== "READY") throw new Error("Expected READY");
      expect(response.formations).toHaveLength(1); expect(response.formations[0]!.ownerPlayerId).toBe(playerId);
      expect(response.formations[0]!.units).toHaveLength(6);
      const serialized = JSON.stringify(response);
      for (const key of ["seed", "worldRef", "snapshotId", "digest", "policy", "identityId", "players", "orders", "pinnedRuleset"]) expect(serialized).not.toContain(`"${key}"`);
      const enemy = f.row.match.participants.find((p) => p.playerId !== playerId)!;
      expect(serialized).not.toContain(enemy.identityId);
    }
    expect(f.row).toEqual(before);
    expect((await f.turnRepo.getTurn(f.row.matchId, "account-p00")).state).toBe("READY");
  });
  it("authorizes before private reads under consistent read-only isolation, with no time reads", async () => {
    const f = fixture(); const clock = vi.spyOn(Date, "now");
    try { await f.read(); expect(clock).not.toHaveBeenCalled(); } finally { clock.mockRestore(); }
    expect(f.calls).toEqual(["read-only", "profile", "membership", "metadata", "private"]);
    expect(f.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(f.tx.$executeRaw.mock.calls[0]).toEqual([["SET TRANSACTION READ ONLY"]]);
  });
  it.each(["missing", "inactive", "incomplete", "anonymous"])("denies %s before private state retrieval", async (kind) => {
    const f = fixture();
    if (kind === "missing") f.data.member = null;
    if (kind === "inactive") f.data.member!.active = false;
    if (kind === "incomplete") f.data.profile!.username = null;
    if (kind === "anonymous") f.data.profile = null;
    await expect(f.read()).rejects.toMatchObject({ code: kind === "anonymous" ? "UNAUTHENTICATED" : kind === "incomplete" ? "USERNAME_REQUIRED" : "NOT_FOUND" });
    expect(f.tx.match.findUnique).not.toHaveBeenCalled(); expect(f.tx.turn.findUnique).not.toHaveBeenCalled();
  });
  it("explicitly reports old initialized runtime as unsupported without upgrading it", async () => {
    const f = fixture(true); const before = structuredClone(f.row);
    expect((await f.read()).state).toBe("UNSUPPORTED"); expect(f.row).toEqual(before);
  });
  it.each(["OPEN", "RUNNING"] as const)("handles legacy %s without initialization", async (status) => {
    const f = fixture(); const m = f.data.match; m.status = status; m.turns = []; m.world = null;
    Object.assign(m.configuration!, { rulesetId: null, rulesetVersion: null, simulationVersion: null, pinnedRuleset: null });
    expect((await f.read()).state).toBe(status === "OPEN" ? "NOT_STARTED" : "UNINITIALIZED");
    expect(f.tx.turn.findUnique).not.toHaveBeenCalled();
  });
  it.each(["missing-world", "missing-turn", "tamper", "missing-own", "wrong-kind"])("fails closed on %s without repair", async (kind) => {
    const f = fixture();
    if (kind === "missing-world") f.data.match.world = null;
    if (kind === "missing-turn") f.data.match.turns = [];
    if (kind === "missing-own") f.data.member!.playerId = "outside-roster";
    const snapshot = f.row.startingSnapshot.payload as Record<string, unknown>;
    if (kind === "tamper") snapshot.snapshotId = `initial-armies:${"0".repeat(64)}`;
    if (kind === "wrong-kind") snapshot.kind = "initial_world";
    await expect(f.read()).rejects.toMatchObject({ code: "INTERNAL_ERROR", message: "INTERNAL_ERROR" });
  });
  it("rejects malformed requests before storage and sanitizes unexpected failures", async () => {
    const f = fixture(); await expect(f.repo.getFormations("", "account")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(f.transaction).not.toHaveBeenCalled();
    f.tx.turn.findUnique.mockRejectedValue(new Error("private-storage-secret"));
    await expect(f.read()).rejects.toMatchObject({ code: "INTERNAL_ERROR", message: "INTERNAL_ERROR" });
  });
});
