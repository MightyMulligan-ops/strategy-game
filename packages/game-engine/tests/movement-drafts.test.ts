import { describe, expect, it, vi } from "vitest";
import { MovementDraftCommandSchema, MovementDraftReadySchema } from "@strategy-game/shared-types";
import { InitialWorldArchiveSchema, MovementDraftSnapshotSchema } from "@strategy-game/shared-types/server";
import { freezeTurnInput, initializeMovementDrafts, planMovementDrafts, previewMovementDraft, resolveTurn, reviseMovementDraft, validateMovementDraftSnapshot } from "../src/index.js";
import { armyFixture } from "./initial-armies-fixture.js";
import { canonicalJson } from "../src/determinism.js";

function fixture() {
  const f = armyFixture(); const archive = InitialWorldArchiveSchema.parse(f.archive); const plan = initializeMovementDrafts(f.config, f.players, archive, 1000);
  const formation = plan.snapshot.formations[0]!, actor = formation.ownerPlayerId;
  const direction = formation.position.x < f.archive.payload.bounds.width / 2 ? 1 : -1;
  const order = (id: string, x: number, y = 0) => ({ type: "move" as const, orderId: id, stackId: formation.formationId,
    destination: { x: formation.position.x + direction * x, y: formation.position.y + y } });
  const command = (orders: unknown, expectedRevision = 0) => ({ schemaVersion: 1, gameId: f.config.gameId, turnNumber: 1, kind: "replace_orders", orders, expectedRevision });
  const draft = plan.state.drafts[0]!;
  const revise = (input: unknown, now = 1001, previous = draft) => reviseMovementDraft(plan.snapshot, archive, previous, input, now, 1000, 2000);
  return { ...f, archive, plan, actor, formation, draft, order, command, revise };
}
describe("movement-draft v4 runtime (no execution)", () => {
  it.each([2, 4, 10, 40])("preserves %i-player army IDs/archive while separately binding runtime identity", (count) => {
    for (const side of [3, 5, 7] as const) for (const seed of [0, 42, 0xffff_ffff]) {
      const f = armyFixture(count, seed, side), before = canonicalJson(f.archive);
      const plan = planMovementDrafts(f.config, [...f.players].reverse(), f.archive);
      expect(plan.snapshot.units).toEqual(f.plan.snapshot.units); expect(plan.snapshot.formations).toEqual(f.plan.snapshot.formations);
      expect(plan.snapshot.initialArmiesSnapshotId).toBe(f.plan.snapshot.snapshotId);
      expect(plan.snapshot).toMatchObject({ schemaVersion: 4, kind: "movement_drafts", simulationVersion: "movement-drafts-v1" });
      expect(plan.snapshot.snapshotId).not.toBe(f.plan.snapshot.snapshotId);
      expect(validateMovementDraftSnapshot(JSON.parse(JSON.stringify(plan.snapshot)), f.archive)).toEqual(plan.snapshot);
      expect(canonicalJson(planMovementDrafts(f.config, f.players, f.archive))).toBe(canonicalJson(plan));
      expect(canonicalJson(f.archive)).toBe(before); expect(f.archive.payload.startingState.units).toEqual([]);
    }
  }, 30_000);
  it("does not relabel v3, reuse hashes or accept modified provenance/version/policy", () => {
    const f = fixture();
    expect(() => validateMovementDraftSnapshot(f.plan.snapshot, armyFixture(2, 1).archive)).toThrow();
    expect(() => validateMovementDraftSnapshot(f.plan.snapshot, f.archive, f.plan.runtimeProfile.ruleset)).toThrow();
    expect(() => validateMovementDraftSnapshot(f.plan.snapshot, { ...f.archive, matchId: "other" })).toThrow();
    expect(MovementDraftSnapshotSchema.safeParse(f.plan.snapshot).success).toBe(true);
    expect(() => validateMovementDraftSnapshot(f.plan.snapshot, f.archive, f.plan.runtimeProfile)).not.toThrow();
    expect(() => validateMovementDraftSnapshot(fixture().plan.snapshot, f.archive, { ...f.plan.runtimeProfile, simulationVersion: "initial-armies-v1" })).toThrow();
    for (const field of ["snapshotId", "initialArmiesSnapshotId", "simulationVersion"]) expect(() => validateMovementDraftSnapshot({ ...f.plan.snapshot, [field]: "forged" }, f.archive)).toThrow();
    expect(() => validateMovementDraftSnapshot(f.plan.snapshot.units, f.archive)).toThrow();
    expect(() => freezeTurnInput(f.plan.state, f.plan.snapshot)).toThrow();
    expect(resolveTurn(f.plan.snapshot, {}, f.plan.runtimeProfile, 0).ok).toBe(false);
  });
  it.each([[0, true], [250, true], [251, false]])("assesses %i map units with no tolerance", (distance, accepted) => {
    const f = fixture(), work = () => f.revise(f.command([f.order("one", distance)]));
    if (accepted) expect(work().route).toMatchObject({ distance, remaining: 250 - distance });
    else expect(work).toThrowError(expect.objectContaining({ code: "INVALID_DRAFT" }));
  });
  it("accepts a 150/200 diagonal of exactly 250 and rejects a slightly longer integer diagonal", () => {
    const f = fixture(); expect(f.revise(f.command([f.order("one", 150, 200)])).route.distance).toBe(250);
    expect(() => f.revise(f.command([f.order("one", 151, 200)]))).toThrow();
  });
  it("derives cumulative numbering, stable edits/reordering, cancellation and explicit empty replacement", () => {
    const f = fixture(), before = canonicalJson(f.plan);
    const first = f.revise(f.command([f.order("a", 50), f.order("b", 100)]));
    expect(first.route.segments.map((s) => [s.moveNumber, s.distance, s.cumulative])).toEqual([[1, 50, 50], [2, 50, 100]]);
    const reordered = f.revise(f.command([f.order("b", 100), f.order("a", 50)], 1), 1002, first.draft);
    expect(reordered.route.segments.map((s) => [s.orderId, s.moveNumber])).toEqual([["b", 1], ["a", 2]]);
    expect(reordered.route.distance).toBe(150);
    const canceled = f.revise({ schemaVersion: 1, kind: "cancel_order", gameId: f.config.gameId, turnNumber: 1, expectedRevision: 2, orderId: "b" }, 1003, reordered.draft);
    expect(canceled.route.segments.map((s) => [s.orderId, s.moveNumber])).toEqual([["a", 1]]);
    expect(f.revise(f.command([], 3), 1004, canceled.draft).draft).toMatchObject({ revision: 4, ready: false, orders: [] });
    expect(canonicalJson(f.plan)).toBe(before); expect(Object.isFrozen(first.draft.orders[0]?.destination)).toBe(true);
    const view = MovementDraftReadySchema.parse({ schemaVersion: 1, matchId: f.config.gameId, state: "READY", turn: f.plan.state.turn,
      own: { schemaVersion: 1, gameId: f.config.gameId, turnNumber: 1, revision: first.draft.revision, ready: false, orders: first.draft.orders }, route: first.route });
    expect(view.route.distance).toBe(100);
  });
  it("rejects the whole over-budget route, including return trips and invalid reordering", () => {
    const f = fixture(); const command = f.command([f.order("a", 150), f.order("b", 0)]); const before = canonicalJson(f.draft);
    expect(() => f.revise(command)).toThrowError(expect.objectContaining({ code: "INVALID_DRAFT" }));
    expect(canonicalJson(f.draft)).toBe(before);
    const valid = [f.order("a", 100), f.order("b", 200)];
    expect(f.revise(f.command(valid)).route.distance).toBe(200);
    expect(() => f.revise(f.command([...valid].reverse()))).toThrow();
  });
  it.each([1999, 2000, 2001])("half-open acceptance at trusted time %i leaves the turn OPEN", (now) => {
    const f = fixture(); const work = () => f.revise(f.command([]), now);
    if (now < 2000) expect(work().draft.ready).toBe(false);
    else expect(work).toThrowError(expect.objectContaining({ code: "DEADLINE_PASSED" }));
    expect(f.plan.state.turn.status).toBe("open"); expect(f.plan.state.lastObservedAtMs).toBe(1000);
  });
  it.each(["foreign", "duplicate", "attack", "fraction", "negative", "outside", "nonfinite", "extra", "ready", "split"])("rejects %s without changing authority", (kind) => {
    const f = fixture(); let orders: unknown[] = [f.order("a", 0)];
    const o = orders[0] as Record<string, unknown>;
    if (kind === "foreign") o.stackId = f.plan.snapshot.formations[1]!.formationId;
    if (kind === "duplicate") orders.push(orders[0]);
    if (kind === "attack") orders = [{ orderId: "a", type: "attack", stackId: f.formation.formationId, targetId: "other" }];
    if (kind === "fraction") o.destination = { x: .5, y: 0 };
    if (kind === "negative") o.destination = { x: -1, y: 0 };
    if (kind === "outside") o.destination = { x: 1001, y: 0 };
    if (kind === "nonfinite") o.destination = { x: Infinity, y: 0 };
    if (kind === "extra") o.moveNumber = 1;
    if (kind === "split") o.unitIds = [f.plan.snapshot.units[0]!.unitId];
    const input = kind === "ready" ? { schemaVersion: 1, kind: "set_ready", gameId: f.config.gameId, turnNumber: 1, expectedRevision: 0, ready: true } : f.command(orders);
    expect(() => f.revise(input)).toThrow();
    expect(f.draft.revision).toBe(0); expect(f.formation.position).toEqual(f.plan.snapshot.formations[0]!.position);
  });
  it("rejects stale, missing cancellation and unsafe clocks/counters; does not read time or RNG", () => {
    const f = fixture();
    expect(() => f.revise(f.command([], 1))).toThrowError(expect.objectContaining({ code: "STALE_REVISION" }));
    expect(() => f.revise({ ...f.command([]), kind: "cancel_order", orders: undefined, orderId: "missing" })).toThrow();
    expect(() => f.revise({ schemaVersion: 1, gameId: f.config.gameId, turnNumber: 1, expectedRevision: 0, kind: "cancel_order", orderId: "missing" })).toThrowError(expect.objectContaining({ code: "ORDER_NOT_FOUND" }));
    for (const now of [-1, .5, NaN, Infinity]) expect(() => f.revise(f.command([]), now)).toThrow();
    expect(() => f.revise(f.command([], Number.MAX_SAFE_INTEGER), 1001, { ...f.draft, revision: Number.MAX_SAFE_INTEGER })).toThrowError(expect.objectContaining({ code: "REVISION_EXHAUSTED" }));
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("random"); });
    try { expect(f.revise(f.command([])).draft.revision).toBe(1); } finally { clock.mockRestore(); random.mockRestore(); }
    expect(MovementDraftCommandSchema.safeParse({ ...f.command([]), ownerPlayerId: f.actor }).success).toBe(false);
    expect(previewMovementDraft(f.plan.snapshot, f.archive, f.actor, []).segments).toEqual([]);
  });
});
