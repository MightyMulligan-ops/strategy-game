import { describe, expect, it, vi } from "vitest";
import { InitialArmiesSnapshotSchema } from "@strategy-game/shared-types/server";
import { freezeTurnInput, initializeArmiesTurnOne, resolveTurn, validateInitialArmiesSnapshot } from "../src/index.js";
import { armyFixture } from "./initial-armies-fixture.js";
import { canonicalJson } from "../src/determinism.js";

describe("authoritative initial armies", () => {
  it.each([2, 4, 10, 40])("replays %i-player armies across all pure sizes and boundary/stress seeds", (count) => {
    for (const side of [3, 5, 7] as const) for (const seed of [0, 42, 0xffff_ffff]) {
      const f = armyFixture(count, seed, side); const s = f.plan.snapshot;
      expect(s.units).toHaveLength(count * 6); expect(s.formations).toHaveLength(count);
      expect(new Set(s.units.map((u) => u.unitId)).size).toBe(count * 6);
      expect(new Set(s.formations.map((u) => u.formationId)).size).toBe(count);
      for (const formation of s.formations) {
        const members = s.units.filter((u) => formation.unitIds.includes(u.unitId));
        const city = f.archive.payload.startingState.cities.find((c) => c.ownerPlayerId === formation.ownerPlayerId)!;
        const node = f.archive.payload.startingState.resourceNodes.find((c) => c.cityId === city.cityId)!;
        expect(formation.position).toEqual(city.position);
        expect(members.filter((u) => u.kind === "LEADER")).toHaveLength(1);
        expect(members.filter((u) => u.kind === "INFANTRY")).toHaveLength(5);
        expect(members.every((u) => u.ownerPlayerId === formation.ownerPlayerId && u.originalSpawnNodeId === node.nodeId)).toBe(true);
        expect(members.find((u) => u.kind === "LEADER")).toMatchObject({ rank: "LIEUTENANT", specialization: "INFANTRY" });
      }
      const replay = initializeArmiesTurnOne(f.config, [...f.players].reverse(), f.archive, 9999);
      expect(canonicalJson(replay.snapshot)).toBe(canonicalJson(s));
      expect(validateInitialArmiesSnapshot(JSON.parse(JSON.stringify(s)), f.archive)).toEqual(s);
      expect(f.archive.payload.startingState.units).toEqual([]);
    }
  }, 30_000);
  it("freezes output deeply without mutating inputs or reading random/time", () => {
    const f = armyFixture(); const before = canonicalJson(f.archive);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock"); });
    const rng = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("random"); });
    try {
      const p = initializeArmiesTurnOne(f.config, f.players, f.archive, 10);
      for (const v of [p, p.snapshot, p.snapshot.units, p.snapshot.units[0], p.snapshot.formations[0]?.unitIds, p.snapshot.formations[0]?.position, p.state.drafts]) expect(Object.isFrozen(v)).toBe(true);
      expect(Object.isFrozen(f.config)).toBe(false); expect(canonicalJson(f.archive)).toBe(before);
    } finally { clock.mockRestore(); rng.mockRestore(); }
  });
  it.each(["cross-owner", "duplicate", "orphan", "extra-member", "missing-player", "rank", "source", "position", "unit-id", "formation-id", "snapshot-id", "policy", "extra-stat", "order"])("refuses %s corruption without repair", (kind) => {
    const f = armyFixture(); const s = JSON.parse(JSON.stringify(f.plan.snapshot));
    if (kind === "cross-owner") s.units[0].ownerPlayerId = s.players[1].playerId;
    if (kind === "duplicate") s.units[0].unitId = s.units[1].unitId;
    if (kind === "orphan") s.formations[0].unitIds[0] = `unit:${"0".repeat(64)}`;
    if (kind === "extra-member") s.formations[0].unitIds.push(s.formations[1].unitIds[0]);
    if (kind === "missing-player") s.formations.pop();
    if (kind === "rank") s.units.find((u: { kind: string }) => u.kind === "LEADER").rank = "GENERAL";
    if (kind === "source") s.units[0].originalSpawnNodeId = "supply-1";
    if (kind === "position") s.formations[0].position.x++;
    if (kind === "unit-id") { const id = `unit:${"a".repeat(64)}`; s.formations[0].unitIds[0] = id; s.units[0].unitId = id; }
    if (kind === "formation-id") s.formations[0].formationId = `formation:${"a".repeat(64)}`;
    if (kind === "snapshot-id") s.snapshotId = `initial-armies:${"a".repeat(64)}`;
    if (kind === "policy") s.policy.rangePerTurn = 251;
    if (kind === "extra-stat") s.units[0].hp = 100;
    if (kind === "order") s.formations.reverse();
    expect(() => validateInitialArmiesSnapshot(s, f.archive)).toThrow();
    // Strict shapes alone cannot establish canonical ID/hash/placement integrity.
    if (["position", "unit-id", "formation-id", "snapshot-id", "order"].includes(kind)) expect(InitialArmiesSnapshotSchema.safeParse(s).success).toBe(true);
  });
  it("binds match, roster, archive and profile; rejects invalid trusted clocks", () => {
    const f = armyFixture();
    for (const args of [
      [{ ...f.config, gameId: "other" }, f.players, f.archive, 1000],
      [f.config, [...f.players, f.players[0]], f.archive, 1000],
      [f.config, f.players, armyFixture(2, 1).archive, -1],
      [f.config, f.players, f.archive, Number.MAX_SAFE_INTEGER],
      [f.config, f.players, f.archive, 1000, { ...f.plan.runtimeProfile, simulationVersion: "initial-world-v1" }]
    ] as const) expect(() => initializeArmiesTurnOne(args[0], args[1], args[2], args[3], args[4])).toThrow();
    expect(() => validateInitialArmiesSnapshot(f.plan.snapshot, armyFixture(2, 1).archive)).toThrow();
  });
  it("refuses freezing and resolution even with claimed army metadata", () => {
    const f = armyFixture();
    expect(() => freezeTurnInput(f.plan.state, f.plan.snapshot)).toThrow();
    expect(resolveTurn(f.plan.snapshot, {}, f.plan.runtimeProfile, {}).ok).toBe(false);
  });
});
