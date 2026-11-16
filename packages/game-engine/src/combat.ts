import { auditHash, compareIds } from "./determinism.js";
import { isProxy } from "node:util/types";

/** Server-only prototype. Never pass this input/result to a public or own-player
 * DTO. Deliberately not exported from index.ts or wired into pending encounters.
 * Callers supply already established hostility and roles; this is not a movement,
 * diplomacy, visibility, or multi-army resolver.
 */
export const COMBAT_VERSION = "combat-prototype-1a-v1";
export const COMBAT_SCHEDULE = "two-formation-ordered-pairs-v1";
export const COMBAT_ROLL = "provisional-lcg32-scaled-v1";
export const COMBAT_LIMITS = Object.freeze({ unitsPerFormation: 2048, rounds: 1000, exchanges: 10000, stat: 1000000 });

type Role = "ATK" | "DEF";
export type CombatUnit = Readonly<{ unitId: string; hp: number } & (
  { kind: "INFANTRY" } | { kind: "LEADER"; rank: "LIEUTENANT"; specialization: "INFANTRY" }
)>;
export type CombatFormation = Readonly<{
  formationId: string;
  ownerPlayerId: string;
  stance: "attacking" | "stationary";
  firstRoundRole: Role;
  units: readonly CombatUnit[];
}>;
export type CombatInput = Readonly<{
  schemaVersion: 1;
  rulesetVersion: typeof COMBAT_VERSION;
  seed: number;
  relationship: "hostile";
  mode: "mutual_attack" | "assault";
  rules: Readonly<{
    schedule: typeof COMBAT_SCHEDULE;
    roll: typeof COMBAT_ROLL;
    // Provisional balance supplied by the caller; there are no default 7/4/6 stats.
    infantry: Readonly<{ maxHp: number; attack: number; defense: number }>;
    maxRounds: number;
    maxExchanges: number;
  }>;
  formations: readonly [CombatFormation, CombatFormation];
}>;
export type CombatRollRecord = Readonly<{
  formationId: string; unitId: string; role: Role; effectiveStat: number;
  raw: number | null; damage: number;
}>;
export type CombatDamageRecord = Readonly<{
  sourceUnitId: string; targetUnitId: string; hpBefore: number; damage: number; hpAfter: number;
}>;
export type CombatCasualty = Readonly<{
  unitId: string; formationId: string; cause: "damage" | "no_combat_units";
}>;
export type CombatExchange = Readonly<{
  number: number;
  rolls: readonly CombatRollRecord[];
  damage: readonly CombatDamageRecord[];
  discardedDamage: readonly Readonly<{ sourceUnitId: string; damage: number }>[];
  casualties: readonly CombatCasualty[];
  primaryLeadersAfter: readonly Readonly<{ formationId: string; unitId: string | null }>[];
}>;
export type CombatRound = Readonly<{
  number: number;
  roles: readonly Readonly<{ formationId: string; role: Role }>[];
  exchanges: readonly CombatExchange[];
}>;
export type CombatAudit = Readonly<{
  schemaVersion: 1;
  kind: "server_combat_audit";
  battleId: string;
  input: CombatInput;
  status: "resolved" | "stalemate" | "limit_reached";
  outcome: "formation_victory" | "mutual_destruction" | "unresolved";
  winnerFormationId: string | null;
  limit: "rounds" | "exchanges" | null;
  initialCasualties: readonly CombatCasualty[];
  rounds: readonly CombatRound[];
  destroyedUnitIds: readonly string[];
  survivingUnitIds: readonly string[];
  units: readonly Readonly<{
    unitId: string; formationId: string; encounterHp: number; finalHp: number;
  }>[];
}>;
export type CombatErrorCode = "INVALID_INPUT" | "UNSUPPORTED_VERSION" | "UNSUPPORTED_TOPOLOGY" |
  "UNSUPPORTED_RELATIONSHIP" | "UNSUPPORTED_UNIT" | "UNSUPPORTED_RULE" | "UNSUPPORTED_FIELDS" | "INPUT_LIMIT";
export type CombatResult = Readonly<{ ok: true; audit: CombatAudit }> |
  Readonly<{ ok: false; error: Readonly<{ code: CombatErrorCode }> }>;

class CombatInputError extends Error {
  readonly code: CombatErrorCode;
  constructor(code: CombatErrorCode) { super(code); this.code = code; }
}
function fail(code: CombatErrorCode): never { throw new CombatInputError(code); }

// Strict, bounded JSON-domain validation. Copy only known fields, so no hidden
// transport/world data can enter the audit. Accessors and non-plain objects are
// rejected without invoking getters. No recursive traversal of unknown fields.
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || isProxy(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("INVALID_INPUT");
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== "string" || !keys.includes(key))) fail("UNSUPPORTED_FIELDS");
  if (own.length !== keys.length) fail("INVALID_INPUT");
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !("value" in field) || !field.enumerable) fail("INVALID_INPUT");
    copy[key] = field.value;
  }
  return copy;
}
function array(value: unknown, max: number): unknown[] {
  if (isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_INPUT");
  if (value.length > max) fail("INPUT_LIMIT");
  if (Reflect.ownKeys(value).length !== value.length + 1) fail("INVALID_INPUT");
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field) || !field.enumerable) fail("INVALID_INPUT");
    copy.push(field.value);
  }
  return copy;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("INVALID_INPUT");
  return value === 0 ? 0 : value;
}
function id(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value) fail("INVALID_INPUT");
  return value;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function parseInput(value: unknown): CombatInput {
  const input = record(value, ["schemaVersion", "rulesetVersion", "seed", "relationship", "mode", "rules", "formations"]);
  if (input.schemaVersion !== 1 || input.rulesetVersion !== COMBAT_VERSION) fail("UNSUPPORTED_VERSION");
  const seed = integer(input.seed, 0, 0xffffffff);
  if (input.relationship !== "hostile") fail("UNSUPPORTED_RELATIONSHIP");
  if (input.mode !== "mutual_attack" && input.mode !== "assault") fail("UNSUPPORTED_TOPOLOGY");
  const rules = record(input.rules, ["schedule", "roll", "infantry", "maxRounds", "maxExchanges"]);
  if (rules.schedule !== COMBAT_SCHEDULE || rules.roll !== COMBAT_ROLL) fail("UNSUPPORTED_RULE");
  const stats = record(rules.infantry, ["maxHp", "attack", "defense"]);
  const infantry = {
    maxHp: integer(stats.maxHp, 1, COMBAT_LIMITS.stat),
    attack: integer(stats.attack, 0, COMBAT_LIMITS.stat),
    defense: integer(stats.defense, 0, COMBAT_LIMITS.stat)
  };
  const maxRounds = integer(rules.maxRounds, 1, COMBAT_LIMITS.rounds);
  const maxExchanges = integer(rules.maxExchanges, 1, COMBAT_LIMITS.exchanges);
  // Reject cardinality before reading any participant in a surrounding world.
  if (isProxy(input.formations) || !Array.isArray(input.formations) ||
      Object.getPrototypeOf(input.formations) !== Array.prototype) fail("INVALID_INPUT");
  if (input.formations.length !== 2) fail("UNSUPPORTED_TOPOLOGY");
  const seenUnits = new Set<string>();
  const formations = array(input.formations, 2).map(raw => {
    const f = record(raw, ["formationId", "ownerPlayerId", "stance", "firstRoundRole", "units"]);
    const formationId = id(f.formationId), ownerPlayerId = id(f.ownerPlayerId);
    if (f.stance !== "attacking" && f.stance !== "stationary") fail("UNSUPPORTED_TOPOLOGY");
    if (f.firstRoundRole !== "ATK" && f.firstRoundRole !== "DEF") fail("UNSUPPORTED_TOPOLOGY");
    let leaders = 0;
    const units = array(f.units, COMBAT_LIMITS.unitsPerFormation).map((rawUnit): CombatUnit => {
      if (rawUnit === null || typeof rawUnit !== "object" || isProxy(rawUnit)) fail("INVALID_INPUT");
      const kind = Object.getOwnPropertyDescriptor(rawUnit, "kind")?.value;
      if (kind !== "INFANTRY" && kind !== "LEADER") fail("UNSUPPORTED_UNIT");
      const u = record(rawUnit, kind === "INFANTRY" ? ["unitId", "kind", "hp"] : ["unitId", "kind", "hp", "rank", "specialization"]);
      const unitId = id(u.unitId);
      if (seenUnits.has(unitId)) fail("INVALID_INPUT");
      seenUnits.add(unitId);
      const hp = integer(u.hp, 1, kind === "INFANTRY" ? infantry.maxHp : 1);
      if (kind === "INFANTRY") return { unitId, kind, hp };
      if (u.rank !== "LIEUTENANT" || u.specialization !== "INFANTRY") fail("UNSUPPORTED_UNIT");
      if (++leaders > 1) fail("INVALID_INPUT");
      return { unitId, kind, hp, rank: "LIEUTENANT", specialization: "INFANTRY" };
    });
    if (units.length === 0) fail("INVALID_INPUT");
    return { formationId, ownerPlayerId, stance: f.stance, firstRoundRole: f.firstRoundRole, units } satisfies CombatFormation;
  });
  const a = formations[0]!, b = formations[1]!;
  if (a.formationId === b.formationId || a.ownerPlayerId === b.ownerPlayerId) fail("UNSUPPORTED_TOPOLOGY");
  if (a.firstRoundRole === b.firstRoundRole) fail("UNSUPPORTED_TOPOLOGY");
  if (input.mode === "mutual_attack") {
    if (a.stance !== "attacking" || b.stance !== "attacking") fail("UNSUPPORTED_TOPOLOGY");
  } else if (formations.some(f => (f.stance === "attacking") !== (f.firstRoundRole === "ATK"))) fail("UNSUPPORTED_TOPOLOGY");
  // Preserve exact accepted array order in input. Execution uses separate sorted copies.
  return freeze({ schemaVersion: 1, rulesetVersion: COMBAT_VERSION, seed, relationship: "hostile", mode: input.mode,
    rules: { schedule: COMBAT_SCHEDULE, roll: COMBAT_ROLL, infantry, maxRounds, maxExchanges }, formations: [a, b] });
}

type Fighter = { unit: CombatUnit; hp: number };
type Side = { formation: CombatFormation; roster: Fighter[]; leader: Fighter | undefined; troops: number; target: number };
const primary = (side: Side): string | null => side.leader && side.leader.hp > 0 ? side.leader.unit.unitId : null;
const roleFor = (side: Side, round: number, mutual: boolean): Role =>
  mutual && round % 2 === 0 ? (side.formation.firstRoundRole === "ATK" ? "DEF" : "ATK") : side.formation.firstRoundRole;

/** Provisional, input-selected two-formation scheduling policy for Issue #76.
 * This is neither a permanent balance rule nor an approved multi-army algorithm.
 * - Sort formations and Infantry by code-unit ID; commanders follow all Infantry.
 * - Each round pairs the next living, not-yet-used Infantry of each formation.
 *   Unpaired troops still attack, without extra retaliation from used enemies.
 *   Pairing selects actors only: targets always follow the enemy's ordered roster,
 *   including surviving troops that already attacked. There is no individual duel.
 * - Commit both rolls before applying either hit; deaths earlier in the round
 *   skip future attacks, but same-exchange deaths never cancel committed damage.
 * - Overflow follows the enemy's one ordered roster. No mid-encounter healing.
 * - A Lieutenant is 1 HP, 0/0, supplies +0/+0, and never rolls. When all Infantry
 *   are dead, remove any remaining commander at that exchange boundary (recorded
 *   separately from damage). A commander alone cannot sustain the encounter.
 * Only one Lieutenant per side is allowed; higher-rank succession is unsupported.
 *
 * The provisional roll maps one uint32 LCG draw to 1..stat using floor scaling;
 * it has small scaling bias and is NOT an authoritative atWar formula. Stat zero
 * commits zero damage without consuming RNG. Bounded integer products stay below
 * 2^53. Fixed per-call state and one draw per positive roll bound RNG work.
 */
function fight(input: CombatInput): CombatAudit {
  const sides: Side[] = [...input.formations].sort((a, b) => compareIds(a.formationId, b.formationId)).map(formation => {
    const roster = [...formation.units].sort((a, b) => Number(a.kind === "LEADER") - Number(b.kind === "LEADER") || compareIds(a.unitId, b.unitId))
      .map(unit => ({ unit, hp: unit.hp }));
    return { formation, roster, target: 0, troops: formation.units.filter(u => u.kind === "INFANTRY").length,
      leader: roster.find(u => u.unit.kind === "LEADER") };
  });
  const [a, b] = [sides[0]!, sides[1]!];
  let state = input.seed, exchangeCount = 0, quietRounds = 0;
  const rounds: CombatRound[] = [], initialCasualties: CombatCasualty[] = [];
  let status: CombatAudit["status"] = "resolved", limit: CombatAudit["limit"] = null;
  const removeUnprotected = (side: Side, casualties: CombatCasualty[]) => {
    if (side.troops !== 0) return;
    for (const u of side.roster) if (u.hp > 0) {
      u.hp = 0;
      casualties.push({ unitId: u.unit.unitId, formationId: side.formation.formationId, cause: "no_combat_units" });
    }
  };
  for (const side of sides) removeUnprotected(side, initialCasualties);
  const roll = (side: Side, actor: Fighter, role: Role): CombatRollRecord => {
    const effectiveStat = role === "ATK" ? input.rules.infantry.attack : input.rules.infantry.defense;
    let raw: number | null = null, damage = 0;
    if (effectiveStat > 0) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      raw = state;
      damage = Math.floor(raw * effectiveStat / 0x100000000) + 1;
    }
    return { formationId: side.formation.formationId, unitId: actor.unit.unitId, role, effectiveStat, raw, damage };
  };
  const hit = (side: Side, committed: CombatRollRecord, damage: CombatDamageRecord[], casualties: CombatCasualty[]) => {
    let remaining = committed.damage;
    while (remaining > 0 && side.target < side.roster.length) {
      const target = side.roster[side.target]!;
      if (target.hp === 0) { side.target++; continue; }
      const hpBefore = target.hp, dealt = Math.min(remaining, hpBefore);
      target.hp -= dealt; remaining -= dealt;
      damage.push({ sourceUnitId: committed.unitId, targetUnitId: target.unit.unitId, hpBefore, damage: dealt, hpAfter: target.hp });
      if (target.hp === 0) {
        if (target.unit.kind === "INFANTRY") side.troops--;
        casualties.push({ unitId: target.unit.unitId, formationId: side.formation.formationId, cause: "damage" });
        side.target++;
      }
    }
    return { sourceUnitId: committed.unitId, damage: remaining };
  };
  const mutual = input.mode === "mutual_attack";
  while (a.troops > 0 && b.troops > 0) {
    if (rounds.length === input.rules.maxRounds) { status = "limit_reached"; limit = "rounds"; break; }
    if (exchangeCount === input.rules.maxExchanges) { status = "limit_reached"; limit = "exchanges"; break; }
    const number = rounds.length + 1;
    const roles = sides.map(side => ({ formationId: side.formation.formationId, role: roleFor(side, number, mutual) }));
    const queues = sides.map(side => side.roster.filter(u => u.unit.kind === "INFANTRY" && u.hp > 0));
    const cursors = [0, 0];
    const next = (sideIndex: number): Fighter | undefined => {
      const queue = queues[sideIndex]!;
      while (cursors[sideIndex]! < queue.length) {
        const actor = queue[cursors[sideIndex]!]!;
        cursors[sideIndex] = cursors[sideIndex]! + 1;
        if (actor.hp > 0) return actor;
      }
      return undefined;
    };
    const exchanges: CombatExchange[] = [];
    let roundDamage = 0;
    while (a.troops > 0 && b.troops > 0) {
      const actors = [next(0), next(1)];
      if (!actors[0] && !actors[1]) break;
      if (exchangeCount === input.rules.maxExchanges) { status = "limit_reached"; limit = "exchanges"; break; }
      const rolls = actors.flatMap((actor, index) => actor ? [roll(sides[index]!, actor, roles[index]!.role)] : []);
      const damage: CombatDamageRecord[] = [], casualties: CombatCasualty[] = [];
      const discardedDamage = rolls.map(committed => hit(committed.formationId === a.formation.formationId ? b : a, committed, damage, casualties));
      for (const side of sides) removeUnprotected(side, casualties);
      roundDamage += damage.reduce((sum, entry) => sum + entry.damage, 0);
      exchanges.push({ number: ++exchangeCount, rolls, damage, discardedDamage, casualties,
        primaryLeadersAfter: sides.map(side => ({ formationId: side.formation.formationId, unitId: primary(side) })) });
    }
    rounds.push({ number, roles, exchanges });
    if (a.troops === 0 || b.troops === 0 || status === "limit_reached") break;
    quietRounds = roundDamage === 0 ? quietRounds + 1 : 0;
    // A quiet mutual-attack round may become productive when roles reverse.
    if (quietRounds >= (mutual ? 2 : 1)) { status = "stalemate"; break; }
  }
  const resolved = status === "resolved";
  const units = sides.flatMap(side => side.roster.map(u => ({ unitId: u.unit.unitId, formationId: side.formation.formationId,
    encounterHp: u.hp, finalHp: resolved && u.hp > 0 ? (u.unit.kind === "INFANTRY" ? input.rules.infantry.maxHp : 1) : u.hp
  }))).sort((x, y) => compareIds(x.unitId, y.unitId));
  return freeze({ schemaVersion: 1, kind: "server_combat_audit", battleId: `combat:${auditHash(input)}`, input,
    status, limit, outcome: !resolved ? "unresolved" : a.troops === 0 && b.troops === 0 ? "mutual_destruction" : "formation_victory",
    winnerFormationId: resolved ? sides.find(side => side.troops > 0)?.formation.formationId ?? null : null,
    initialCasualties, rounds, units, destroyedUnitIds: units.filter(u => u.finalHp === 0).map(u => u.unitId),
    survivingUnitIds: units.filter(u => u.finalHp > 0).map(u => u.unitId) });
}

/** Accept only explicit prototype-domain data; failures echo no input/seed/IDs.
 * Audit allocation is O(units + exchanges + rounds): each hit either kills a
 * unit or consumes a roll; queues are at most unitsPerFormation long. Processing
 * after unit sorting is bounded by maxRounds * units + maxExchanges, with no
 * ambient randomness.
 */
export function resolveCombat(value: unknown): CombatResult {
  let input: CombatInput;
  try { input = parseInput(value); }
  catch (error) {
    return freeze({ ok: false, error: { code: error instanceof CombatInputError ? error.code : "INVALID_INPUT" } });
  }
  return Object.freeze({ ok: true, audit: fight(input) });
}
