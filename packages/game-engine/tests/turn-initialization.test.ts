import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_WORLD_RUNTIME_PROFILE, InitialWorldSnapshotSchema
} from "@strategy-game/shared-types/server";
import {
  createInitialWorldReference, createTurn, freezeTurnInput, generateWorld, initializeTurnOne, observeDeadline,
  resolveTurn, SEEDED_MOVEMENT_POLICY, UnsupportedInitialWorldOperationError, validateInitialWorldSnapshot
} from "../src/index.js";
import { canonicalJson } from "../src/determinism.js";

function fixture(count = 2, seed = 42, regionSide: 3 | 5 | 7 = 5) {
  const config = { schemaVersion: 1, gameId: "match", turnDurationMs: 1_000 };
  const ids = Array.from({ length: count }, (_, i) => `player-${String(i).padStart(2, "0")}`);
  const result = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed, players: ids, settings: { regionSide } });
  if (!result.ok) throw new Error(result.error.code);
  return { config, players: ids.map((playerId) => ({ schemaVersion: 1, gameId: "match", playerId, active: true })),
    archive: { matchId: "match", schemaVersion: 1, generatorVersion: "territory-grid-v1", payload: result.world }, openedAtMs: 100 };
}
type Fixture = ReturnType<typeof fixture>;
function initialize(f: Fixture) { return initializeTurnOne(f.config, f.players, f.archive, f.openedAtMs); }

describe("pure initial-world Turn 1", () => {
  it.each([2, 4, 10, 40])("initializes %i active players without advancing or changing the world", (count) => {
    const f = fixture(count); const before = JSON.stringify(f); const result = initialize(f);
    expect(JSON.stringify(f)).toBe(before);
    expect(result.state.turn).toEqual({ schemaVersion: 1, gameId: "match", turnNumber: 1, status: "open", openedAtMs: 100, deadlineAtMs: 1_100 });
    expect(result.state.drafts).toEqual(f.players.map((p) => ({ playerId: p.playerId, revision: 0, ready: false, orders: [] })));
    expect(result.snapshot).toMatchObject({ schemaVersion: 2, kind: "initial_world", completedTurnNumber: 0, stateVersion: 0,
      config: f.config, players: f.players, worldRef: { matchId: "match", archiveSchemaVersion: 1, generatorVersion: "territory-grid-v1" } });
    expect(result.runtimeProfile).toEqual(INITIAL_WORLD_RUNTIME_PROFILE);
    expect(result.runtimeProfile.movementTieBreakPolicy).toBe(SEEDED_MOVEMENT_POLICY);
    expect(result.snapshot).not.toHaveProperty("seed"); expect(result.snapshot).not.toHaveProperty("payload");
    expect(validateInitialWorldSnapshot(result.snapshot, f.archive)).toEqual(result.snapshot);
  });
  it.each([3, 7] as const)("accepts approved archive regionSide=%i without inventing generation settings", (side) => {
    const f = fixture(40, 0xffff_ffff, side);
    expect(initialize(f).snapshot.worldRef).toEqual(createInitialWorldReference(f.archive));
  });
  it("replays after JSON roundtrip and canonicalizes roster and object keys, preserving archive array order", () => {
    const f = fixture(10); const first = initialize(f);
    const replay = structuredClone(f); replay.players.reverse();
    const shuffled = Object.fromEntries(Object.entries(replay.archive.payload).reverse());
    expect(initializeTurnOne(Object.fromEntries(Object.entries(replay.config).reverse()), replay.players,
      { ...replay.archive, payload: shuffled }, replay.openedAtMs)).toEqual(first);
    expect(JSON.stringify(initialize(JSON.parse(JSON.stringify(f))))).toBe(JSON.stringify(first));
    const arrayReorder = { ...f.archive, payload: { ...f.archive.payload, territories: [...f.archive.payload.territories].reverse() } };
    expect(createInitialWorldReference(arrayReorder).digest).not.toBe(first.snapshot.worldRef.digest);
  });
  it("hashes the complete validated payload with canonical SHA-256 and binds snapshot contents", () => {
    const f = fixture(); const result = initialize(f);
    const expected = createHash("sha256").update(canonicalJson(f.archive.payload)).digest("hex");
    expect(result.snapshot.worldRef.digest).toBe(`sha256:${expected}`);
    const changed = fixture(2, 43);
    expect(initialize(changed).snapshot.snapshotId).not.toBe(result.snapshot.snapshotId);
    expect(() => validateInitialWorldSnapshot(result.snapshot, changed.archive)).toThrow(/archive|digest/);
    expect(() => validateInitialWorldSnapshot({ ...result.snapshot, worldRef: { ...result.snapshot.worldRef, digest: `sha256:${"0".repeat(64)}` } }, f.archive)).toThrow(/digest/);
    expect(() => validateInitialWorldSnapshot({ ...result.snapshot, snapshotId: `initial-world:${"0".repeat(64)}` }, f.archive)).toThrow(/identity/);
    expect(() => validateInitialWorldSnapshot({ ...result.snapshot, config: { ...result.snapshot.config, turnDurationMs: 2_000 } }, f.archive)).toThrow(/identity/);
    const other = { ...result.snapshot, config: { ...f.config, gameId: "other" },
      players: result.snapshot.players.map((p) => ({ ...p, gameId: "other" })), worldRef: { ...result.snapshot.worldRef, matchId: "other" } };
    expect(InitialWorldSnapshotSchema.safeParse(other).success).toBe(true);
    expect(() => validateInitialWorldSnapshot(other, f.archive)).toThrow(/archive/);
  });
  it("returns deeply immutable copies without freezing caller-owned inputs", () => {
    const f = structuredClone(fixture()); const before = structuredClone(f); const result = initialize(f);
    expect(f).toEqual(before);
    for (const value of [f.config, f.players, f.players[0], f.archive, f.archive.payload, f.archive.payload.territories[0]]) expect(Object.isFrozen(value)).toBe(false);
    for (const value of [result, result.runtimeProfile, result.runtimeProfile.ruleset, result.snapshot, result.snapshot.worldRef,
      result.snapshot.players, result.snapshot.players[0], result.state, result.state.turn, result.state.drafts, result.state.drafts[0]?.orders]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => Object.assign(result.snapshot.worldRef, { digest: "changed" })).toThrow();
    Object.assign(f.config, { turnDurationMs: 7 }); Object.assign(f.players[0]!, { playerId: "changed" });
    expect(result.state.config.turnDurationMs).toBe(1_000); expect(result.snapshot.players[0]!.playerId).toBe("player-00");
  });
  it("reads neither wall-clock time nor uncontrolled randomness", () => {
    const f = fixture(); const now = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Clock read"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Random read"); });
    try { expect(initialize(f).state.turn.openedAtMs).toBe(100); } finally { now.mockRestore(); random.mockRestore(); }
  });
  it.each([-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])("rejects invalid/overflowing opening instant %s", (time) => {
    const f = fixture(); expect(() => initializeTurnOne(f.config, f.players, f.archive, time)).toThrow();
  });
  it("preserves safe boundary deadlines and does not clamp very short durations", () => {
    const f = fixture(); const config = { ...f.config, turnDurationMs: 1 };
    expect(initializeTurnOne(config, f.players, f.archive, Number.MAX_SAFE_INTEGER - 1).state.turn.deadlineAtMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(initializeTurnOne({ ...config, turnDurationMs: Number.MAX_SAFE_INTEGER }, f.players, f.archive, 0).state.turn.deadlineAtMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(initializeTurnOne(config, f.players, f.archive, 100).state.turn.deadlineAtMs).toBe(101);
  });
});

const invalidInputs: [string, (f: Fixture) => Parameters<typeof initializeTurnOne>][] = [
  ["config version", (f) => [{ ...f.config, schemaVersion: 2 }, f.players, f.archive, 100]],
  ["extra config fields", (f) => [{ ...f.config, seed: 1 }, f.players, f.archive, 100]],
  ["zero duration", (f) => [{ ...f.config, turnDurationMs: 0 }, f.players, f.archive, 100]],
  ["unsafe duration", (f) => [{ ...f.config, turnDurationMs: Number.MAX_SAFE_INTEGER }, f.players, f.archive, 100]],
  ["wrong match", (f) => [f.config, f.players, { ...f.archive, matchId: "other" }, 100]],
  ["archive version", (f) => [f.config, f.players, { ...f.archive, schemaVersion: 2 }, 100]],
  ["archive generator", (f) => [f.config, f.players, { ...f.archive, generatorVersion: "unknown" }, 100]],
  ["extra archive fields", (f) => [f.config, f.players, { ...f.archive, digest: "forged" }, 100]],
  ["payload version", (f) => [f.config, f.players, { ...f.archive, payload: { ...f.archive.payload, schemaVersion: 2 } }, 100]],
  ["payload units", (f) => [f.config, f.players, { ...f.archive, payload: { ...f.archive.payload, startingState: { ...f.archive.payload.startingState, units: [{}] } } }, 100]],
  ["duplicate players", (f) => [f.config, [f.players[0], f.players[0]], f.archive, 100]],
  ["inactive players", (f) => [f.config, f.players.map((p) => ({ ...p, active: false })), f.archive, 100]],
  ["wrong player game", (f) => [f.config, f.players.map((p) => ({ ...p, gameId: "other" })), f.archive, 100]],
  ["wrong player ID", (f) => [f.config, f.players.map((p, i) => ({ ...p, playerId: `other-${i}` })), f.archive, 100]],
  ["one player", (f) => [f.config, f.players.slice(0, 1), f.archive, 100]],
  ["41 players", (f) => [f.config, Array.from({ length: 41 }, (_, i) => ({ ...f.players[0], playerId: `p${i}` })), f.archive, 100]],
  ["malformed roster", (f) => [f.config, null, f.archive, 100]],
  ["unsupported profile", (f) => [f.config, f.players, f.archive, 100, { ...INITIAL_WORLD_RUNTIME_PROFILE, simulationVersion: "empty-turn-v1" }]],
  ["executable profile", (f) => [f.config, f.players, f.archive, 100, { ...INITIAL_WORLD_RUNTIME_PROFILE, execute: () => undefined }]]
];
describe("initialization input failures", () => {
  it.each(invalidInputs)("rejects %s without changing inputs", (_name, argumentsFor) => {
    const f = structuredClone(fixture()); const before = structuredClone(f);
    expect(() => initializeTurnOne(...argumentsFor(f))).toThrow(); expect(f).toEqual(before);
    expect(Object.isFrozen(f.config)).toBe(false); expect(Object.isFrozen(f.archive.payload)).toBe(false);
  });
});

describe("initial-world operation rejection", () => {
  it("explicitly rejects freezing and resolution before touching mutable inputs", () => {
    const f = fixture(); const initial = initialize(f);
    const state = structuredClone(observeDeadline(initial.state, 1_100)); const snapshot = structuredClone(initial.snapshot);
    const before = JSON.stringify({ state, snapshot });
    expect(() => freezeTurnInput(state, snapshot)).toThrow(UnsupportedInitialWorldOperationError);
    const result = resolveTurn(snapshot, {}, initial.runtimeProfile, 42);
    expect(result).toMatchObject({ ok: false, error: { code: "version_mismatch", message: expect.stringContaining("initialization only") } });
    expect(result).not.toHaveProperty("result"); expect(JSON.stringify({ state, snapshot })).toBe(before);
    expect(Object.isFrozen(state)).toBe(false); expect(Object.isFrozen(snapshot)).toBe(false);
  });
  it("rejects profile claims even if snapshot metadata is stripped or disguised", () => {
    const f = fixture(); const initial = initialize(f); const { kind: _kind, worldRef: _world, ...stripped } = initial.snapshot;
    const disguised = { ...stripped, schemaVersion: 1 };
    expect(() => freezeTurnInput(observeDeadline(initial.state, 1_100), disguised)).toThrow(UnsupportedInitialWorldOperationError);
    expect(resolveTurn({}, {}, initial.runtimeProfile, 42)).toMatchObject({ ok: false, error: { code: "version_mismatch" } });
  });
  it("preserves empty-turn-v1 freezing and deterministic resolution", () => {
    const f = fixture(); const state = observeDeadline(createTurn(f.config, f.players, 100), 1_100);
    const metadata = { schemaVersion: 1, ruleset: { rulesetId: "baseline", version: "1" }, simulationVersion: "empty-turn-v1" };
    const snapshot = { ...metadata, snapshotId: "empty", config: f.config, players: f.players, completedTurnNumber: 0, stateVersion: 0 };
    const frozen = freezeTurnInput(state, snapshot);
    expect(resolveTurn(snapshot, frozen, { ...metadata, movementTieBreakPolicy: SEEDED_MOVEMENT_POLICY }, 42)).toMatchObject({ ok: true,
      result: { nextState: { completedTurnNumber: 1, stateVersion: 1 } } });
  });
});
