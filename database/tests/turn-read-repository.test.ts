import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadTurnResponseSchema } from "@strategy-game/shared-types";
import { TurnReadRepository } from "../src/turn-read-repository.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { initialTurnFixture } from "./initial-turn-fixture.js";

function fixture(count = 2) {
  const { row } = initialTurnFixture(count);
  const calls: string[] = [];
  const record = <T>(name: string, value: () => T) => vi.fn(async (..._args: unknown[]) => { calls.push(name); return value(); });
  const data = {
    profile: { username: "Reader_1" } as { username: string | null } | null,
    member: { active: true, playerId: "p00" } as { active: boolean; playerId: string } | null,
    match: { ...row.match, turns: [{ number: 1n }] } as (typeof row.match & { turns: { number: bigint }[] }) | null
  };
  const tx = {
    $executeRaw: record("read-only", () => 0),
    playerIdentity: { findUnique: record("profile", () => data.profile) },
    matchParticipant: { findUnique: record("membership", () => data.member) },
    match: { findUnique: record("metadata", () => data.match) },
    turn: { findUnique: record("private-turn", () => row) }
  };
  const transaction = vi.fn(async (callback: (context: typeof tx) => Promise<unknown>, _options: unknown) => callback(tx));
  const repo = new TurnReadRepository({ $transaction: transaction } as unknown as PrismaClient);
  function legacy(status: "OPEN" | "RUNNING", world = false) {
    const match = data.match!; match.status = status; match.turns = [];
    if (!world) match.world = null;
    Object.assign(match.configuration!, { rulesetId: null, rulesetVersion: null, simulationVersion: null, pinnedRuleset: null });
  }
  return { repo, row, data, tx, calls, transaction, legacy, read: () => repo.getTurn(row.matchId, "account-p00") };
}
afterEach(() => vi.restoreAllMocks());

describe("production read-only Turn 1 repository", () => {
  it.each([2, 4, 10, 40])("projects only own revision-zero unready state for %i players", async (count) => {
    const f = fixture(count); const before = structuredClone(f.row);
    for (let i = 0; i < count; i++) {
      const playerId = `p${String(i).padStart(2, "0")}`; f.data.member!.playerId = playerId;
      const result = await f.repo.getTurn(f.row.matchId, `account-${playerId}`);
      expect(result).toEqual({ schemaVersion: 1, matchId: f.row.matchId, state: "READY",
        turn: { schemaVersion: 1, gameId: f.row.matchId, turnNumber: 1, status: "open", openedAtMs: 10_000, deadlineAtMs: 11_000 },
        own: { schemaVersion: 1, gameId: f.row.matchId, turnNumber: 1, revision: 0, ready: false, orders: [] } });
      expect(ReadTurnResponseSchema.safeParse(result).success).toBe(true);
      const text = JSON.stringify(result);
      for (const secret of ["seed", "payload", "snapshotId", "digest", "pinnedRuleset", "players", "playerId", "identityId", "frozenInput", "resolution", "lastObservedAtMs"])
        expect(text).not.toContain(`"${secret}"`);
    }
    expect(f.row).toEqual(before);
  });
  it("enforces read-only repeatable-read and authorizes before metadata or private loading", async () => {
    const f = fixture(); await f.read();
    expect(f.calls).toEqual(["read-only", "profile", "membership", "metadata", "private-turn"]);
    expect(f.tx.$executeRaw.mock.calls[0]).toEqual([["SET TRANSACTION READ ONLY"]]);
    expect(f.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(f.tx.matchParticipant.findUnique.mock.calls[0]).toEqual([{ where: { matchId_identityId: { matchId: f.row.matchId, identityId: "account-p00" } }, select: { active: true, playerId: true } }]);
  });
  it.each(["missing-account", "incomplete", "outsider", "inactive", "cross-match", "missing-match"])("fails privately for %s before private loading", async (kind) => {
    const f = fixture();
    if (kind === "missing-account") f.data.profile = null;
    if (kind === "incomplete") f.data.profile!.username = null;
    if (kind === "outsider" || kind === "cross-match") f.data.member = null;
    if (kind === "inactive") f.data.member!.active = false;
    if (kind === "missing-match") f.data.match = null;
    const code = kind === "missing-account" ? "UNAUTHENTICATED" : kind === "incomplete" ? "USERNAME_REQUIRED" : "NOT_FOUND";
    await expect(f.read()).rejects.toMatchObject({ code, message: code });
    expect(f.tx.turn.findUnique).not.toHaveBeenCalled();
    if (!["missing-match"].includes(kind)) expect(f.tx.match.findUnique).not.toHaveBeenCalled();
  });
  it.each(["OPEN", "RUNNING"] as const)("preserves legacy %s availability without restoring or writing", async (status) => {
    for (const hasWorld of status === "RUNNING" ? [false, true] : [false]) {
      const f = fixture(); f.legacy(status, hasWorld); const before = structuredClone(f.data);
      expect(await f.read()).toEqual({ schemaVersion: 1, matchId: f.row.matchId, state: status === "OPEN" ? "NOT_STARTED" : "UNINITIALIZED" });
      expect(f.tx.turn.findUnique).not.toHaveBeenCalled(); expect(f.data).toEqual(before);
    }
  });
  it("repeated overdue reads do not observe time or alter stored OPEN metadata/history", async () => {
    const f = fixture(); const before = structuredClone(f.row);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    const results = await Promise.all(Array.from({ length: 8 }, () => f.read()));
    expect(results.every((r) => r.state === "READY" && r.turn.status === "open")).toBe(true);
    expect(clock).not.toHaveBeenCalled(); expect(f.row).toEqual(before);
  });
  it("returns NOT_STARTED for a newly pinned OPEN lobby without initialization", async () => {
    const f = fixture(); f.data.match!.status = "OPEN"; f.data.match!.world = null; f.data.match!.turns = [];
    expect(await f.read()).toEqual({ schemaVersion: 1, matchId: f.row.matchId, state: "NOT_STARTED" });
    expect(f.tx.turn.findUnique).not.toHaveBeenCalled();
  });
  it.each(["partial-pins", "unknown-runtime", "empty-runtime", "missing-world", "missing-turn", "extra-turn", "wrong-turn", "missing-config", "wrong-config", "snapshot-digest", "changed-clock", "changed-revision", "missing-own", "legacy-with-turn", "open-with-world"])("fails closed on %s", async (kind) => {
    const f = fixture(); const match = f.data.match!;
    if (kind === "partial-pins") match.configuration!.rulesetId = null;
    if (kind === "unknown-runtime" || kind === "empty-runtime") {
      match.configuration!.simulationVersion = kind === "empty-runtime" ? "empty-turn-v1" : "unsupported";
      (match.configuration!.pinnedRuleset as Record<string, unknown>).simulationVersion = match.configuration!.simulationVersion;
    }
    if (kind === "missing-world") match.world = null;
    if (kind === "missing-turn") match.turns = [];
    if (kind === "extra-turn") match.turns.push({ number: 2n });
    if (kind === "wrong-turn") match.turns = [{ number: 2n }];
    if (kind === "missing-config") match.configuration = null;
    if (kind === "wrong-config") match.configuration!.schemaVersion = 99;
    if (kind === "snapshot-digest") (f.row.startingSnapshot.payload as Record<string, unknown>).snapshotId = "forged";
    if (kind === "changed-clock") f.row.lastObservedAtMs += 1n;
    if (kind === "changed-revision") f.row.players[0]!.revision = 1n;
    if (kind === "missing-own") f.data.member!.playerId = "not-in-roster";
    if (kind === "legacy-with-turn") { f.legacy("RUNNING"); match.turns = [{ number: 1n }]; }
    if (kind === "open-with-world") { f.legacy("OPEN", true); }
    await expect(f.read()).rejects.toMatchObject({ code: "INTERNAL_ERROR", message: "INTERNAL_ERROR" });
  });
  it("sanitizes storage failures and rejects malformed requests before any transaction", async () => {
    const f = fixture();
    f.tx.turn.findUnique.mockRejectedValueOnce(new Error("private-connection-string-and-seed"));
    await expect(f.read()).rejects.toMatchObject({ code: "INTERNAL_ERROR", message: "INTERNAL_ERROR" });
    const fresh = fixture();
    for (const matchId of ["", "x".repeat(129)]) await expect(fresh.repo.getTurn(matchId, "account-p00")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fresh.transaction).not.toHaveBeenCalled();
  });
});
