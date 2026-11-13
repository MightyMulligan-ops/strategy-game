import { describe, expect, it, vi } from "vitest";
import { ClosureMovementReadySchema, MovementDraftReadySchema, SetTurnReadyRequestSchema } from "@strategy-game/shared-types";
import { ClosureFrozenInputSchema, InitialWorldArchiveSchema, MovementDraftSnapshotSchema } from "@strategy-game/shared-types/server";
import { applyClosureCommand, initializeTurnClosure, observeClosureDeadline, freezeClosureInput, validateTurnClosureSnapshot, freezeTurnInput, resolveTurn, previewMovementDraft } from "../src/index.js";
import { armyFixture } from "./initial-armies-fixture.js";
function fixture(count = 2) {
  const f = armyFixture(count), archive = InitialWorldArchiveSchema.parse(f.archive), plan = initializeTurnClosure(f.config, f.players, archive, 1000);
  const command = (revision = 0, ready = true) => ({ schemaVersion: 1, gameId: f.config.gameId, turnNumber: 1, kind: "set_ready", expectedRevision: revision, ready });
  return { ...f, armyPlan: f.plan, archive, plan, command };
}
describe("v5 closure contracts and pure lifecycle", () => {
  it.each([2,4,10,40])("preserves %i-player armies and freezes every empty queue once on final Ready", (count) => {
    const f = fixture(count); let state = f.plan.state;
    expect(f.plan.snapshot.units).toEqual(f.armyPlan.snapshot.units); expect(f.plan.snapshot.formations).toEqual(f.armyPlan.snapshot.formations);
    expect(validateTurnClosureSnapshot(f.plan.snapshot, f.archive, f.plan.runtimeProfile)).toEqual(f.plan.snapshot);
    expect(MovementDraftSnapshotSchema.safeParse(f.plan.snapshot).success).toBe(false);
    for (const p of state.players) { const next = applyClosureCommand(state, f.plan.snapshot, f.archive, p.playerId, f.command(), 1001); expect(next.error).toBeUndefined(); state = next.state; }
    expect(state.turn).toMatchObject({ status: "closed", closeReason: "all_ready", closedAtMs: 1001 });
    const frozen = freezeClosureInput(state, f.plan.snapshot, f.archive);
    expect(frozen.players).toHaveLength(count); expect(frozen.players.every((p) => p.ready && p.revision === 1 && p.orders.length === 0)).toBe(true);
    expect(observeClosureDeadline(state, 3000)).toBe(state);
    expect(() => freezeTurnInput(state, f.plan.snapshot)).toThrow(); expect(resolveTurn(f.plan.snapshot, frozen, f.plan.runtimeProfile, 1).ok).toBe(false);
  });
  it("Ready locks replacement and cancellation, Unready preserves orders and unlocks explicitly", () => {
    const f = fixture(), id = f.players[0]!.playerId, formation = f.plan.snapshot.formations[0]!;
    const replace = { schemaVersion: 1, gameId: f.config.gameId, turnNumber: 1, kind: "replace_orders", expectedRevision: 0,
      orders: [{ type: "move", orderId: "stable", stackId: formation.formationId, destination: formation.position }] };
    let state = applyClosureCommand(f.plan.state, f.plan.snapshot, f.archive, id, replace, 1001).state;
    state = applyClosureCommand(state, f.plan.snapshot, f.archive, id, f.command(1), 1002).state;
    for (const input of [{ ...replace, expectedRevision: 2 }, { schemaVersion: 1, gameId: f.config.gameId, turnNumber: 1, kind: "cancel_order", orderId: "stable", expectedRevision: 2 }]) {
      expect(applyClosureCommand(state, f.plan.snapshot, f.archive, id, input, 1003)).toMatchObject({ error: "READY_LOCKED" });
    }
    const next = applyClosureCommand(state, f.plan.snapshot, f.archive, id, f.command(2, false), 1004);
    expect(next.draft).toMatchObject({ revision: 3, ready: false, orders: replace.orders });
    expect(applyClosureCommand(next.state, f.plan.snapshot, f.archive, id, { ...replace, expectedRevision: 3 }, 1005).draft?.revision).toBe(4);
  });
  it.each([1999,2000,2001])("deadline precedence at %i freezes last committed readiness", (now) => {
    const f = fixture(), id = f.players[0]!.playerId;
    const first = applyClosureCommand(f.plan.state, f.plan.snapshot, f.archive, id, f.command(), 1001).state;
    const result = applyClosureCommand(first, f.plan.snapshot, f.archive, f.players[1]!.playerId, f.command(), now);
    expect(result.state.turn).toMatchObject({ status: "closed", closeReason: now < 2000 ? "all_ready" : "deadline", closedAtMs: now < 2000 ? now : 2000 });
    if (now >= 2000) { expect(result.error).toBe("TURN_CLOSED"); expect(freezeClosureInput(result.state, f.plan.snapshot, f.archive).players[1]).toMatchObject({ ready: false, revision: 0, orders: [] }); }
  });
  it.each(["same","stale","wrong-turn","extra","nonboolean"])("rejects %s without changing revision", (kind) => {
    const f = fixture(), c: Record<string, unknown> = f.command();
    if (kind === "same") c.ready = false;
    if (kind === "stale") c.expectedRevision = 2;
    if (kind === "wrong-turn") c.turnNumber = 2;
    if (kind === "extra") c.playerId = "forged";
    if (kind === "nonboolean") c.ready = "true";
    const result = applyClosureCommand(f.plan.state, f.plan.snapshot, f.archive, f.players[0]!.playerId, c, 1001);
    expect(result.error).toBeDefined(); expect(result.state.drafts).toEqual(f.plan.state.drafts);
  });
  it.each([-1,1000.5,NaN,Infinity,999,Number.MAX_SAFE_INTEGER+1])("rejects unsafe/nonmonotone clock %s", (now) => {
    const f = fixture(); expect(() => observeClosureDeadline(f.plan.state, now)).toThrow();
  });
  it("rejects backwards time after an accepted command and reads no ambient clock/randomness", () => {
    const f = fixture(); const clock = vi.spyOn(Date,"now").mockImplementation(() => { throw Error("ambient"); });
    const random = vi.spyOn(Math,"random").mockImplementation(() => { throw Error("ambient"); });
    try { const state = applyClosureCommand(f.plan.state, f.plan.snapshot, f.archive, f.players[0]!.playerId, f.command(), 1500).state;
      expect(() => observeClosureDeadline(state,1499)).toThrow();
    } finally { clock.mockRestore(); random.mockRestore(); }
  });
  it("strictly binds frozen runtime, snapshot, roster, explicit empty queues and closure", () => {
    const f = fixture(); const state = observeClosureDeadline(f.plan.state,2000), frozen = freezeClosureInput(state,f.plan.snapshot,f.archive);
    expect(ClosureFrozenInputSchema.safeParse(frozen).success).toBe(true);
    for (const bad of [{ ...frozen, schemaVersion: 1 }, { ...frozen, players: [...frozen.players].reverse() }, { ...frozen, accountId: "secret" }, { ...frozen, runtimeProfile: { ...f.plan.runtimeProfile, simulationVersion: "movement-drafts-v1" } }]) expect(ClosureFrozenInputSchema.safeParse(bad).success).toBe(false);
    expect(() => validateTurnClosureSnapshot({ ...f.plan.snapshot, formations: [] },f.archive,f.plan.runtimeProfile)).toThrow();
    expect(() => freezeClosureInput(f.plan.state,f.plan.snapshot,f.archive)).toThrow();
  });
  it("uses explicit v2 own-only queue response without widening old v1", () => {
    const f = fixture(), turn = observeClosureDeadline(f.plan.state,2000).turn, own = f.plan.state.drafts[0]!;
    const dto = { schemaVersion: 2, matchId: f.config.gameId, state: "READY", turn,
      own: { schemaVersion: 1, gameId: f.config.gameId, turnNumber: 1, revision: 0, ready: false, orders: [] },
      route: previewMovementDraft(f.plan.snapshot,f.archive,own.playerId,[]) };
    expect(ClosureMovementReadySchema.safeParse(dto).success).toBe(true); expect(MovementDraftReadySchema.safeParse(dto).success).toBe(false);
    expect(SetTurnReadyRequestSchema.safeParse({ schemaVersion: 1, expectedRevision: 0, ready: true, now: 1 }).success).toBe(false);
  });
});
