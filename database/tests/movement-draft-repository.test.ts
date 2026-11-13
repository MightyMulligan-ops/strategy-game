import { describe, expect, it, vi } from "vitest";
import { MovementDraftRepository } from "../src/movement-draft-repository.js";
import { restoreStoredTurn } from "../src/turn-storage.js";
import { movementDraftFixture, fixtureRevision } from "./movement-draft-fixture.js";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import type { MovementDraftRequest } from "@strategy-game/shared-types";

function fixture() {
  const f = movementDraftFixture(); let committed = structuredClone(f.row);
  let fail = ""; let failure: unknown = new Error("private-storage-failure"); let release: (() => void) | undefined; let tail = Promise.resolve();
  const calls: string[] = [], transactions: unknown[] = [];
  const profile = { username: "Player0" as string | null }; let active = true;
  const clock = vi.fn(() => 10_001);
  const stage = (name: string) => { calls.push(name); if (fail === name) throw failure; };
  const client = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) => {
    transactions.push(options); let row = structuredClone(committed), writable = false; let unlock: (() => void) | undefined;
    const tx = {
      $executeRaw: async () => { calls.push("read-only"); return 0; },
      $queryRaw: async () => { stage("lock"); const before = tail; tail = new Promise<void>((done) => { release = done; }); const done = release; await before; unlock = done; row = structuredClone(committed); writable = true; return [{ id: row.matchId }]; },
      playerIdentity: { findUnique: async () => { calls.push("profile"); return profile; } },
      matchParticipant: { findUnique: async ({ where }: { where: { matchId_identityId: { identityId: string } } }) => {
        calls.push("member"); const p = row.match.participants.find((p) => p.identityId === where.matchId_identityId.identityId); return p ? { active: active && p.active, playerId: p.playerId } : null;
      } },
      match: { findUnique: async () => { calls.push("metadata"); return { ...row.match, turns: [{ number: 1n }] }; } },
      turn: { findUnique: async () => { calls.push("private"); return row; }, update: () => { throw new Error("Lifecycle write prohibited"); } },
      orderDependency: { count: async () => 0 },
      playerSubmissionRevision: { create: async ({ data }: { data: typeof row.players[number]["revisions"][number] }) => { stage("history"); row.players.find((p) => p.playerId === data.playerId)!.revisions.push({ ...data, recordedAt: new Date(0) }); } },
      playerTurnState: { updateMany: async ({ where, data }: { where: { playerId: string; revision: bigint }; data: { revision: bigint; ready: boolean } }) => {
        stage("revision"); const p = row.players.find((p) => p.playerId === where.playerId && p.revision === where.revision); if (!p) return { count: 0 }; Object.assign(p, data); return { count: 1 };
      } },
      playerOrder: {
        updateMany: async ({ where, data }: { where: { playerId: string }; data: object }) => { stage("retire"); for (const o of row.players.find((p) => p.playerId === where.playerId)!.orders) if (o.active) Object.assign(o, data); },
        upsert: async ({ create, update }: { create: typeof row.players[number]["orders"][number]; update: object }) => { stage("order"); const p = row.players.find((p) => p.playerId === create.playerId)!; const previous = p.orders.find((o) => o.orderId === create.orderId); if (previous) Object.assign(previous, update); else p.orders.push(create); }
      }
    };
    try { const result = await work(tx as unknown as Prisma.TransactionClient); if (writable) { stage("commit"); committed = row; } return result; }
    finally { unlock?.(); }
  } } as unknown as PrismaClient;
  const repository = new MovementDraftRepository(client, clock);
  const formation = f.plan.snapshot.formations[0]!, x = formation.position.x, y = formation.position.y;
  const direction = x < f.archive.payload.bounds.width / 2 ? 1 : -1;
  const order = (id: string, offset: number) => ({ type: "move" as const, orderId: id, stackId: formation.formationId, destination: { x: x + direction * offset, y } });
  const submit = (orders: ReturnType<typeof order>[], revision = 0, actor = "account-p00") => repository.submitDraft(f.row.matchId, 1, actor, { schemaVersion: 1, kind: "replace_orders", expectedRevision: revision, orders });
  return { ...f, repository, submit, order, calls, transactions, profile, clock, fail: (value: string, error?: unknown) => { fail = value; if (error) failure = error; }, inactive: () => { active = false; },
    row: () => committed, corrupt: (work: (r: typeof committed) => void) => work(committed), read: () => repository.getDraft(f.row.matchId, 1, "account-p00") };
}
describe("revisioned movement persistence (in-memory transactional injection, no PostgreSQL)", () => {
  it("commits whole drafts/history and restores stable edit/reorder/cancel state without moving formations", async () => {
    const f = fixture(), before = structuredClone(f.row());
    const first = await f.submit([f.order("a", 50), f.order("b", 100)]);
    expect(first.own).toMatchObject({ revision: 1, ready: false }); expect(first.route.distance).toBe(100);
    expect((await f.read())).toEqual(first); expect(f.clock).toHaveBeenCalledOnce();
    await f.submit([f.order("b", 100), f.order("a", 60)], 1);
    const canceled = await f.repository.submitDraft(f.row().matchId, 1, "account-p00", { schemaVersion: 1, kind: "cancel_order", expectedRevision: 2, orderId: "b" });
    expect(canceled.own.revision).toBe(3); expect(canceled.route.segments.map((s) => [s.orderId, s.moveNumber])).toEqual([["a", 1]]);
    const restored = restoreStoredTurn(f.row()); expect(restored.kind).toBe("movement_drafts"); expect(restored.state.drafts[0]!.revision).toBe(3);
    expect(f.row().players[0]!.revisions).toHaveLength(4); expect(f.row().players[0]!.orders).toHaveLength(2);
    expect(f.row().match).toEqual(before.match); expect(f.row().startingSnapshot).toEqual(before.startingSnapshot); expect(f.row().players[1]).toEqual(before.players[1]);
    expect(f.row().lastObservedAtMs).toBe(before.openedAtMs); expect(f.row().status).toBe("OPEN");
  });
  it("serializes same-player expected-revision races with exactly one acceptance", async () => {
    const f = fixture(); const result = await Promise.allSettled([f.submit([f.order("a", 50)]), f.submit([f.order("b", 100)])]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(result.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "STALE_REVISION" } });
    expect(f.row().players[0]!.revision).toBe(1n); expect(f.row().players[0]!.revisions).toHaveLength(2);
  });
  it.each(["history", "revision", "retire", "order", "commit"])("rolls staged storage back completely at %s", async (stage) => {
    const f = fixture(), before = structuredClone(f.row()); f.fail(stage);
    await expect(f.submit([f.order("a", 50)])).rejects.toMatchObject({ code: "INTERNAL_ERROR", message: "INTERNAL_ERROR" });
    expect(f.row()).toEqual(before);
  });
  it("maps only the scoped SQL deadline code and rolls back its staged history", async () => {
    const f = fixture(), before = structuredClone(f.row());
    f.fail("order", { meta: { driverAdapterError: { cause: { originalCode: "P0051", message: "private-SQL-detail" } } } });
    await expect(f.submit([f.order("a", 50)])).rejects.toMatchObject({ code: "DEADLINE_PASSED", message: "DEADLINE_PASSED" });
    expect(f.row()).toEqual(before);
  });
  it("rejects invalid whole replacements, stale revisions and expiry with no writes/closure", async () => {
    const f = fixture(), before = structuredClone(f.row());
    await expect(f.submit([f.order("a", 251)])).rejects.toMatchObject({ code: "INVALID_DRAFT" });
    await expect(f.submit([], 1)).rejects.toMatchObject({ code: "STALE_REVISION" });
    f.clock.mockReturnValue(11_000); await expect(f.submit([])).rejects.toMatchObject({ code: "DEADLINE_PASSED" });
    expect(f.row()).toEqual(before); expect(f.calls).not.toContain("history"); expect(f.row().status).toBe("OPEN");
  });
  it("authorizes before metadata/locks/time; own-only GET is read-only and uses repeatable-read", async () => {
    const f = fixture(); await expect(f.repository.getDraft(f.row().matchId, 1, "outsider")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.calls).not.toContain("metadata"); expect(f.calls).not.toContain("private");
    f.calls.length = 0; await f.read(); expect(f.calls).toEqual(["read-only", "profile", "member", "metadata", "private"]);
    expect(f.transactions.at(-1)).toEqual({ isolationLevel: "RepeatableRead" }); expect(f.clock).not.toHaveBeenCalled();
    f.inactive(); f.calls.length = 0; await expect(f.submit([])).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(f.calls).not.toContain("lock");
  });
  it("preserves private player isolation and denies forged formation ownership", async () => {
    const f = fixture(); await f.submit([f.order("a", 50)]);
    const other = f.plan.snapshot.formations[1]!;
    const foreign = { ...f.order("b", 0), stackId: other.formationId };
    await expect(f.submit([foreign], 1)).rejects.toMatchObject({ code: "INVALID_DRAFT" });
    const own = await f.read(), second = await f.repository.getDraft(f.row().matchId, 1, "account-p01");
    expect(second.state).toBe("READY"); if (second.state === "READY") expect(second.own.orders).toEqual([]);
    expect(JSON.stringify(own)).not.toMatch(/snapshotId|pinnedRuleset|digest|identityId|account-p|"seed"/);
    expect(JSON.stringify(second)).not.toContain('"orderId":"a"');
  });
  it.each(["history-gap", "history-orders", "history-command", "ready", "numbering", "retired-payload", "future-revision", "position", "pins"])("fails closed on persisted %s corruption", (kind) => {
    const f = movementDraftFixture(), formation = f.plan.snapshot.formations[0]!;
    const order = { orderId: "a", type: "move", stackId: formation.formationId, destination: formation.position };
    fixtureRevision(f, "p00", [order]); fixtureRevision(f, "p00", []);
    const p = f.row.players[0]!;
    if (kind === "history-gap") p.revisions.splice(1, 1);
    if (kind === "history-orders") p.revisions[1]!.orders = [];
    if (kind === "history-command") p.revisions[1]!.command = {};
    if (kind === "ready") p.ready = true;
    if (kind === "numbering") { p.orders[0]!.active = true; p.orders[0]!.draftPosition = 2; p.orders[0]!.moveNumber = 2; }
    if (kind === "retired-payload") (p.orders[0]!.payload as Record<string, unknown>).stackId = f.plan.snapshot.formations[1]!.formationId;
    if (kind === "future-revision") p.orders[0]!.lastRevision = 3n;
    if (kind === "position") ((f.row.startingSnapshot.payload as Record<string, unknown>).formations as { position: { x: number } }[])[0]!.position.x++;
    if (kind === "pins") f.row.match.configuration!.simulationVersion = "initial-armies-v1";
    expect(() => restoreStoredTurn(f.row)).toThrow();
  });
  it("strictly rejects unsupported commands before starting storage", async () => {
    const f = fixture(); await expect(f.repository.submitDraft(f.row().matchId, 1, "account-p00", { schemaVersion: 1, kind: "set_ready", ready: true, expectedRevision: 0 } as unknown as MovementDraftRequest)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(f.transactions).toEqual([]);
  });
});
