import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMBAT_LIMITS, COMBAT_ROLL, COMBAT_SCHEDULE, COMBAT_VERSION, resolveCombat } from "../src/combat.js";
import type { CombatAudit, CombatInput, CombatUnit } from "../src/combat.js";

// Use the repository runner when installed, or Node's built-in runner for the
// dependency-free frozen archive. Assertions and cases are identical in both.
const { describe, it } = process.env.VITEST ? await import("vitest") : await import("node:test");
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
function fixture(): Mutable<CombatInput> {
  return { schemaVersion: 1, rulesetVersion: COMBAT_VERSION, seed: 1, relationship: "hostile", mode: "assault",
    rules: { schedule: COMBAT_SCHEDULE, roll: COMBAT_ROLL, infantry: { maxHp: 7, attack: 4, defense: 6 }, maxRounds: 100, maxExchanges: 1000 },
    formations: [
      { formationId: "a", ownerPlayerId: "p1", stance: "attacking", firstRoundRole: "ATK", units: [infantry("a1", 7)] },
      { formationId: "b", ownerPlayerId: "p2", stance: "stationary", firstRoundRole: "DEF", units: [infantry("b1", 7)] }
    ] };
}
const infantry = (unitId: string, hp: number): Mutable<CombatUnit> => ({ unitId, kind: "INFANTRY", hp });
const lieutenant = (unitId: string): Mutable<CombatUnit> => ({ unitId, kind: "LEADER", hp: 1, rank: "LIEUTENANT", specialization: "INFANTRY" });
function audit(input: unknown): CombatAudit {
  const result = resolveCombat(input);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error.code);
  return result.audit;
}
function rejected(input: unknown, code?: string) {
  const result = resolveCombat(input);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected rejected input");
  assert.deepEqual(Object.keys(result).sort(), ["error", "ok"]);
  assert.deepEqual(Object.keys(result.error), ["code"]);
  if (code) assert.equal(result.error.code, code);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.error));
}
const exchanges = (result: CombatAudit) => result.rounds.flatMap(r => r.exchanges);
const rolls = (result: CombatAudit) => exchanges(result).flatMap(e => e.rolls);
function assertFrozen(value: unknown) {
  if (value === null || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozen(child);
}
function mutual(input: Mutable<CombatInput>) {
  input.mode = "mutual_attack";
  input.formations[1].stance = "attacking";
  return input;
}

describe("server-only Combat Prototype 1A", () => {
  it("pins seeded replay, exact inputs, roll rule, ordered RNG draws and outcome", () => {
    const input = fixture(), first = audit(input);
    assert.deepEqual(first, audit(structuredClone(input)));
    assert.deepEqual(first.input, input);
    assert.equal(first.battleId, "combat:1f154e58fdd5b5f3c863fec4baee6bb7c08c2cd1ffa2ddec55f3386382200992");
    assert.deepEqual(rolls(first).map(r => [r.raw, r.damage]), [[1015568748, 1], [1586005467, 3], [2165703038, 3], [3027450565, 5]]);
    assert.equal(first.status, "resolved");
    assert.equal(first.outcome, "formation_victory");
    assert.equal(first.winnerFormationId, "b");
    assert.deepEqual(first.destroyedUnitIds, ["a1"]);
    assert.deepEqual(first.survivingUnitIds, ["b1"]);
    assert.equal(first.input.rules.roll, COMBAT_ROLL);
    input.seed = 2;
    assert.notEqual(audit(input).battleId, first.battleId);
    assert.notDeepEqual(rolls(audit(input)), rolls(first));
  });

  it("uses code-unit ordering independent of formation/unit insertion and locale", () => {
    const input = fixture();
    input.rules.maxRounds = 1;
    input.rules.infantry = { maxHp: 50, attack: 1, defense: 1 };
    input.formations[0].units = [infantry("a2", 50), infantry("a10", 50), infantry("aZ", 50), infantry("aa", 50)];
    input.formations[1].units = [infantry("b2", 50), infantry("b1", 50)];
    const first = audit(input);
    assert.deepEqual(rolls(first).map(r => r.unitId), ["a10", "b1", "a2", "b2", "aZ", "aa"]);
    input.formations.reverse();
    input.formations.forEach(f => f.units.reverse());
    const shuffled = audit(input);
    assert.deepEqual(shuffled.rounds, first.rounds);
    assert.deepEqual(shuffled.units, first.units);
    assert.notEqual(shuffled.battleId, first.battleId); // exact input array order is retained
    assert.deepEqual(shuffled.input, input);
    const { formations, ...remaining } = input;
    const reorderedKeys = { formations, ...remaining };
    assert.equal(audit(reorderedKeys).battleId, shuffled.battleId);
  });

  it("commits both last-unit attacks before simultaneous mutual destruction", () => {
    const input = fixture();
    input.rules.infantry = { maxHp: 1, attack: 1, defense: 1 };
    input.formations.forEach(f => { f.units[0]!.hp = 1; });
    const result = audit(input), exchange = exchanges(result)[0]!;
    assert.equal(result.outcome, "mutual_destruction");
    assert.equal(result.winnerFormationId, null);
    assert.equal(result.rounds.length, 1);
    assert.equal(exchange.rolls.length, 2);
    assert.deepEqual(exchange.damage.map(d => [d.sourceUnitId, d.targetUnitId, d.hpAfter]), [["a1", "b1", 0], ["b1", "a1", 0]]);
    assert.deepEqual(result.survivingUnitIds, []);
    assert.deepEqual(result.destroyedUnitIds, ["a1", "b1"]);
  });

  it("retains damage across rounds and heals survivors only after the whole encounter", () => {
    const result = audit(fixture());
    assert.deepEqual(exchanges(result).map(e => e.damage.map(d => [d.hpBefore, d.hpAfter])), [[[7, 6], [7, 4]], [[6, 3], [4, 0]]]);
    assert.deepEqual(result.units, [
      { unitId: "a1", formationId: "a", encounterHp: 0, finalHp: 0 },
      { unitId: "b1", formationId: "b", encounterHp: 3, finalHp: 7 }
    ]);
    const limited = fixture(); limited.rules.maxRounds = 1;
    const partial = audit(limited);
    assert.equal(partial.status, "limit_reached");
    assert.equal(partial.outcome, "unresolved");
    assert.equal(partial.winnerFormationId, null);
    assert.ok(partial.units.every(u => u.finalHp === u.encounterHp));
    assert.deepEqual(partial.units.map(u => u.finalHp), [4, 6]);
  });

  it("overflows one enemy roster and cancels only attacks not yet committed", () => {
    const input = fixture();
    input.rules.infantry = { maxHp: 10, attack: 20, defense: 1 };
    input.rules.maxRounds = 1;
    input.formations[0].units = [infantry("a1", 10), infantry("a2", 10)];
    input.formations[1].units = [infantry("b3", 10), infantry("b2", 1), infantry("b1", 1)];
    const result = audit(input), first = exchanges(result)[0]!;
    assert.equal(first.rolls[0]!.damage, 5);
    assert.deepEqual(first.damage.map(d => [d.targetUnitId, d.damage, d.hpAfter]), [["b1", 1, 0], ["b2", 1, 0], ["b3", 3, 7], ["a1", 1, 9]]);
    assert.deepEqual(rolls(result).map(r => r.unitId), ["a1", "b1", "a2", "b3"]);
    assert.deepEqual(exchanges(result)[1]!.damage.map(d => [d.targetUnitId, d.hpBefore]), [["b3", 7], ["a1", 9]]);
    assert.equal(exchanges(result)[1]!.discardedDamage[0]!.damage, 4);
    assert.equal(result.winnerFormationId, "a");
  });

  it("lets excess troops attack once without repeated retaliation or double actions", () => {
    const input = fixture(); input.rules.maxRounds = 1;
    input.rules.infantry = { maxHp: 10, attack: 1, defense: 1 };
    input.formations[0].units = [infantry("a3", 10), infantry("a2", 10), infantry("a1", 10)];
    input.formations[1].units = [infantry("b1", 10)];
    const result = audit(input);
    assert.deepEqual(exchanges(result).map(e => e.rolls.map(r => r.unitId)), [["a1", "b1"], ["a2"], ["a3"]]);
    assert.deepEqual(result.units.map(u => [u.unitId, u.encounterHp]), [["a1", 9], ["a2", 10], ["a3", 10], ["b1", 7]]);
  });

  it("alternates formation ATK/DEF for mutual attackers using supplied first roles", () => {
    const input = mutual(fixture());
    input.rules.infantry = { maxHp: 100, attack: 2, defense: 5 };
    input.rules.maxRounds = 3;
    input.formations.forEach(f => { f.units[0]!.hp = 100; });
    const result = audit(input);
    assert.deepEqual(result.rounds.map(r => r.roles.map(role => role.role)), [["ATK", "DEF"], ["DEF", "ATK"], ["ATK", "DEF"]]);
    assert.deepEqual(result.rounds.map(r => r.exchanges[0]!.rolls.map(roll => roll.effectiveStat)), [[2, 5], [5, 2], [2, 5]]);
    input.formations[0].firstRoundRole = "DEF"; input.formations[1].firstRoundRole = "ATK";
    assert.deepEqual(audit(input).rounds[0]!.roles.map(r => r.role), ["DEF", "ATK"]);
  });

  it("keeps assault roles fixed and treats DEF as damage output, never mitigation", () => {
    const input = fixture();
    input.rules.maxRounds = 3;
    input.rules.infantry = { maxHp: 100, attack: 1, defense: 6 };
    input.formations.forEach(f => { f.units[0]!.hp = 100; });
    const result = audit(input);
    assert.deepEqual(result.rounds.map(r => r.roles.map(role => role.role)), Array.from({ length: 3 }, () => ["ATK", "DEF"]));
    assert.ok(exchanges(result).every(e => e.damage[0]!.damage === 1));
    assert.ok(rolls(result).filter(r => r.role === "DEF").some(r => r.damage > 1));
    input.formations[0].stance = "stationary"; input.formations[0].firstRoundRole = "DEF";
    input.formations[1].stance = "attacking"; input.formations[1].firstRoundRole = "ATK";
    assert.deepEqual(audit(input).rounds[0]!.roles.map(r => r.role), ["DEF", "ATK"]);
  });

  it("protects Lieutenants behind Infantry, adds no bonus and removes defeated leadership", () => {
    const input = fixture();
    input.formations[0].units.unshift(lieutenant("a0")); input.formations[1].units.unshift(lieutenant("b0"));
    const result = audit(input), first = exchanges(result)[0]!, last = exchanges(result).at(-1)!;
    assert.deepEqual(rolls(result), rolls(audit(fixture())));
    assert.deepEqual(first.damage.map(d => d.targetUnitId), ["b1", "a1"]);
    assert.deepEqual(first.primaryLeadersAfter.map(l => l.unitId), ["a0", "b0"]);
    assert.deepEqual(last.damage.map(d => d.targetUnitId), ["b1", "a1", "a0"]);
    assert.deepEqual(last.primaryLeadersAfter.map(l => l.unitId), [null, "b0"]);
    assert.deepEqual(result.destroyedUnitIds, ["a0", "a1"]);
    assert.deepEqual(result.survivingUnitIds, ["b0", "b1"]);
  });

  it("removes commanders when Infantry die even without damage overflow", () => {
    const input = fixture(); input.rules.infantry = { maxHp: 1, attack: 1, defense: 1 };
    input.formations.forEach(f => { f.units[0]!.hp = 1; f.units.push(lieutenant(`${f.formationId}0`)); });
    const result = audit(input);
    assert.equal(result.outcome, "mutual_destruction");
    assert.deepEqual(exchanges(result)[0]!.casualties.filter(c => c.cause === "no_combat_units").map(c => c.unitId), ["a0", "b0"]);
    assert.deepEqual(result.destroyedUnitIds, ["a0", "a1", "b0", "b1"]);
  });

  it("does not let commander-only formations sustain an engagement", () => {
    const input = fixture(); input.formations[0].units = [lieutenant("a0")];
    const result = audit(input);
    assert.equal(result.winnerFormationId, "b");
    assert.deepEqual(result.rounds, []);
    assert.deepEqual(result.initialCasualties, [{ unitId: "a0", formationId: "a", cause: "no_combat_units" }]);
    input.formations[1].units = [lieutenant("b0")];
    assert.equal(audit(input).outcome, "mutual_destruction");
  });

  it("bounds zero-stat stalemates and consumes no RNG for zero damage", () => {
    const input = fixture(); input.rules.infantry.attack = 0; input.rules.infantry.defense = 0;
    const fixed = audit(input), alternating = audit(mutual(input));
    assert.equal(fixed.status, "stalemate"); assert.equal(fixed.rounds.length, 1);
    assert.equal(alternating.status, "stalemate"); assert.equal(alternating.rounds.length, 2);
    assert.equal(fixed.outcome, "unresolved");
    assert.ok(rolls(alternating).every(r => r.damage === 0 && r.raw === null));
    assert.deepEqual(fixed.units.map(u => [u.encounterHp, u.finalHp]), [[7, 7], [7, 7]]);
    input.rules.infantry.defense = 1;
    const productive = audit(input);
    assert.equal(productive.status, "resolved");
    assert.equal(rolls(productive)[0]!.raw, null);
    assert.equal(rolls(productive)[1]!.raw, 1015568748);
  });

  it("enforces round/exchange budgets without claiming victory or healing", () => {
    const input = fixture(); input.rules.infantry = { maxHp: 100, attack: 1, defense: 1 };
    input.formations.forEach(f => { f.units = [infantry(`${f.formationId}1`, 100), infantry(`${f.formationId}2`, 100)]; });
    input.rules.maxExchanges = 1;
    const result = audit(input);
    assert.equal(result.status, "limit_reached"); assert.equal(result.limit, "exchanges");
    assert.equal(result.outcome, "unresolved"); assert.equal(exchanges(result).length, 1);
    assert.ok(result.units.every(u => u.finalHp === u.encounterHp));
    input.rules.maxExchanges = 2;
    assert.equal(audit(input).rounds.length, 1); // no empty round at exact budget boundary
    input.rules.maxExchanges = 100; input.rules.maxRounds = 1;
    assert.equal(audit(input).limit, "rounds");
    const kill = fixture(); kill.rules.infantry = { maxHp: 1, attack: 1, defense: 1 }; kill.rules.maxExchanges = 1;
    kill.formations.forEach(f => { f.units[0]!.hp = 1; });
    assert.equal(audit(kill).status, "resolved"); // destruction at the limit is still complete
  });

  it("copies exact accepted data, deeply freezes output, and has no shared RNG/state", () => {
    const input = fixture(), before = structuredClone(input), first = audit(input);
    assert.deepEqual(input, before); assert.equal(Object.isFrozen(input), false); assertFrozen(first);
    input.formations[0].units[0]!.hp = 1;
    input.rules.infantry.attack = 100;
    assert.deepEqual(first.input, before);
    assert.equal(Reflect.set(first.input.rules.infantry, "attack", 10), false);
    audit(input);
    assert.deepEqual(audit(before), first);
    const frozen = structuredClone(before);
    Object.freeze(frozen); Object.freeze(frozen.formations[0].units);
    assert.deepEqual(audit(frozen), first);
    assert.equal(audit(JSON.parse(JSON.stringify(before))).battleId, first.battleId);
  });

  it("rejects unknown versions, mechanics, relationships and hidden transport data", () => {
    const input = fixture();
    for (const value of [0, 2, "1", undefined]) rejected({ ...input, schemaVersion: value }, "UNSUPPORTED_VERSION");
    rejected({ ...input, rulesetVersion: "future" }, "UNSUPPORTED_VERSION");
    for (const value of ["neutral", "friendly", "unknown", null, false]) rejected({ ...input, relationship: value }, "UNSUPPORTED_RELATIONSHIP");
    rejected({ ...input, rules: { ...input.rules, roll: "atwar" } }, "UNSUPPORTED_RULE");
    rejected({ ...input, rules: { ...input.rules, schedule: "multi-army" } }, "UNSUPPORTED_RULE");
    for (const field of ["viewerPlayerId", "world", "supplies", "strategy", "opponents", "projection", "secret"]) {
      rejected({ ...input, [field]: "private" }, "UNSUPPORTED_FIELDS");
    }
    rejected({ ...input, rules: { ...input.rules, crit: 1 } }, "UNSUPPORTED_FIELDS");
    const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    assert.equal(index.includes("combat"), false);
  });

  it("rejects malformed topology, missing/duplicate membership, and unapproved targeting", () => {
    const input = fixture();
    for (const formations of [[], [input.formations[0]], [...input.formations, input.formations[0]], null]) rejected({ ...input, formations });
    rejected({ ...input, mode: "mixed_multi_army" }, "UNSUPPORTED_TOPOLOGY");
    for (const patch of [
      { formationId: "a" }, { ownerPlayerId: "p1" }, { firstRoundRole: "ATK" }, { stance: "attacking" }, { stance: "moving" }
    ]) rejected({ ...input, formations: [input.formations[0], { ...input.formations[1], ...patch }] }, "UNSUPPORTED_TOPOLOGY");
    rejected({ ...input, mode: "mutual_attack" }, "UNSUPPORTED_TOPOLOGY");
    input.formations[1].units = [infantry("a1", 7)]; rejected(input, "INVALID_INPUT");
    input.formations[1].units = []; rejected(input, "INVALID_INPUT");
    input.formations[1].units = [lieutenant("lt1"), lieutenant("lt2")]; rejected(input, "INVALID_INPUT");
  });

  it("rejects unsupported unit types, commanders, specializations and per-unit modifiers", () => {
    for (const unit of [
      { unitId: "x", kind: "TANK", hp: 1 },
      { ...lieutenant("x"), rank: "GENERAL" }, { ...lieutenant("x"), rank: "COLONEL" }, { ...lieutenant("x"), rank: "CAPTAIN" },
      { ...lieutenant("x"), specialization: "ARMOR" }, { ...infantry("x", 7), attack: 10 },
      { ...infantry("x", 7), ownerPlayerId: "another-owner" }
    ]) {
      const input = fixture(); rejected({ ...input, formations: [{ ...input.formations[0], units: [unit] }, input.formations[1]] });
    }
    const input = fixture(); input.formations[0].units = [lieutenant("lt")]; input.formations[0].units[0]!.hp = 2;
    rejected(input, "INVALID_INPUT");
  });

  it("rejects unsafe numeric input, over-budget work and malformed JSON-domain values", () => {
    for (const value of [null, undefined, [], true, 1, "input", {}, new Date(0)]) rejected(value);
    for (const value of [-1, 0.1, NaN, Infinity, 0x100000000, "1"]) rejected({ ...fixture(), seed: value }, "INVALID_INPUT");
    assert.equal(audit({ ...fixture(), seed: 0 }).input.seed, 0);
    assert.equal(audit({ ...fixture(), seed: 0xffffffff }).input.seed, 0xffffffff);
    for (const field of ["maxHp", "attack", "defense"] as const) {
      for (const value of [-1, 0.5, NaN, Infinity, COMBAT_LIMITS.stat + 1]) {
        const input = fixture(); input.rules.infantry[field] = value; rejected(input, "INVALID_INPUT");
      }
    }
    for (const field of ["maxRounds", "maxExchanges"] as const) {
      for (const value of [0, -1, 1.2, Infinity, 10001]) {
        const input = fixture(); input.rules[field] = value; rejected(input, "INVALID_INPUT");
      }
    }
    for (const hp of [0, -1, 8, 1.5, NaN]) { const input = fixture(); input.formations[0].units[0]!.hp = hp; rejected(input); }
    for (const unitId of ["", " ", " x", "x".repeat(129)]) { const input = fixture(); input.formations[0].units[0]!.unitId = unitId; rejected(input); }
    const oversized = fixture(); oversized.formations[0].units = Array.from({ length: COMBAT_LIMITS.unitsPerFormation + 1 }, (_, i) => infantry(`x${i}`, 7));
    rejected(oversized, "INPUT_LIMIT");
    const sparse = fixture(); delete sparse.formations[0].units[0]; rejected(sparse, "INVALID_INPUT");
    const getter = fixture(); Object.defineProperty(getter, "seed", { get() { assert.fail("must not call getters"); }, enumerable: true }); rejected(getter, "INVALID_INPUT");
    const cyclic = { ...fixture(), hidden: {} }; cyclic.hidden = cyclic; rejected(cyclic, "UNSUPPORTED_FIELDS");
  });

  it("runs representative large encounters repeatably with bounded audit allocation", () => {
    const input = fixture(); input.rules.maxRounds = COMBAT_LIMITS.rounds; input.rules.maxExchanges = COMBAT_LIMITS.exchanges;
    input.formations.forEach(f => { f.units = Array.from({ length: 512 }, (_, i) => infantry(`${f.formationId}${String(i).padStart(4, "0")}`, 7)); });
    const first = audit(input); assert.equal(first.status, "resolved"); assert.deepEqual(audit(input), first);
    const allExchanges = exchanges(first);
    assert.ok(allExchanges.length <= input.rules.maxExchanges);
    assert.ok(first.rounds.length <= input.rules.maxRounds);
    assert.ok(allExchanges.flatMap(e => e.damage).length <= rolls(first).length + 1024);
    assert.ok(allExchanges.flatMap(e => e.casualties).length <= 1024);
    for (const round of first.rounds) {
      const ids = round.exchanges.flatMap(e => e.rolls.map(r => r.unitId));
      assert.equal(ids.length, new Set(ids).size);
    }
    const max = fixture(); max.rules.maxExchanges = 10; max.rules.infantry = { maxHp: COMBAT_LIMITS.stat, attack: 1, defense: 1 };
    max.formations.forEach(f => { f.units = Array.from({ length: COMBAT_LIMITS.unitsPerFormation }, (_, i) => infantry(`${f.formationId}${i}`, COMBAT_LIMITS.stat)); });
    const limited = audit(max);
    assert.equal(limited.units.length, 4096); assert.equal(exchanges(limited).length, 10); assert.equal(limited.limit, "exchanges");
  });

  it("accepts an isolated pair from a 40-player fixture, never resolves the surrounding world", () => {
    const base = fixture();
    const world = Array.from({ length: 40 }, (_, i) => ({ ...structuredClone(base.formations[i % 2]!),
      formationId: `f${i}`, ownerPlayerId: `p${i}`, units: [lieutenant(`lt${i}`), ...Array.from({ length: 5 }, (_, j) => infantry(`u${i}-${j}`, 7))] }));
    const pair = { ...base, formations: [world[0], world[1]] };
    const first = audit(pair);
    world[39]!.units[1]!.hp = 1;
    assert.deepEqual(audit(pair), first);
    assert.equal(JSON.stringify(first).includes('"p39"'), false);
    rejected({ ...base, formations: world }, "UNSUPPORTED_TOPOLOGY");
    rejected({ ...pair, surroundingWorld: world }, "UNSUPPORTED_FIELDS");
  });

  it("replays many seeds with casualty/HP conservation and one action per unit per round", () => {
    for (let seed = 0; seed < 64; seed++) {
      const input = mutual(fixture()); input.seed = seed;
      input.formations.forEach((f, side) => { f.units = [lieutenant(`${f.formationId}0`), ...Array.from({ length: 3 + side }, (_, i) => infantry(`${f.formationId}${i + 1}`, 7))]; });
      const result = audit(input); assert.deepEqual(audit(input), result); assert.equal(result.status, "resolved");
      const hp = new Map(input.formations.flatMap(f => f.units.map(u => [u.unitId, u.hp] as const)));
      const dead = new Set<string>();
      for (const round of result.rounds) {
        const used = new Set<string>();
        for (const exchange of round.exchanges) {
          for (const roll of exchange.rolls) {
            assert.ok(!used.has(roll.unitId)); assert.ok(!dead.has(roll.unitId)); used.add(roll.unitId);
            assert.ok(roll.damage >= 1 && roll.damage <= roll.effectiveStat);
            assert.equal(exchange.damage.filter(d => d.sourceUnitId === roll.unitId).reduce((n, d) => n + d.damage, 0) +
              exchange.discardedDamage.find(d => d.sourceUnitId === roll.unitId)!.damage, roll.damage);
          }
          for (const d of exchange.damage) { assert.equal(hp.get(d.targetUnitId), d.hpBefore); assert.equal(d.hpAfter, d.hpBefore - d.damage); hp.set(d.targetUnitId, d.hpAfter); }
          for (const c of exchange.casualties) { assert.ok(!dead.has(c.unitId)); dead.add(c.unitId); hp.set(c.unitId, 0); }
        }
      }
      assert.deepEqual([...dead].sort(), result.destroyedUnitIds);
      for (const unit of result.units) assert.equal(hp.get(unit.unitId), unit.encounterHp);
      assert.equal(result.destroyedUnitIds.length + result.survivingUnitIds.length, 9);
    }
  });
});
