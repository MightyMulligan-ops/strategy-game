import { isProxy } from "node:util/types";
import { auditHash, compareIds } from "./determinism.js";

/** Server-private only. No movement, persistence, transport or barrel export. */
export const MULTI_FORCE_COMBAT_VERSION = "multi-force-combat-1b-v1";
export const MULTI_FORCE_SCHEDULE = "round-start-single-action-rotating-armies-v1";
export const MULTI_FORCE_ROLL = "provisional-lcg32-scaled-v1";
export const MULTI_FORCE_LIMITS = Object.freeze({ formations: 80, players: 40, units: 2048,
  stat: 1000000, rounds: 100000, actions: 1000000 });
const ranks = ["GENERAL", "COLONEL", "CAPTAIN", "LIEUTENANT"] as const;
type Rank = typeof ranks[number];
type Role = "ATK" | "DEF";
type Stats = Readonly<{ attack: number; defense: number }>;
const primaryBonus: Record<Rank, Stats> = {
  GENERAL: { attack: 2, defense: 2 }, COLONEL: { attack: 1, defense: 1 },
  CAPTAIN: { attack: 0, defense: 1 }, LIEUTENANT: { attack: 0, defense: 0 }
};
export type MultiForceUnit = Readonly<{
  unitId: string; originalSpawnNodeId: string; unitType: string; hp: number; maxHp: number;
  attack: number; defense: number; leadershipEligible: boolean;
} & ({ kind: "TROOP" } | { kind: "LEADER"; rank: Rank; specialization: string })>;
export type MultiForceFormation = Readonly<{
  formationId: string; ownerPlayerId: string; stance: "moving" | "stationary";
  units: readonly MultiForceUnit[];
}>;
export type MultiForceInput = Readonly<{
  schemaVersion: 1; rulesetVersion: typeof MULTI_FORCE_COMBAT_VERSION;
  encounterId: string; seed: number;
  // Null for an encounter without a city/POI. Owner need not be a participant.
  ownership: Readonly<{ locationId: string; ownerPlayerId: string | null }> | null;
  rules: Readonly<{
    schedule: typeof MULTI_FORCE_SCHEDULE; roll: typeof MULTI_FORCE_ROLL;
    statFloor: "minimum-one-v1"; alliances: "equivalence-v1";
    leadership: readonly Readonly<{ specialization: string; unitType: string; attack: number; defense: number }>[];
  }>;
  // Complete directed matrix, excluding self. Never inferred from ownership.
  relationships: readonly Readonly<{ from: string; to: string; relation: "ally" | "hostile" }>[];
  formations: readonly MultiForceFormation[];
}>;
export type MultiForceAction = Readonly<{
  sourcePlayerId: string; sourceFormationId: string; sourceUnitId: string;
  targetPlayerId: string; targetFormationId: string; role: Role;
  effectiveStat: number; raw: number; damage: number;
}>;
export type MultiForceHit = Readonly<{
  sourceUnitId: string; targetFormationId: string; targetUnitId: string;
  hpBefore: number; hpAfter: number; damage: number;
}>;
export type MultiForceRound = Readonly<{
  number: number; forceOrder: readonly string[];
  pairRoles: readonly Readonly<{ a: string; b: string; aRole: Role; bRole: Role }>[];
  stats: readonly Readonly<{ unitId: string; primaryLeaderId: string | null; attack: number; defense: number }>[];
  actions: readonly MultiForceAction[]; hits: readonly MultiForceHit[];
  discarded: readonly Readonly<{ sourceUnitId: string; damage: number }>[];
  casualties: readonly string[];
}>;
export type MultiForceAudit = Readonly<{
  schemaVersion: 1; kind: "server_multi_force_combat_audit"; battleId: string;
  input: MultiForceInput; outcome: "victory" | "mutual_destruction";
  victoriousPlayerIds: readonly string[]; ownershipRecipientPlayerId: string | null;
  ownershipTie: Readonly<{ candidates: readonly string[]; raw: number | null }>;
  survivingStrength: readonly Readonly<{ playerId: string; strength: number }>[];
  rounds: readonly MultiForceRound[];
  units: readonly Readonly<{ unitId: string; formationId: string; ownerPlayerId: string;
    originalSpawnNodeId: string; encounterHp: number; finalHp: number }>[];
}>;
export type MultiForceResult = Readonly<{ ok: true; audit: MultiForceAudit }> |
  Readonly<{ ok: false; error: Readonly<{ code: "INVALID_INPUT" | "UNSUPPORTED_VERSION" |
    "UNSUPPORTED_RELATIONSHIPS" | "INPUT_LIMIT" | "WORK_LIMIT"; recoverable: boolean }> }>;
export type MultiForceBudget = Readonly<{ maxRounds: number; maxActions: number }>;
type ErrorCode = Extract<MultiForceResult, { ok: false }>["error"]["code"];
class InputError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(code); this.code = code; }
}
function fail(code: ErrorCode): never { throw new InputError(code); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("INVALID_INPUT");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) fail("INVALID_INPUT");
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d) || !d.enumerable) fail("INVALID_INPUT");
    copy[key] = d.value;
  }
  return copy;
}
function array(value: unknown, max: number): unknown[] {
  if (!value || typeof value !== "object" || isProxy(value) || !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_INPUT");
  if (value.length > max) fail("INPUT_LIMIT");
  if (Reflect.ownKeys(value).length !== value.length + 1) fail("INVALID_INPUT");
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !("value" in d) || !d.enumerable) fail("INVALID_INPUT");
    result.push(d.value);
  }
  return result;
}
function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) fail("INVALID_INPUT");
  return v === 0 ? 0 : v;
}
function id(v: unknown): string {
  if (typeof v !== "string" || !v.length || v.length > 128 || v.trim() !== v) fail("INVALID_INPUT");
  return v;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
function parse(value: unknown): MultiForceInput {
  const x = record(value, ["schemaVersion", "rulesetVersion", "encounterId", "seed", "ownership", "rules", "relationships", "formations"]);
  if (x.schemaVersion !== 1 || x.rulesetVersion !== MULTI_FORCE_COMBAT_VERSION) fail("UNSUPPORTED_VERSION");
  const encounterId = id(x.encounterId), seed = integer(x.seed, 0, 0xffffffff);
  let ownership: MultiForceInput["ownership"] = null;
  if (x.ownership !== null) {
    const o = record(x.ownership, ["locationId", "ownerPlayerId"]);
    ownership = { locationId: id(o.locationId), ownerPlayerId: o.ownerPlayerId === null ? null : id(o.ownerPlayerId) };
  }
  const r = record(x.rules, ["schedule", "roll", "statFloor", "alliances", "leadership"]);
  if (r.schedule !== MULTI_FORCE_SCHEDULE || r.roll !== MULTI_FORCE_ROLL ||
    r.statFloor !== "minimum-one-v1" || r.alliances !== "equivalence-v1") fail("UNSUPPORTED_VERSION");
  const policies = new Set<string>();
  const leadership = array(r.leadership, 128).map(raw => {
    const p = record(raw, ["specialization", "unitType", "attack", "defense"]);
    const specialization = id(p.specialization), unitType = id(p.unitType);
    const key = JSON.stringify([specialization, unitType]);
    if (policies.has(key)) fail("INVALID_INPUT"); policies.add(key);
    return { specialization, unitType, attack: integer(p.attack, -MULTI_FORCE_LIMITS.stat, MULTI_FORCE_LIMITS.stat),
      defense: integer(p.defense, -MULTI_FORCE_LIMITS.stat, MULTI_FORCE_LIMITS.stat) };
  }).sort((a, b) => compareIds(a.specialization, b.specialization) || compareIds(a.unitType, b.unitType));
  const unitIds = new Set<string>(), formationIds = new Set<string>();
  const formations = array(x.formations, MULTI_FORCE_LIMITS.formations).map(raw => {
    const f = record(raw, ["formationId", "ownerPlayerId", "stance", "units"]);
    const formationId = id(f.formationId), ownerPlayerId = id(f.ownerPlayerId);
    if (formationIds.has(formationId)) fail("INVALID_INPUT"); formationIds.add(formationId);
    if (f.stance !== "moving" && f.stance !== "stationary") fail("INVALID_INPUT");
    const seenRanks = new Set<Rank>();
    const units = array(f.units, MULTI_FORCE_LIMITS.units).map((rawUnit): MultiForceUnit => {
      if (!rawUnit || typeof rawUnit !== "object" || isProxy(rawUnit)) fail("INVALID_INPUT");
      const kind = Object.getOwnPropertyDescriptor(rawUnit, "kind")?.value;
      if (kind !== "TROOP" && kind !== "LEADER") fail("INVALID_INPUT");
      const u = record(rawUnit, ["unitId", "originalSpawnNodeId", "unitType", "hp", "maxHp", "attack", "defense", "leadershipEligible", "kind",
        ...(kind === "LEADER" ? ["rank", "specialization"] : [])]);
      const unitId = id(u.unitId);
      if (unitIds.has(unitId)) fail("INVALID_INPUT"); unitIds.add(unitId);
      if (unitIds.size > MULTI_FORCE_LIMITS.units) fail("INPUT_LIMIT");
      const maxHp = integer(u.maxHp, 1, MULTI_FORCE_LIMITS.stat);
      if (typeof u.leadershipEligible !== "boolean") fail("INVALID_INPUT");
      const base = { unitId, originalSpawnNodeId: id(u.originalSpawnNodeId), unitType: id(u.unitType),
        maxHp, hp: integer(u.hp, 1, maxHp), attack: integer(u.attack, 1, MULTI_FORCE_LIMITS.stat),
        defense: integer(u.defense, 1, MULTI_FORCE_LIMITS.stat), leadershipEligible: u.leadershipEligible };
      if (kind === "TROOP") return { ...base, kind };
      if (!ranks.includes(u.rank as Rank) || seenRanks.has(u.rank as Rank)) fail("INVALID_INPUT");
      const rank = u.rank as Rank, specialization = id(u.specialization); seenRanks.add(rank);
      return { ...base, kind, rank, specialization };
    }).sort((a, b) => compareIds(a.unitId, b.unitId));
    if (!units.length) fail("INVALID_INPUT");
    return { formationId, ownerPlayerId, stance: f.stance, units } satisfies MultiForceFormation;
  }).sort((a, b) => compareIds(a.formationId, b.formationId));
  const players = [...new Set(formations.map(f => f.ownerPlayerId))].sort(compareIds);
  if (players.length > MULTI_FORCE_LIMITS.players) fail("INPUT_LIMIT");
  if (players.length < 2) fail("INVALID_INPUT");
  const relationships = array(x.relationships, MULTI_FORCE_LIMITS.players * (MULTI_FORCE_LIMITS.players - 1)).map(raw => {
    const p = record(raw, ["from", "to", "relation"]);
    if (p.relation !== "ally" && p.relation !== "hostile") fail("UNSUPPORTED_RELATIONSHIPS");
    return { from: id(p.from), to: id(p.to), relation: p.relation as "ally" | "hostile" };
  }).sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to));
  const matrix = new Map<string, string>();
  const key = (a: string, b: string) => JSON.stringify([a, b]);
  for (const p of relationships) {
    if (!players.includes(p.from) || !players.includes(p.to) || p.from === p.to || matrix.has(key(p.from, p.to))) fail("UNSUPPORTED_RELATIONSHIPS");
    matrix.set(key(p.from, p.to), p.relation);
  }
  if (relationships.length !== players.length * (players.length - 1)) fail("UNSUPPORTED_RELATIONSHIPS");
  for (const a of players) for (const b of players) if (a !== b) {
    if (matrix.get(key(a, b)) !== matrix.get(key(b, a))) fail("UNSUPPORTED_RELATIONSHIPS");
    for (const c of players) if (a !== c && b !== c && matrix.get(key(a, b)) === "ally" &&
      matrix.get(key(b, c)) === "ally" && matrix.get(key(a, c)) !== "ally") fail("UNSUPPORTED_RELATIONSHIPS");
  }
  if (!relationships.some(p => p.relation === "hostile")) fail("UNSUPPORTED_RELATIONSHIPS");
  // A declared specialization must have an explicit policy for every eligible
  // type in its formation, even if its leader starts as primary.
  for (const f of formations) for (const u of f.units) if (u.kind === "LEADER") {
    for (const target of f.units) if (target.leadershipEligible && !policies.has(JSON.stringify([u.specialization, target.unitType]))) fail("INVALID_INPUT");
  }
  return freeze({ schemaVersion: 1, rulesetVersion: MULTI_FORCE_COMBAT_VERSION, encounterId, seed, ownership,
    rules: { schedule: MULTI_FORCE_SCHEDULE, roll: MULTI_FORCE_ROLL, statFloor: "minimum-one-v1", alliances: "equivalence-v1", leadership },
    relationships, formations });
}

/** Domain-separated local streams. Equivalent canonical inputs have identical
 * ordering, roles, rolls and tie choices; budget is deliberately not seed input. */
function rng(input: MultiForceInput, domain: string): () => number {
  let state = Number.parseInt(auditHash({ version: MULTI_FORCE_COMBAT_VERSION, seed: input.seed,
    encounterId: input.encounterId, domain }).slice(0, 8), 16);
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
}
function shuffle<T>(items: readonly T[], draw: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(draw() * (i + 1) / 0x100000000);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
function rotate<T>(items: readonly T[], offset: number): T[] {
  if (!items.length) return [];
  const n = offset % items.length; return [...items.slice(n), ...items.slice(0, n)];
}
type Fighter = { unit: MultiForceUnit; formation: MultiForceFormation; hp: number };
type Army = { formation: MultiForceFormation; roster: Fighter[] };
function modified(army: Army, fighter: Fighter, input: MultiForceInput) {
  const leaders = army.roster.filter(u => u.hp > 0 && u.unit.kind === "LEADER")
    .sort((a, b) => ranks.indexOf((a.unit as Extract<MultiForceUnit, { kind: "LEADER" }>).rank) -
      ranks.indexOf((b.unit as Extract<MultiForceUnit, { kind: "LEADER" }>).rank));
  const primary = leaders[0];
  let attack = fighter.unit.attack, defense = fighter.unit.defense;
  if (fighter.unit.leadershipEligible && primary?.unit.kind === "LEADER") {
    attack += primaryBonus[primary.unit.rank].attack; defense += primaryBonus[primary.unit.rank].defense;
    for (const leader of leaders.slice(1)) if (leader.unit.kind === "LEADER") {
      const specialization = leader.unit.specialization;
      const bonus = input.rules.leadership.find(p => p.specialization === specialization && p.unitType === fighter.unit.unitType)!;
      attack += bonus.attack; defense += bonus.defense;
    }
  }
  return { unitId: fighter.unit.unitId, primaryLeaderId: primary?.unit.unitId ?? null,
    attack: Math.max(1, attack), defense: Math.max(1, defense) };
}
function fight(input: MultiForceInput, budget: MultiForceBudget): MultiForceAudit {
  const armies: Army[] = input.formations.map(formation => ({ formation, roster:
    [false, true].flatMap(leaders => shuffle(formation.units.filter(u => (u.kind === "LEADER") === leaders),
      rng(input, JSON.stringify(["unit-order", formation.formationId, leaders]))))
      .map(unit => ({ unit, formation, hp: unit.hp })) }));
  for (const army of armies) army.roster.sort((a, b) =>
    Number(a.unit.kind === "LEADER") - Number(b.unit.kind === "LEADER") ||
    (a.unit.kind === "TROOP" && b.unit.kind === "TROOP" ? Number(b.hp < b.unit.maxHp) - Number(a.hp < a.unit.maxHp) : 0));
  const players = [...new Set(armies.map(a => a.formation.ownerPlayerId))].sort(compareIds);
  const forceOrder = shuffle(players, rng(input, "force-order"));
  const armyOrder = shuffle(armies, rng(input, "army-order"));
  const hostile = (a: string, b: string) => input.relationships.some(p => p.from === a && p.to === b && p.relation === "hostile");
  const living = (a: Army) => a.roster.some(u => u.hp > 0);
  const activePlayers = () => players.filter(p => armies.some(a => a.formation.ownerPlayerId === p && living(a)));
  const hasEnemies = () => activePlayers().some(a => activePlayers().some(b => hostile(a, b)));
  const pairInitial = new Map<string, Role>();
  const pairKey = (a: string, b: string) => JSON.stringify([a, b]);
  for (let i = 0; i < armies.length; i++) for (let j = i + 1; j < armies.length; j++) {
    const a = armies[i]!.formation, b = armies[j]!.formation;
    if (hostile(a.ownerPlayerId, b.ownerPlayerId)) pairInitial.set(pairKey(a.formationId, b.formationId),
      rng(input, JSON.stringify(["pair-role", a.formationId, b.formationId]))() < 0x80000000 ? "ATK" : "DEF");
  }
  const opposite = (r: Role): Role => r === "ATK" ? "DEF" : "ATK";
  const roleFor = (a: MultiForceFormation, b: MultiForceFormation, round: number): Role => {
    if (a.stance !== b.stance) return a.stance === "stationary" ? "DEF" : "ATK";
    if (a.stance === "stationary") {
      if (a.ownerPlayerId === input.ownership?.ownerPlayerId) return "DEF";
      if (b.ownerPlayerId === input.ownership?.ownerPlayerId) return "ATK";
    }
    const first = compareIds(a.formationId, b.formationId) < 0;
    const initial = pairInitial.get(first ? pairKey(a.formationId, b.formationId) : pairKey(b.formationId, a.formationId))!;
    return (first === (round % 2 === 1)) ? initial : opposite(initial);
  };
  const rounds: MultiForceRound[] = [];
  let actionCount = 0;
  const damageDraw = rng(input, "damage");
  let forceTurns = forceOrder, armyTurns = armyOrder;
  // Target queues belong to the encounter, not an individual round. Keep them
  // independent of initiative so short actor queues cannot bias incoming hits.
  const targets = new Map(players.map(p => [p, forceOrder.filter(other => hostile(p, other))]));
  const armyTargets = new Map<string, Army[]>();
  while (hasEnemies()) {
    if (rounds.length >= budget.maxRounds) fail("WORK_LIMIT");
    const number = rounds.length + 1;
    const active = new Set(activePlayers());
    const ordered = forceTurns.filter(p => active.has(p));
    const orderedArmies = armyTurns.filter(living);
    forceTurns = rotate(ordered, 1);
    armyTurns = rotate(orderedArmies, 1);
    const stats = armies.flatMap(a => a.roster.filter(u => u.hp > 0).map(u => modified(a, u, input)));
    const statMap = new Map(stats.map(s => [s.unitId, s]));
    // Interleave owners, then formations within each owner; each unit once.
    const queues = new Map(ordered.map(p => {
      const own = orderedArmies.filter(a => a.formation.ownerPlayerId === p);
      const rosters = own.map(a => a.roster.filter(u => u.hp > 0));
      const queue: Fighter[] = [];
      for (let index = 0; rosters.some(q => index < q.length); index++) for (const roster of rosters) if (roster[index]) queue.push(roster[index]!);
      return [p, queue] as const;
    }));
    const actions: MultiForceAction[] = [];
    for (let slot = 0; ordered.some(p => slot < queues.get(p)!.length); slot++) for (const p of ordered) {
      const actor = queues.get(p)![slot]; if (!actor) continue;
      const enemies = targets.get(p)!.filter(other => active.has(other));
      if (!enemies.length) continue;
      if (++actionCount > budget.maxActions) fail("WORK_LIMIT");
      const targetPlayerId = enemies[0]!; targets.set(p, rotate(enemies, 1));
      const k = pairKey(p, targetPlayerId);
      const enemyArmies = (armyTargets.get(k) ?? armyOrder.filter(a => a.formation.ownerPlayerId === targetPlayerId)).filter(living);
      const target = enemyArmies[0]!; armyTargets.set(k, rotate(enemyArmies, 1));
      const role = roleFor(actor.formation, target.formation, number), stat = statMap.get(actor.unit.unitId)!;
      const effectiveStat = role === "ATK" ? stat.attack : stat.defense, raw = damageDraw();
      actions.push({ sourcePlayerId: p, sourceFormationId: actor.formation.formationId, sourceUnitId: actor.unit.unitId,
        targetPlayerId, targetFormationId: target.formation.formationId, role, effectiveStat, raw,
        damage: Number(BigInt(raw) * BigInt(effectiveStat) / 0x100000000n) + 1 });
    }
    // All actions/stats are now committed. Damage uses shadow HP until the
    // complete round has been allocated; no casualties cancel actions.
    const shadow = new Map(armies.flatMap(a => a.roster.map(u => [u.unit.unitId, u.hp] as const)));
    const hits: MultiForceHit[] = [], discarded: { sourceUnitId: string; damage: number }[] = [];
    for (const action of actions) {
      const enemies = orderedArmies.filter(a => hostile(action.sourcePlayerId, a.formation.ownerPlayerId));
      const start = enemies.findIndex(a => a.formation.formationId === action.targetFormationId);
      let remaining = action.damage;
      // Finish one wounded unit, then rotate packet overflow to the next
      // hostile army. Revisit armies only while some hostile HP remains.
      const incoming = rotate(enemies, start);
      let cursor = 0;
      while (remaining > 0) {
        let target: Fighter | undefined;
        let army: Army | undefined;
        for (let visited = 0; visited < incoming.length; visited++) {
          const candidate = incoming[cursor % incoming.length]!; cursor++;
          const fighter = candidate.roster.find(u => shadow.get(u.unit.unitId)! > 0);
          if (fighter) { army = candidate; target = fighter; break; }
        }
        if (!target || !army) break;
        const hpBefore = shadow.get(target.unit.unitId)!;
        const damage = Math.min(remaining, hpBefore), hpAfter = hpBefore - damage;
        shadow.set(target.unit.unitId, hpAfter); remaining -= damage;
        hits.push({ sourceUnitId: action.sourceUnitId, targetFormationId: army.formation.formationId,
          targetUnitId: target.unit.unitId, hpBefore, hpAfter, damage });
      }
      discarded.push({ sourceUnitId: action.sourceUnitId, damage: remaining });
    }
    const casualties: string[] = [];
    for (const army of armies) for (const u of army.roster) {
      const hp = shadow.get(u.unit.unitId)!;
      if (u.hp > 0 && hp === 0) casualties.push(u.unit.unitId);
      u.hp = hp;
    }
    const pairRoles = orderedArmies.flatMap((a, i) => orderedArmies.slice(i + 1).filter(b => hostile(a.formation.ownerPlayerId, b.formation.ownerPlayerId)).map(b => ({
      a: a.formation.formationId, b: b.formation.formationId, aRole: roleFor(a.formation, b.formation, number), bRole: roleFor(b.formation, a.formation, number)
    })));
    rounds.push({ number, forceOrder: ordered, pairRoles, stats, actions, hits, discarded, casualties: casualties.sort(compareIds) });
  }
  const victoriousPlayerIds = activePlayers();
  const survivingStrength = victoriousPlayerIds.map(playerId => ({ playerId, strength: armies.filter(a => a.formation.ownerPlayerId === playerId)
    .reduce((total, a) => total + a.roster.filter(u => u.hp > 0).reduce((sum, u) => {
      const stat = modified(a, u, input); return sum + stat.attack + stat.defense;
    }, 0), 0) }));
  const greatest = Math.max(0, ...survivingStrength.map(s => s.strength));
  const candidates = survivingStrength.filter(s => s.strength === greatest).map(s => s.playerId);
  const raw = input.ownership && candidates.length > 1 ? rng(input, "ownership-tie")() : null;
  const ownershipRecipientPlayerId = input.ownership && candidates.length ? candidates[raw === null ? 0 : Math.floor(raw * candidates.length / 0x100000000)]! : null;
  const units = armies.flatMap(a => a.roster.map(u => ({ unitId: u.unit.unitId, formationId: a.formation.formationId,
    ownerPlayerId: a.formation.ownerPlayerId, originalSpawnNodeId: u.unit.originalSpawnNodeId,
    encounterHp: u.hp, finalHp: u.hp > 0 ? u.unit.maxHp : 0 }))).sort((a, b) => compareIds(a.unitId, b.unitId));
  return freeze({ schemaVersion: 1, kind: "server_multi_force_combat_audit", battleId: `multi-combat:${auditHash(input)}`, input,
    outcome: victoriousPlayerIds.length ? "victory" : "mutual_destruction", victoriousPlayerIds,
    ownershipRecipientPlayerId, ownershipTie: { candidates: input.ownership ? candidates : [], raw }, survivingStrength, rounds, units });
}

/** Budget is an execution option, excluded from battle identity/RNG. On failure
 * return no casualties/audit/ownership; retry the same input with a larger budget.
 * Limits bound input and audit allocation; they are not gameplay draw rules. */
export function resolveMultiForceCombat(value: unknown, workBudget: unknown = {
  maxRounds: MULTI_FORCE_LIMITS.rounds, maxActions: MULTI_FORCE_LIMITS.actions
}): MultiForceResult {
  try {
    const input = parse(value), b = record(workBudget, ["maxRounds", "maxActions"]);
    const budget = { maxRounds: integer(b.maxRounds, 1, MULTI_FORCE_LIMITS.rounds),
      maxActions: integer(b.maxActions, 1, MULTI_FORCE_LIMITS.actions) };
    return freeze({ ok: true, audit: fight(input, budget) });
  } catch (error) {
    const code = error instanceof InputError ? error.code : "INVALID_INPUT";
    return freeze({ ok: false, error: { code, recoverable: code === "WORK_LIMIT" } });
  }
}
