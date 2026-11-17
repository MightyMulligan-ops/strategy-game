import { describe, expect, it } from "vitest";
import { resolveMultiForceCombat, MULTI_FORCE_COMBAT_VERSION, MULTI_FORCE_ROLL, MULTI_FORCE_SCHEDULE } from "../src/multi-force-combat.js";
import type { MultiForceInput, MultiForceUnit, MultiForceFormation, MultiForceAudit } from "../src/multi-force-combat.js";

function troop(unitId: string, overrides: Partial<MultiForceUnit> = {}): MultiForceUnit {
  return { unitId, originalSpawnNodeId: `spawn:${unitId}`, kind: "TROOP", unitType: "INFANTRY",
    hp: 7, maxHp: 7, attack: 4, defense: 6, leadershipEligible: true, ...overrides } as MultiForceUnit;
}
function leader(unitId: string, rank: "GENERAL" | "COLONEL" | "CAPTAIN" | "LIEUTENANT", overrides: Partial<MultiForceUnit> = {}): MultiForceUnit {
  return { ...troop(unitId), kind: "LEADER", rank, specialization: "INFANTRY", ...overrides } as MultiForceUnit;
}
function formation(ownerPlayerId: string, units = [troop(`${ownerPlayerId}:1`)], stance: "moving" | "stationary" = "moving", formationId = `f:${ownerPlayerId}`): MultiForceFormation {
  return { formationId, ownerPlayerId, stance, units };
}
function input(formations: readonly MultiForceFormation[], allies: string[][] = []): MultiForceInput {
  const players = [...new Set(formations.map(f => f.ownerPlayerId))];
  return { schemaVersion: 1, rulesetVersion: MULTI_FORCE_COMBAT_VERSION, encounterId: "encounter:fixture", seed: 42,
    ownership: { locationId: "city", ownerPlayerId: "b" },
    rules: { schedule: MULTI_FORCE_SCHEDULE, roll: MULTI_FORCE_ROLL, statFloor: "minimum-one-v1", alliances: "equivalence-v1",
      leadership: [{ specialization: "INFANTRY", unitType: "INFANTRY", attack: 3, defense: 2 }] },
    relationships: players.flatMap(from => players.filter(to => from !== to).map(to => ({ from, to,
      relation: allies.some(group => group.includes(from) && group.includes(to)) ? "ally" as const : "hostile" as const }))), formations };
}
function run(value: MultiForceInput, budget?: { maxRounds: number; maxActions: number }): MultiForceAudit {
  const result = resolveMultiForceCombat(value, budget);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.error.code);
  return result.audit;
}
function assertRoundInvariants(audit: MultiForceAudit) {
  const unitFormation = new Map(audit.input.formations.flatMap(f => f.units.map(u => [u.unitId, f] as const)));
  const alive = new Set(unitFormation.keys());
  for (const round of audit.rounds) {
    expect(new Set(round.actions.map(a => a.sourceUnitId)).size).toBe(round.actions.length);
    // All alive units in an active hostile encounter act exactly once.
    const activePlayers = new Set([...alive].map(u => unitFormation.get(u)!.ownerPlayerId));
    const actors = [...alive].filter(u => audit.input.relationships.some(r => r.from === unitFormation.get(u)!.ownerPlayerId && r.relation === "hostile" && activePlayers.has(r.to)));
    expect(round.actions.map(a => a.sourceUnitId).sort()).toEqual(actors.sort());
    for (const a of round.actions) {
      expect(alive.has(a.sourceUnitId)).toBe(true);
      expect(a.damage).toBe(Math.floor(a.raw * a.effectiveStat / 0x100000000) + 1);
      expect(a.damage).toBeGreaterThan(0);
      expect(audit.input.relationships.find(r => r.from === a.sourcePlayerId && r.to === a.targetPlayerId)?.relation).toBe("hostile");
      const dealt = round.hits.filter(h => h.sourceUnitId === a.sourceUnitId).reduce((n, h) => n + h.damage, 0);
      expect(dealt + round.discarded.find(d => d.sourceUnitId === a.sourceUnitId)!.damage).toBe(a.damage);
    }
    for (const h of round.hits) {
      const source = unitFormation.get(h.sourceUnitId)!, target = unitFormation.get(h.targetUnitId)!;
      expect(audit.input.relationships.find(r => r.from === source.ownerPlayerId && r.to === target.ownerPlayerId)?.relation).toBe("hostile");
      expect(h.hpBefore - h.hpAfter).toBe(h.damage);
      expect(h.hpAfter).toBeGreaterThanOrEqual(0);
    }
    for (const dead of round.casualties) alive.delete(dead);
  }
  expect(audit.units.filter(u => u.finalHp > 0).map(u => u.unitId).sort()).toEqual([...alive].sort());
}

describe("pure multi-force combat 1B", () => {
  it("uses fixed assault roles and heals only after complete resolution", () => {
    const a = run(input([formation("a", [troop("a", { hp: 100, maxHp: 100, attack: 1 })]), formation("b", [troop("b", { hp: 20, maxHp: 20, defense: 1 })], "stationary")]));
    expect(a.rounds.length).toBe(20);
    expect(a.rounds.flatMap(r => r.actions).every(x => x.role === (x.sourcePlayerId === "a" ? "ATK" : "DEF"))).toBe(true);
    expect(a.units.find(u => u.unitId === "a")).toMatchObject({ encounterHp: 80, finalHp: 100 });
    expect(a.ownershipRecipientPlayerId).toBe("a"); assertRoundInvariants(a);
  });
  it("commits simultaneous mutual destruction with no winner, healing or ownership recipient", () => {
    const a = run(input([formation("a", [troop("a", { hp: 1, maxHp: 7, attack: 1, defense: 1 })]),
      formation("b", [troop("b", { hp: 1, maxHp: 7, attack: 1, defense: 1 })], "stationary")]));
    expect(a.outcome).toBe("mutual_destruction");
    expect(a.victoriousPlayerIds).toEqual([]); expect(a.ownershipRecipientPlayerId).toBeNull();
    expect(a.rounds).toHaveLength(1); expect(a.rounds[0]!.actions).toHaveLength(2);
    expect(a.units.every(u => u.encounterHp === 0 && u.finalHp === 0)).toBe(true);
    expect(a.input.ownership!.ownerPlayerId).toBe("b"); assertRoundInvariants(a);
  });
  it("alternates moving pair roles from a seeded initial assignment", () => {
    const a = run(input([formation("a", [troop("a", { hp: 50, maxHp: 50, attack: 1, defense: 1 })]), formation("b", [troop("b", { hp: 50, maxHp: 50, attack: 1, defense: 1 })])]));
    for (let i = 1; i < a.rounds.length; i++) expect(a.rounds[i]!.pairRoles[0]!.aRole).not.toBe(a.rounds[i - 1]!.pairRoles[0]!.bRole);
    const roles = a.rounds.map(r => r.actions.find(x => x.sourcePlayerId === "a")!.role);
    for (let i = 1; i < roles.length; i++) expect(roles[i]).not.toBe(roles[i - 1]);
    assertRoundInvariants(a);
  });
  it("keeps a stationary city owner defending against already stationary enemies", () => {
    const a = run(input([formation("a", [troop("a")], "stationary"), formation("b", [troop("b")], "stationary")]));
    expect(a.rounds.flatMap(r => r.actions).every(x => x.role === (x.sourcePlayerId === "b" ? "DEF" : "ATK"))).toBe(true);
    const b = run({ ...a.input, ownership: null });
    if (b.rounds.length > 1) expect(b.rounds[0]!.actions[0]!.role).not.toBe(b.rounds[1]!.actions.find(x => x.sourcePlayerId === b.rounds[0]!.actions[0]!.sourcePlayerId)!.role);
  });
  it("groups same-player formations while preserving formation/unit/spawn identities", () => {
    const value = input([formation("a", [troop("a1")], "moving", "a1"), formation("a", [troop("a2")], "moving", "a2"), formation("b", [troop("b", { hp: 30, maxHp: 30 })], "stationary")]);
    const a = run(value);
    expect(a.units.map(u => [u.unitId, u.formationId, u.originalSpawnNodeId])).toEqual([
      ["a1", "a1", "spawn:a1"], ["a2", "a2", "spawn:a2"], ["b", "f:b", "spawn:b"]]);
    expect(a.rounds[0]!.actions.filter(x => x.sourcePlayerId === "a")).toHaveLength(2);
    const bTargets = a.rounds.slice(0, 2).map(r => r.actions.find(x => x.sourcePlayerId === "b")!.targetFormationId);
    expect(new Set(bTargets).size).toBe(2); assertRoundInvariants(a);
  });
  it("interleaves allied contributions and incoming damage without friendly fire", () => {
    const a = run(input([formation("a", [troop("a1"), troop("a2")]), formation("c", [troop("c1"), troop("c2")]),
      formation("b", [troop("b1", { hp: 60, maxHp: 60, attack: 1, defense: 1 }), troop("b2", { hp: 60, maxHp: 60, attack: 1, defense: 1 })], "stationary")], [["a", "c"]]));
    const first = a.rounds[0]!;
    expect(new Set(first.actions.filter(x => x.sourcePlayerId === "b").map(x => x.targetPlayerId)).size).toBe(2);
    const allied = first.actions.filter(x => x.sourcePlayerId !== "b").map(x => x.sourcePlayerId);
    expect(allied[0]).not.toBe(allied[1]); expect(allied[0]).toBe(allied[2]);
    assertRoundInvariants(a);
  });
  it("supports three hostile movers with pair-relative complementary alternating roles", () => {
    const a = run(input(["a", "b", "c"].map(p => formation(p, [troop(p, { hp: 100, maxHp: 100, attack: 1, defense: 1 })]))));
    expect(a.rounds[0]!.pairRoles).toHaveLength(3);
    for (const pair of a.rounds[0]!.pairRoles) {
      expect(pair.aRole).not.toBe(pair.bRole);
      const next = a.rounds[1]!.pairRoles.find(p => [p.a, p.b].includes(pair.a) && [p.a, p.b].includes(pair.b))!;
      expect(next.a === pair.a ? next.aRole : next.bRole).not.toBe(pair.aRole);
    }
    expect(a.rounds[1]!.forceOrder).toEqual([...a.rounds[0]!.forceOrder.slice(1), a.rounds[0]!.forceOrder[0]]);
    assertRoundInvariants(a);
  });
  it("continues hostile mover alternation after a stationary defender is destroyed", () => {
    const a = run(input([formation("a", [troop("a", { hp: 100, maxHp: 100, attack: 10, defense: 10 })]),
      formation("c", [troop("c", { hp: 100, maxHp: 100, attack: 10, defense: 10 })]), formation("b", [troop("b", { hp: 1, maxHp: 1, attack: 1, defense: 1 })], "stationary")]));
    const death = a.rounds.findIndex(r => r.casualties.includes("b"));
    expect(death).toBeGreaterThanOrEqual(0); expect(a.rounds.length).toBeGreaterThan(death + 1);
    for (const r of a.rounds) for (const p of r.pairRoles) if (p.a !== "f:b" && p.b !== "f:b") {
      const first = a.rounds[0]!.pairRoles.find(p => p.a !== "f:b" && p.b !== "f:b")!;
      expect(p.a === first.a ? p.aRole : p.bRole).toBe(r.number % 2 ? first.aRole : first.bRole);
    }
    assertRoundInvariants(a);
  });
  it("retains every round-start action including simultaneous deaths and uneven rosters", () => {
    const a = run(input([formation("a", [troop("a1", { hp: 1, maxHp: 1, attack: 1, defense: 1 }), troop("a2", { hp: 1, maxHp: 1, attack: 1, defense: 1 })]),
      formation("b", [troop("b", { hp: 1, maxHp: 1, attack: 100, defense: 100 })])]));
    expect(a.rounds[0]!.actions).toHaveLength(3); expect(a.rounds[0]!.actions.filter(x => x.sourcePlayerId === "b")).toHaveLength(1);
    assertRoundInvariants(a);
    const mutual = run(input([formation("a", [troop("a", { hp: 1, maxHp: 1, attack: 1, defense: 1 })]), formation("b", [troop("b", { hp: 1, maxHp: 1, attack: 1, defense: 1 })])]));
    expect(mutual).toMatchObject({ outcome: "mutual_destruction", victoriousPlayerIds: [], ownershipRecipientPlayerId: null });
    expect(mutual.rounds[0]!.actions).toHaveLength(2);
  });
  it("finishes wounded ordinary troops before another and targets leaders last", () => {
    const a = run(input([formation("a", [troop("a", { hp: 100, maxHp: 100, attack: 1, defense: 1 })]),
      formation("b", [troop("b1", { hp: 3, maxHp: 3, attack: 1, defense: 1 }), troop("b2", { hp: 3, maxHp: 3, attack: 1, defense: 1 }), leader("bl", "LIEUTENANT", { attack: 1, defense: 1 })], "stationary")]));
    const hits = a.rounds.flatMap(r => r.hits).filter(h => h.targetFormationId === "f:b");
    expect(hits.slice(0, 3).every(h => h.targetUnitId === hits[0]!.targetUnitId)).toBe(true);
    expect(hits.slice(3, 6).every(h => h.targetUnitId !== hits[0]!.targetUnitId && h.targetUnitId !== "bl")).toBe(true);
    expect(hits.slice(6).every(h => h.targetUnitId === "bl")).toBe(true);
    assertRoundInvariants(a);
  });
  it("finishes initially wounded ordinary units before intact troops and leaders", () => {
    const a = run(input([formation("a", [troop("intact", { hp: 20, maxHp: 20, attack: 1, defense: 1 }),
      troop("wounded", { hp: 3, maxHp: 20, attack: 1, defense: 1 }), leader("leader", "LIEUTENANT", { hp: 20, maxHp: 20, attack: 1, defense: 1 })]),
      formation("b", [troop("b", { hp: 100, maxHp: 100, attack: 1, defense: 1 })], "stationary")]));
    expect(a.rounds.slice(0, 3).map(r => r.hits.find(h => h.sourceUnitId === "b")!.targetUnitId)).toEqual(["wounded", "wounded", "wounded"]);
    expect(a.rounds[3]!.hits.find(h => h.sourceUnitId === "b")!.targetUnitId).toBe("intact");
    assertRoundInvariants(a);
  });
  it("rotates packet overflow among hostile armies without extra rolls or friendly fire", () => {
    const a = run(input([formation("a", [troop("a1", { hp: 1, maxHp: 1, attack: 1, defense: 1 }), troop("a2", { hp: 1, maxHp: 1, attack: 1, defense: 1 })]),
      formation("c", [troop("c1", { hp: 1, maxHp: 1, attack: 1, defense: 1 }), troop("c2", { hp: 1, maxHp: 1, attack: 1, defense: 1 })]),
      formation("b", [troop("b", { hp: 100, maxHp: 100, defense: 1000000 })], "stationary")], [["a", "c"]]));
    const hits = a.rounds[0]!.hits.filter(h => h.sourceUnitId === "b");
    expect(hits).toHaveLength(4);
    expect(hits[0]!.targetFormationId).not.toBe(hits[1]!.targetFormationId);
    expect(hits[0]!.targetFormationId).toBe(hits[2]!.targetFormationId);
    expect(a.rounds[0]!.actions.filter(x => x.sourceUnitId === "b")).toHaveLength(1);
    assertRoundInvariants(a);
  });
  it("keeps leader-only units fighting with positive caller-supplied stats", () => {
    const a = run(input([formation("a", [leader("a", "LIEUTENANT", { hp: 50, maxHp: 50, attack: 1, defense: 1 })]),
      formation("b", [troop("b", { hp: 1, maxHp: 1, attack: 1, defense: 1 })])]));
    expect(a.victoriousPlayerIds).toEqual(["a"]); expect(a.units.find(u => u.unitId === "a")!.finalHp).toBe(50);
    expect(a.rounds[0]!.actions.find(x => x.sourceUnitId === "a")!.damage).toBe(1);
  });
  it("changes leadership next round, preserving dying round-start bonuses", () => {
    const a = run(input([formation("a", [leader("general", "GENERAL", { hp: 1, maxHp: 1, attack: 1, defense: 1 }),
      leader("lieutenant", "LIEUTENANT", { hp: 30, maxHp: 30, attack: 1, defense: 1 })]),
      formation("b", [troop("b", { hp: 100, maxHp: 100, attack: 1, defense: 1 })], "stationary")]));
    const death = a.rounds.findIndex(r => r.casualties.includes("general"));
    expect(death).toBeGreaterThanOrEqual(0); expect(a.rounds[death]!.stats.find(s => s.unitId === "lieutenant")).toMatchObject({ primaryLeaderId: "general", attack: 6, defense: 5 });
    expect(a.rounds[death + 1]!.stats.find(s => s.unitId === "lieutenant")).toMatchObject({ primaryLeaderId: "lieutenant", attack: 1, defense: 1 });
    assertRoundInvariants(a);
  });
  it("applies rank/secondary bonuses within formations, without sharing across allied players", () => {
    const a = run(input([formation("a", [troop("a"), leader("general", "GENERAL"), leader("captain", "CAPTAIN")]),
      formation("c", [troop("c")]), formation("b", [troop("b")], "stationary")], [["a", "c"]]));
    expect(a.rounds[0]!.stats.find(s => s.unitId === "a")).toMatchObject({ attack: 9, defense: 10 });
    expect(a.rounds[0]!.stats.find(s => s.unitId === "c")).toMatchObject({ attack: 4, defense: 6 });
  });
  it("uses surviving modified strength rather than HP or headcount for recipient", () => {
    const a = run(input([formation("a", [troop("a", { hp: 100, maxHp: 100, attack: 1, defense: 1 }), leader("g", "GENERAL", { hp: 100, maxHp: 100, attack: 1, defense: 1 })]),
      formation("c", [troop("c", { hp: 1000, maxHp: 1000, attack: 1, defense: 1 }), troop("c2", { hp: 1000, maxHp: 1000, attack: 1, defense: 1 }), troop("c3", { hp: 1000, maxHp: 1000, attack: 1, defense: 1 })]),
      formation("b", [troop("b", { hp: 1, maxHp: 1, attack: 1, defense: 1 })], "stationary")], [["a", "c"]]));
    expect(a.victoriousPlayerIds).toEqual(["a", "c"]); expect(a.survivingStrength).toEqual([{ playerId: "a", strength: 12 }, { playerId: "c", strength: 6 }]);
    expect(a.ownershipRecipientPlayerId).toBe("a");
  });
  it("recalculates final strength after leader death and clamps penalties to one", () => {
    const value = input([formation("a", [leader("g", "GENERAL", { hp: 1, maxHp: 1 }), leader("l", "LIEUTENANT", { hp: 100, maxHp: 100 })]),
      formation("b", [troop("b", { hp: 5, maxHp: 5, attack: 1, defense: 1 })], "stationary")]);
    const a = run(value);
    expect(a.units.find(u => u.unitId === "g")!.finalHp).toBe(0);
    expect(a.victoriousPlayerIds).toContain("a");
    expect(a.survivingStrength.find(s => s.playerId === "a")!.strength).toBe(10);
    const negative = run({ ...value, rules: { ...value.rules, leadership: [{ specialization: "INFANTRY", unitType: "INFANTRY", attack: -100, defense: -100 }] } });
    expect(negative.rounds[0]!.stats.filter(s => s.unitId !== "b").every(s => s.attack === 1 && s.defense === 1)).toBe(true);
  });
  it("breaks equal-highest ownership ties deterministically and varies with seed", () => {
    const value = input([formation("a", [troop("a", { hp: 100, maxHp: 100 })]), formation("c", [troop("c", { hp: 100, maxHp: 100 })]),
      formation("b", [troop("b", { hp: 1, maxHp: 1, attack: 1, defense: 1 })], "stationary")], [["a", "c"]]);
    const a = run(value); expect(a.ownershipTie.candidates).toEqual(["a", "c"]); expect(a.ownershipTie.raw).not.toBeNull(); expect(run(value)).toEqual(a);
    expect(new Set(Array.from({ length: 30 }, (_, seed) => run({ ...value, seed }).ownershipRecipientPlayerId)).size).toBe(2);
  });
  it("replays equivalent input permutations identically with detached immutable results", () => {
    const value = input([formation("a", [troop("a1"), troop("a2")]), formation("b", [troop("b1"), leader("b2", "LIEUTENANT")]), formation("c")]);
    const before = structuredClone(value), a = run(value);
    const permuted = { ...value, relationships: [...value.relationships].reverse(), formations: [...value.formations].reverse().map(f => ({ ...f, units: [...f.units].reverse() })) };
    expect(run(permuted)).toEqual(a); expect(value).toEqual(before); expect(Object.isFrozen(value)).toBe(false);
    const checkFrozen = (x: unknown): void => { if (x && typeof x === "object") { expect(Object.isFrozen(x)).toBe(true); Object.values(x).forEach(checkFrozen); } };
    checkFrozen(a); run({ ...value, encounterId: "unrelated", seed: 100 }); expect(run(value)).toEqual(a);
    expect(a.input).not.toBe(value); assertRoundInvariants(a);
  });
  it("returns recoverable work failures without an audit or partial casualties; retries replay", () => {
    const value = input([formation("a"), formation("b")]), expected = run(value);
    for (const budget of [{ maxRounds: 1, maxActions: 1000 }, { maxRounds: 1000, maxActions: 1 }]) {
      expect(resolveMultiForceCombat(value, budget)).toEqual({ ok: false, error: { code: "WORK_LIMIT", recoverable: true } });
    }
    expect(run(value, { maxRounds: 1000, maxActions: 1000 })).toEqual(expected);
  });
  it("resolves a deterministic matrix of bounded positive-stat battles", () => {
    for (let seed = 0; seed < 40; seed++) {
      const value = input(Array.from({ length: 2 + seed % 4 }, (_, i) => formation(String(i), Array.from({ length: 1 + (seed + i) % 4 }, (_, j) => troop(`${i}:${j}`,
        { hp: 1 + seed % 9, maxHp: 10, attack: 1 + (i + j) % 4, defense: 1 + seed % 5 })), seed % 2 && i === 0 ? "stationary" : "moving")));
      const a = run({ ...value, seed }); assertRoundInvariants(a);
      for (const p of a.victoriousPlayerIds) for (const q of a.victoriousPlayerIds) expect(a.input.relationships.some(r => r.from === p && r.to === q && r.relation === "hostile")).toBe(false);
    }
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER])("rejects malformed seed %s", seed => {
    expect(resolveMultiForceCombat({ ...input([formation("a"), formation("b")]), seed }).ok).toBe(false);
  });
  it("rejects zero stats, duplicate IDs/ranks, invalid provenance, missing policies and extra fields", () => {
    const base = input([formation("a"), formation("b")]);
    const invalid = [
      { ...base, extra: true }, { ...base, formations: [formation("a", [troop("a", { attack: 0 })]), formation("b")] },
      { ...base, formations: [formation("a", [troop("duplicate")]), formation("b", [troop("duplicate")])] },
      { ...base, formations: [formation("a", [leader("l1", "LIEUTENANT"), leader("l2", "LIEUTENANT")]), formation("b")] },
      { ...base, formations: [formation("a", [troop("a", { originalSpawnNodeId: "" })]), formation("b")] },
      { ...base, rules: { ...base.rules, leadership: [] }, formations: [formation("a", [leader("l", "GENERAL")]), formation("b")] },
      { ...base, formations: [formation("a", [troop("a", { hp: 8 })]), formation("b")] },
      { ...base, formations: [formation("a"), formation("b", undefined, "moving", "f:a")] }
    ];
    for (const value of invalid) expect(resolveMultiForceCombat(value)).toMatchObject({ ok: false, error: { recoverable: false } });
  });
  it("resolves the total-unit ceiling and a forty-player encounter", () => {
    const value = input([formation("a", Array.from({ length: 1024 }, (_, i) => troop(`a:${i}`, { hp: 1, maxHp: 1, attack: 1, defense: 1 }))),
      formation("b", Array.from({ length: 1024 }, (_, i) => troop(`b:${i}`, { hp: 1, maxHp: 1, attack: 1, defense: 1 })))]);
    const a = run({ ...value, seed: 0xffffffff });
    expect(a.rounds).toHaveLength(1); expect(a.rounds[0]!.actions).toHaveLength(2048); expect(a.outcome).toBe("mutual_destruction");
    const forty = run(input(Array.from({ length: 40 }, (_, i) => formation(String(i), [troop(String(i), { hp: 1, maxHp: 1, attack: 1, defense: 1 })]))));
    assertRoundInvariants(forty);
  });
  it("enforces the encounter-wide unit ceiling across formations", () => {
    const value = input([formation("a", Array.from({ length: 1024 }, (_, i) => troop(`a:${i}`))),
      formation("b", Array.from({ length: 1025 }, (_, i) => troop(`b:${i}`)))]);
    expect(resolveMultiForceCombat(value)).toEqual({ ok: false, error: { code: "INPUT_LIMIT", recoverable: false } });
  });
  it("rejects incomplete, asymmetric, duplicate, unknown and non-transitive relations", () => {
    const base = input([formation("a"), formation("b"), formation("c")]);
    const altered = base.relationships.map(r => ({ ...r, relation: [r.from, r.to].includes("b") ? "ally" : "hostile" }));
    for (const relationships of [base.relationships.slice(1), [...base.relationships, base.relationships[0]], altered,
      base.relationships.map((r, i) => i === 0 ? { ...r, relation: "ally" } : r),
      base.relationships.map((r, i) => i === 0 ? { ...r, from: "unknown" } : r)]) {
      expect(resolveMultiForceCombat({ ...base, relationships })).toEqual({ ok: false, error: { code: "UNSUPPORTED_RELATIONSHIPS", recoverable: false } });
    }
  });
  it("rejects unsupported versions, oversized inputs, sparse arrays, accessors and proxies without invoking getters", () => {
    const base = input([formation("a"), formation("b")]); let called = false;
    const getter = { ...base }; Object.defineProperty(getter, "seed", { enumerable: true, get() { called = true; return 1; } });
    const sparse = new Array(2);
    for (const v of [getter, new Proxy(base, { get() { throw Error("proxy"); } }), { ...base, formations: sparse }, { ...base, rulesetVersion: "unknown" },
      { ...base, formations: Array.from({ length: 81 }, () => formation("a")) }]) expect(resolveMultiForceCombat(v).ok).toBe(false);
    expect(called).toBe(false);
    expect(resolveMultiForceCombat(base, { maxRounds: 0, maxActions: 1 }).ok).toBe(false);
  });
});
