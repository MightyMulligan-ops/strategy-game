import { describe, expect, it, vi } from "vitest";
import { initializeTurnClosure } from "@strategy-game/game-engine";
import { TurnClosureRepository } from "../src/turn-closure-repository.js";
import { MovementDraftRepository } from "../src/movement-draft-repository.js";
import { restoreStoredTurn } from "../src/turn-storage.js";
import type { StoredTurnRow } from "../src/turn-storage.js";
import { json } from "../src/mappings.js";
import { movementDraftFixture } from "./movement-draft-fixture.js";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
function fixture() {
  const f = movementDraftFixture();
  const plan = initializeTurnClosure(f.config, f.players, f.archive, 10000);
  Object.assign(f.row.match.configuration!, { rulesetId: "turn-closure", simulationVersion: "turn-closure-v1", pinnedRuleset: json(plan.runtimeProfile) });
  Object.assign(f.row.startingSnapshot, { snapshotId: plan.snapshot.snapshotId, payload: json(plan.snapshot) });
  let committed: StoredTurnRow = structuredClone(f.row);
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
      matchConfiguration: { findUnique: async () => row.match.configuration },
      frozenTurnInputRecord: { create: async ({ data }: { data: object }) => { stage("freeze"); row.frozenInput = { ...data, seed: null, frozenAt: new Date(0) } as StoredTurnRow["frozenInput"]; } },
      turn: { findUnique: async () => { calls.push("private"); return row; }, update: async ({ data }: { data: object }) => { stage("turn"); Object.assign(row,data); } },
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
  const repository = new TurnClosureRepository(client, clock);
  const formation = plan.snapshot.formations[0]!, x = formation.position.x, y = formation.position.y;
  const direction = x < f.archive.payload.bounds.width / 2 ? 1 : -1;
  const order = (id: string, offset: number) => ({ type: "move" as const, orderId: id, stackId: formation.formationId, destination: { x: x + direction * offset, y } });
  const submit = (orders: ReturnType<typeof order>[], revision = 0, actor = "account-p00") => repository.mutate(f.row.matchId, 1, actor, { schemaVersion: 1, kind: "replace_orders", expectedRevision: revision, orders });
  return { ...f, plan, repository, submit, order, calls, transactions, profile, clock, fail: (value: string, error?: unknown) => { fail = value; if (error) failure = error; }, inactive: () => { active = false; },
    ready: (revision = 0, ready = true, identity = "account-p00") => repository.setReady(f.row.matchId,1,identity,{ schemaVersion:1, expectedRevision:revision, ready }),
    row: () => committed, corrupt: (work: (r: typeof committed) => void) => work(committed), read: () => new MovementDraftRepository(client).getDraft(f.row.matchId, 1, "account-p00") };
}
describe("closure persistence with staged in-memory transactions (no PostgreSQL)", () => {
  it("preserves orders across Ready/Unready, locks edits and restores full history", async () => {
    const f=fixture(); await f.submit([f.order("a",100)]); const rows=structuredClone(f.row().players[0]!.orders);
    await f.ready(1); expect(f.row().players[0]!.orders).toEqual(rows);
    await expect(f.submit([],2)).rejects.toMatchObject({code:"READY_LOCKED"});
    await expect(f.ready(2)).rejects.toMatchObject({code:"READY_UNCHANGED"});
    await f.ready(2,false); await f.submit([],3);
    expect(restoreStoredTurn(f.row()).state.drafts[0]).toMatchObject({revision:4,ready:false,orders:[]});
  });
  it("commits final Ready plus exactly one frozen input and projects own state only",async()=>{
    const f=fixture(); await f.ready(); await f.ready(0,true,"account-p01");
    expect(f.row()).toMatchObject({status:"CLOSED",closeReason:"ALL_READY",frozenInput:{payload:{schemaVersion:2,players:expect.any(Array)}}});
    expect(restoreStoredTurn(f.row()).kind).toBe("turn_closure");
    await expect(f.ready(1,false)).rejects.toMatchObject({code:"TURN_CLOSED"});
    const view=await f.read(); expect(view).toMatchObject({schemaVersion:2,turn:{status:"closed"},own:{ready:true,revision:1}});
    expect(JSON.stringify(view)).not.toMatch(/worldSeed|snapshotId|players|account-p|runtimeProfile/);
  });
  it.each(["ready","draft"])("commits deadline closure even when late %s rejects",async(kind)=>{
    const f=fixture(); f.clock.mockReturnValue(11000);
    await expect(kind==="ready"?f.ready():f.submit([])).rejects.toMatchObject({code:"TURN_CLOSED"});
    expect(f.row()).toMatchObject({status:"CLOSED",closedAtMs:11000n,closeReason:"DEADLINE"});
    expect(restoreStoredTurn(f.row()).state.drafts.every(d=>d.revision===0&&!d.ready)).toBe(true);
  });
  it.each(["history","revision","turn","freeze","commit"])("rolls complete final-Ready transaction back at %s",async(stage)=>{
    const f=fixture(); await f.ready(); const before=structuredClone(f.row()); f.fail(stage);
    await expect(f.ready(0,true,"account-p01")).rejects.toMatchObject({code:"INTERNAL_ERROR"}); expect(f.row()).toEqual(before);
  });
  it("serializes concurrent Ready revisions with one success and no blind retry",async()=>{
    const f=fixture(),results=await Promise.allSettled([f.ready(),f.ready()]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1); expect(results.find(r=>r.status==="rejected")).toMatchObject({reason:{code:"STALE_REVISION"}});
  });
  it("checks authorization before locks, metadata, time or writes; GET observes no clock",async()=>{
    const f=fixture(); await expect(f.ready(0,true,"outsider")).rejects.toMatchObject({code:"NOT_FOUND"}); expect(f.calls).not.toContain("lock"); expect(f.clock).not.toHaveBeenCalled();
    await f.read(); expect(f.clock).not.toHaveBeenCalled(); f.inactive(); await expect(f.ready()).rejects.toMatchObject({code:"NOT_FOUND"});
  });
  it.each(["frozen","history","ready","clock","status"])("refuses corrupted %s without repair",async(kind)=>{
    const f=fixture(); await f.ready(); await f.ready(0,true,"account-p01");
    f.corrupt(r=>{if(kind==="frozen")r.frozenInput!.payload={};if(kind==="history")r.players[0]!.revisions.pop();if(kind==="ready")r.players[0]!.ready=false;if(kind==="clock")r.lastObservedAtMs=9999n;if(kind==="status")r.status="RESOLVING"});
    expect(()=>restoreStoredTurn(f.row())).toThrow();
  });
});
