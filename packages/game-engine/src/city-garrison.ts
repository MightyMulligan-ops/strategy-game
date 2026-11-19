import type { CityFormation, CityLoopState, CityUnit } from "@strategy-game/shared-types/server";
import type { CityId, Dispatch } from "@strategy-game/shared-types";
import { auditHash, compareIds } from "./determinism.js";
import { europeLandSegment } from "./europe-playtest.js";
import { scenarioCity } from "./city-scenario.js";

export function ownGarrison(state: CityLoopState, actor: string, cityId: CityId) {
  return state.formations.find(f => f.ownerPlayerId === actor && f.garrisonCityId === cityId);
}

// The initial rules support only Infantry-specialized Lieutenants.
export function cityCommander(units: readonly CityUnit[], preferred: string | undefined) {
  const leaders = units.filter(u => u.kind === "LEADER").map(u => u.unitId).sort(compareIds);
  return preferred && leaders.includes(preferred) ? preferred : leaders[0] ?? null;
}

export function validateDispatch(state: CityLoopState, actor: string, dispatch: Dispatch, pending: readonly Dispatch[]) {
  const { cityId, unitIds, destination } = dispatch;
  const garrison = ownGarrison(state, actor, cityId);
  if (!garrison || !state.cityOwners.some(c => c.cityId === cityId && c.ownerPlayerId === actor)) throw Error("INVALID_DRAFT");
  const reserved = new Set(pending.flatMap(d => d.unitIds));
  if (pending.some(d => d.dispatchId === dispatch.dispatchId) ||
      unitIds.some(id => !garrison.unitIds.includes(id) || reserved.has(id))) throw Error("INVALID_DRAFT");
  const selected = state.units.filter(u => unitIds.includes(u.unitId));
  if (selected.filter(u => u.kind === "LEADER").length !== 1) throw Error("INVALID_DRAFT");
  const from = scenarioCity(cityId).position;
  const distance = Math.sqrt((from.x - destination.x)**2 + (from.y - destination.y)**2);
  if (!(distance > 0 && distance <= 250) || destination.x > 1000 || destination.y > 500 ||
      !europeLandSegment(from, destination)) throw Error("INVALID_DRAFT");
}

export function garrisonId(matchId: string, ownerPlayerId: string, cityId: CityId) {
  return `formation:${auditHash({ matchId, ownerPlayerId, cityId, kind: "city-garrison-v1" })}`;
}

export function formGarrison(state: CityLoopState, actor: string, cityId: CityId, ids: readonly string[]): CityFormation {
  const city = scenarioCity(cityId);
  return {
    schemaVersion: 1, formationId: garrisonId(state.config.gameId, actor, cityId), ownerPlayerId: actor,
    garrisonCityId: cityId, unitIds: [...ids].sort(compareIds),
    position: { xMilli: city.position.x * 1000, yMilli: city.position.y * 1000 }
  };
}

export function consolidateGarrison(state: CityLoopState, formations: readonly CityFormation[],
  ownerPlayerId: string, cityId: CityId, arrivals: readonly CityFormation[] = [], recruitedIds: readonly string[] = []) {
  const existing = formations.find(f => f.ownerPlayerId === ownerPlayerId && f.garrisonCityId === cityId);
  if (arrivals.some(f => f.ownerPlayerId !== ownerPlayerId)) throw Error("Cannot consolidate another player's units");
  const remove = new Set([existing?.formationId, ...arrivals.map(f => f.formationId)]);
  const ids = [...new Set([...existing?.unitIds ?? [], ...arrivals.flatMap(f => f.unitIds), ...recruitedIds])];
  const remaining = formations.filter(f => !remove.has(f.formationId));
  if (ids.length > 0) remaining.push(formGarrison(state, ownerPlayerId, cityId, ids));
  return remaining.sort((a,b) => compareIds(a.formationId,b.formationId));
}
