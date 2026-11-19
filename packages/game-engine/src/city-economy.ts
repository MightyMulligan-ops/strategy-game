import { CityDraftSchema, CityEconomyStateSchema } from "@strategy-game/shared-types/server";
import type { CityCapture, CityDraft, CityFormation, CityLoopState, CityUnit } from "@strategy-game/shared-types/server";
import type { CityEdit, CityReportEntry, Recruitment } from "@strategy-game/shared-types";
import { auditHash, compareIds } from "./determinism.js";
import { cityCommander, consolidateGarrison, ownGarrison, validateDispatch } from "./city-garrison.js";
import { initialCityOwners, scenarioCity } from "./city-scenario.js";

function addCredits(credits: number, amount: number) {
  const total = credits + amount;
  if (!Number.isSafeInteger(total) || total < 0) throw Error("INVALID_DRAFT");
  return total;
}

export function initialCityDraft(state: CityLoopState, playerId: string): CityDraft {
  const account = state.economy.treasury.find(p => p.playerId === playerId);
  if (!account) throw Error("Invalid city draft owner");
  return CityDraftSchema.parse({
    playerId, credits: account.credits, recruitment: [], dispatches: [], manualCancellations: [],
    commanders: state.economy.commanders.filter(c => ownGarrison(state, playerId, c.cityId))
  });
}

export function applyCityEdit(state: CityLoopState, draft: CityDraft, edit: CityEdit): CityDraft {
  const { playerId } = draft;
  const { balance } = state.economy;
  const owned = (id: string) => state.cityOwners.some(city => city.cityId === id && city.ownerPlayerId === playerId);
  switch (edit.kind) {
    case "recruit": {
      if (!owned(edit.cityId) || draft.recruitment.some(r => r.recruitmentId === edit.recruitmentId) ||
          draft.manualCancellations.some(e => e.order.recruitmentId === edit.recruitmentId)) throw Error("INVALID_DRAFT");
      const queued = draft.recruitment.filter(r => r.cityId === edit.cityId).reduce((n, r) => n + r.quantity, 0);
      if (queued + edit.quantity > balance.capacity) throw Error("INVALID_DRAFT");
      const paid = edit.quantity * (edit.unitType === "INFANTRY" ? balance.infantryPrice : balance.lieutenantPrice);
      const order = { ...edit, paid, arrivalTurn: state.completedTurnNumber + 2 };
      const { kind: _, ...recruitment } = order;
      return CityDraftSchema.parse({ ...draft, credits: addCredits(draft.credits, -paid), recruitment: [...draft.recruitment, recruitment] });
    }
    case "cancel_recruitment": {
      const order = draft.recruitment.find(r => r.recruitmentId === edit.recruitmentId);
      if (!order) throw Error("INVALID_DRAFT");
      return CityDraftSchema.parse({ ...draft, credits: addCredits(draft.credits, order.paid),
        recruitment: draft.recruitment.filter(r => r !== order),
        manualCancellations: [...draft.manualCancellations, { kind: "canceled", reason: "manual", order, refund: order.paid }] });
    }
    case "choose_commander": {
      const garrison = ownGarrison(state, playerId, edit.cityId);
      if (!owned(edit.cityId) || !garrison?.unitIds.includes(edit.unitId) ||
          !state.units.some(u => u.unitId === edit.unitId && u.kind === "LEADER")) throw Error("INVALID_DRAFT");
      return CityDraftSchema.parse({ ...draft, commanders: [...draft.commanders.filter(c => c.cityId !== edit.cityId),
        { cityId: edit.cityId, unitId: edit.unitId }] });
    }
    case "dispatch":
      validateDispatch(state, playerId, edit.dispatch, draft.dispatches);
      return CityDraftSchema.parse({ ...draft, dispatches: [...draft.dispatches, edit.dispatch] });
    case "cancel_dispatch":
      if (!draft.dispatches.some(d => d.dispatchId === edit.dispatchId)) throw Error("INVALID_DRAFT");
      return CityDraftSchema.parse({ ...draft, dispatches: draft.dispatches.filter(d => d.dispatchId !== edit.dispatchId) });
  }
}

function recruitUnits(state: CityLoopState, playerId: string, order: Recruitment): CityUnit[] {
  const infantry = order.unitType === "INFANTRY";
  const stats = infantry ? state.combatPolicy.setup.infantry : state.combatPolicy.setup.lieutenant;
  return Array.from({ length: order.quantity }, (_, index) => ({
    schemaVersion: 1, unitId: `unit:${auditHash({ matchId: state.config.gameId, turn: state.completedTurnNumber + 1,
      playerId, recruitmentId: order.recruitmentId, index })}`,
    ownerPlayerId: playerId, originalSpawnNodeId: order.cityId, hp: stats.maxHp, ...stats,
    leadershipEligible: infantry,
    ...(infantry ? { kind: "INFANTRY" as const } : { kind: "LEADER" as const, rank: "LIEUTENANT" as const, specialization: "INFANTRY" as const })
  }));
}

/** Settlement consumes the ordered capture log, including ownership changes later reversed in the turn. */
export function settleCityEconomy(state: CityLoopState, drafts: readonly CityDraft[], captures: readonly CityCapture[],
  survivingUnits: readonly CityUnit[], survivingFormations: readonly CityFormation[]) {
  const owners = new Map(state.cityOwners.map(c => [c.cityId, c.ownerPlayerId]));
  const captured = new Set(captures.map(c => c.cityId));
  for (const event of captures) {
    if (owners.get(event.cityId) !== event.fromPlayerId || event.fromPlayerId === event.toPlayerId ||
        !state.players.some(p => p.playerId === event.toPlayerId)) throw Error("Invalid capture history");
    owners.set(event.cityId, event.toPlayerId);
  }
  const actors = state.players.map(p => p.playerId);
  if (drafts.length !== actors.length || new Set(drafts.map(d => d.playerId)).size !== actors.length ||
      actors.some(actor => !drafts.some(d => d.playerId === actor))) throw Error("Invalid settlement roster");
  const units = [...survivingUnits];
  let formations = [...survivingFormations];
  const treasury = [], economyReports = [];
  for (const playerId of actors) {
    const draft = drafts.find(d => d.playerId === playerId)!;
    const entries: CityReportEntry[] = [...draft.manualCancellations];
    let { credits } = draft;
    for (const order of draft.recruitment) {
      if (captured.has(order.cityId)) {
        credits = addCredits(credits, order.paid);
        entries.push({ kind: "canceled", reason: "capture", order, refund: order.paid });
      } else {
        if (owners.get(order.cityId) !== playerId) throw Error("Invalid recruitment owner");
        const recruits = recruitUnits(state, playerId, order);
        units.push(...recruits);
        formations = consolidateGarrison(state, formations, playerId, order.cityId, [], recruits.map(u => u.unitId));
        entries.push({ kind: "completed", order });
      }
    }
    for (const [cityId, owner] of owners) {
      if (owner !== playerId) continue;
      const amount = scenarioCity(cityId).capital ? state.economy.balance.capitalIncome : state.economy.balance.cityIncome;
      credits = addCredits(credits, amount);
      entries.push({ kind: "income", cityId, amount });
    }
    treasury.push({ playerId, credits });
    economyReports.push({ playerId, entries });
  }
  const commanders = formations.flatMap(f => {
    const cityId = f.garrisonCityId;
    if (!cityId) return [];
    const preferred = drafts.find(d => d.playerId === f.ownerPlayerId)?.commanders.find(c => c.cityId === cityId)?.unitId;
    const unitId = cityCommander(units.filter(u => f.unitIds.includes(u.unitId)), preferred);
    return unitId ? [{ cityId, unitId }] : [];
  });
  return {
    units: units.sort((a, b) => compareIds(a.unitId, b.unitId)), formations,
    cityOwners: [...owners].map(([cityId, ownerPlayerId]) => ({ cityId, ownerPlayerId })),
    economy: CityEconomyStateSchema.parse({ balance: state.economy.balance, treasury, commanders }),
    economyReports
  };
}

export function initialCityEconomy(state: Pick<CityLoopState, "players">, balance: CityLoopState["economy"]["balance"]) {
  const players = state.players.map(p => p.playerId);
  return {
    cityOwners: initialCityOwners(players),
    economy: CityEconomyStateSchema.parse({ balance, treasury: players.map(playerId => ({ playerId, credits: balance.startingCredits })),
      commanders: [] })
  };
}
