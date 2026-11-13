import { INITIAL_ARMIES_POLICY, WorldPointSchema, MovementLeadershipInputSchema, StartingFootMovementInputSchema, EncounterInputSchema } from "@strategy-game/shared-types/server";

export class MovementInputError extends Error {
  readonly code = "invalid_movement_input";
  constructor() { super("Invalid movement/encounter helper input"); }
}
const point = WorldPointSchema;
const ranks = ["GENERAL", "COLONEL", "CAPTAIN", "LIEUTENANT"] as const;
function checked<T>(work: () => T): T { try { return work(); } catch { throw new MovementInputError(); } }
export function squaredDistance(from: unknown, to: unknown): number {
  return checked(() => { const a = point.parse(from), b = point.parse(to); return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; });
}
export function geographicDistance(from: unknown, to: unknown): number { return Math.sqrt(squaredDistance(from, to)); }

/** Leadership facts only. Rank precedence is not movement or combat initiative. */
export function evaluateLeadership(input: unknown) {
  return checked(() => {
    const members = MovementLeadershipInputSchema.parse(input);
    const leaders = members.filter((u) => u.kind === "LEADER");
    if (new Set(members.map((u) => u.unitId)).size !== members.length || new Set(leaders.map((u) => u.rank)).size !== leaders.length) throw new MovementInputError();
    leaders.sort((a, b) => ranks.indexOf(a.rank) - ranks.indexOf(b.rank));
    const primary = leaders[0];
    return Object.freeze({ primaryLeaderId: primary?.unitId ?? null, primaryRank: primary?.rank ?? null,
      leaderless: leaders.length === 0, singleLeaderlessInfantry: leaders.length === 0 && members.length === 1 });
  });
}

/** Assesses the complete proposed Move 1..N path. It spends no budget and changes no state. */
export function evaluateStartingFootMovement(input: unknown) {
  return checked(() => {
    const data = StartingFootMovementInputSchema.parse(input);
    if (data.members.some((m) => m.ownerPlayerId !== data.ownerPlayerId)) throw new MovementInputError();
    const command = evaluateLeadership(data.members.map((m) => m.kind === "LEADER"
      ? { unitId: m.unitId, kind: m.kind, rank: m.rank } : { unitId: m.unitId, kind: m.kind }));
    let position = data.from, distance = 0;
    for (const destination of data.destinations) { distance += geographicDistance(position, destination); position = destination; }
    const inBounds = [data.from, ...data.destinations].every((p) => p.x <= data.bounds.width && p.y <= data.bounds.height);
    const reason = !inBounds ? "OUT_OF_BOUNDS" : command.singleLeaderlessInfantry ? "SOURCE_RADIUS_UNAPPROVED"
      : command.leaderless ? "LEADER_REQUIRED" : !data.members.some((u) => u.kind === "INFANTRY") ? "UNSUPPORTED_COMPOSITION"
        : distance > INITIAL_ARMIES_POLICY.rangePerTurn ? "RANGE_EXCEEDED" : "ELIGIBLE";
    return Object.freeze({ eligible: reason === "ELIGIBLE", reason, distance, rangePerTurn: INITIAL_ARMIES_POLICY.rangePerTurn,
      remainingBudget: Math.max(0, INITIAL_ARMIES_POLICY.rangePerTurn - distance), primaryLeaderId: command.primaryLeaderId });
  });
}

/** Exact-contact classification only; never produces an encounter result, blocks or moves a stack. */
export function classifyEncounter(input: unknown) {
  return checked(() => {
    const data = EncounterInputSchema.parse(input), other = data.occupant;
    if (data.situation === "crossing_paths" || data.situation === "vacating_position") return "POLICY_REQUIRED" as const;
    if (!other) return "CLEAR" as const;
    const sameCity = data.destinationCityId !== undefined && data.destinationCityId === other.cityId;
    const samePoint = squaredDistance(data.destination, other.position) === 0;
    if ((!sameCity && !samePoint) || data.relationship === "unknown") return "POLICY_REQUIRED" as const;
    if (data.relationship === "friendly") return "FRIENDLY_COLOCATION" as const;
    if (data.situation === "occupied_destination") return "HOSTILE_OCCUPIED_DESTINATION" as const;
    return sameCity ? "CONTESTED_CITY" as const : "CONTESTED_POINT" as const;
  });
}
