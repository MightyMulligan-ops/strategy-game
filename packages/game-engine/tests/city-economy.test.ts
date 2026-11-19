import { validateCitySites } from "../src/city-scenario.js";
import { beforeAll, expect, test } from "vitest";
import { applyCityEdit, initialCityDraft, settleCityEconomy } from "../src/city-economy.js";
import { cityFixture } from "./city-fixture.js";

// Prepare the pinned surface once in this worker before timing gameplay assertions.
beforeAll(validateCitySites, 20_000);

const recruit = {
  kind: "recruit", recruitmentId: "37d5bdee-08c1-4af6-b120-17a05ca161ff",
  cityId: "madrid", unitType: "LIEUTENANT", quantity: 2
} as const;

test("charges at planning time, rejects duplicate purchase and fully refunds cancellation once", () => {
  const state = cityFixture(), start = initialCityDraft(state, "alpha");
  const paid = applyCityEdit(state, start, recruit);
  expect(paid).toMatchObject({ credits: 1600, recruitment: [{ paid: 400, arrivalTurn: 2 }] });
  expect(() => applyCityEdit(state, paid, recruit)).toThrow("INVALID_DRAFT");
  const cancel = { kind: "cancel_recruitment", recruitmentId: recruit.recruitmentId } as const;
  const refunded = applyCityEdit(state, paid, cancel);
  expect(refunded).toMatchObject({ credits: 2000, recruitment: [], manualCancellations: [{ reason: "manual", refund: 400 }] });
  expect(() => applyCityEdit(state, refunded, recruit)).toThrow("INVALID_DRAFT");
  expect(() => applyCityEdit(state, refunded, cancel)).toThrow("INVALID_DRAFT");
});

test("owned cities, shared leader capacity, and available funds gate purchase", () => {
  const state = cityFixture(500), start = initialCityDraft(state, "alpha");
  expect(() => applyCityEdit(state, start, { ...recruit, cityId: "bilbao" })).toThrow("INVALID_DRAFT");
  expect(() => applyCityEdit(state, start, { ...recruit, cityId: "andorra-la-vella" })).toThrow("INVALID_DRAFT");
  expect(() => applyCityEdit(state, start, { ...recruit, quantity: 3 })).toThrow("INVALID_DRAFT");
  const infantry = applyCityEdit(state, start, { ...recruit, unitType: "INFANTRY", quantity: 5 });
  expect(() => applyCityEdit(state, { ...infantry, credits: 2000 }, { ...recruit, recruitmentId: "7b2111b2-76a5-4bd4-ab97-89dc7f1c06ac", quantity: 1 })).toThrow("INVALID_DRAFT");
});

test("capture and recapture refunds the original purchase, then pays only final owners", () => {
  const state = cityFixture();
  const plans = [applyCityEdit(state, initialCityDraft(state, "alpha"), recruit), initialCityDraft(state, "beta")];
  const result = settleCityEconomy(state, plans, [
    { cityId: "madrid", fromPlayerId: "alpha", toPlayerId: "beta" },
    { cityId: "madrid", fromPlayerId: "beta", toPlayerId: "alpha" },
    { cityId: "bilbao", fromPlayerId: null, toPlayerId: "beta" }
  ], state.units, state.formations);
  expect(result.units).toEqual(state.units);
  expect(result.economy.treasury).toEqual([{ playerId: "alpha", credits: 2400 }, { playerId: "beta", credits: 2600 }]);
  expect(result.economyReports).toEqual([
    { playerId: "alpha", entries: [
      { kind: "canceled", reason: "capture", order: plans[0]!.recruitment[0], refund: 400 },
      { kind: "income", cityId: "madrid", amount: 400 }
    ] },
    { playerId: "beta", entries: [{ kind: "income", cityId: "andorra-la-vella", amount: 400 }, { kind: "income", cityId: "bilbao", amount: 200 }] }
  ]);
});

test.each([true, false])("recruits create or join the correct garrison (existing=%s)", existing => {
  const state = cityFixture();
  const plans = [applyCityEdit(state, initialCityDraft(state, "alpha"), recruit), initialCityDraft(state, "beta")];
  const forms = state.formations.filter(f => existing || f.ownerPlayerId !== "alpha");
  const units = state.units.filter(u => existing || u.ownerPlayerId !== "alpha").map(u => u.kind === "INFANTRY" ? { ...u, hp: 2 } : u);
  const result = settleCityEconomy(state, plans, [], units, forms);
  const own = result.formations.filter(f => f.ownerPlayerId === "alpha");
  expect(own).toHaveLength(1);
  expect(own[0]).toMatchObject({ garrisonCityId: "madrid", position: { xMilli: 368000, yMilli: 463000 } });
  expect(own[0]!.unitIds).toHaveLength(existing ? 8 : 2);
  expect(result.units.filter(u => u.ownerPlayerId === "alpha" && u.kind === "LEADER")).toHaveLength(existing ? 3 : 2);
  expect(result.units.filter(u => u.kind === "INFANTRY").every(u => u.hp === 2)).toBe(true);
  expect(result.economy.treasury[0]?.credits).toBe(2000);
  expect(result).toEqual(settleCityEconomy(state, plans, [], units, forms));
});

test("live city chronology resolves a later recapture as a second battle before settlement", async () => {
  const { executeCityForces } = await import("../src/combat-turn.js");
  const { CityLoopFrozenSchema, CITY_RUNTIME } = await import("@strategy-game/shared-types/server");
  const initial = cityFixture(), start = initial.units;
  const own = start.find(u=>u.kind==="INFANTRY"&&u.ownerPlayerId==="alpha")!;
  const hostile = start.find(u=>u.kind==="INFANTRY"&&u.ownerPlayerId==="beta")!;
  const ownLeader = start.find(u=>u.kind==="LEADER"&&u.ownerPlayerId==="alpha")!;
  const hostileLeader = start.find(u=>u.kind==="LEADER"&&u.ownerPlayerId==="beta")!;
  const unitId=(n:number)=>"unit:"+n.toString(16).padStart(64,"0");
  const attackers=[...Array.from({length:8},(_,i)=>({...hostile,unitId:unitId(i+1)})),hostileLeader];
  const rescuers=[...Array.from({length:28},(_,i)=>({...own,unitId:unitId(i+9)})),ownLeader];
  const madrid=initial.formations.find(f=>f.garrisonCityId==="madrid")!;
  const attackId="formation:"+"a".repeat(64), rescueId="formation:"+"b".repeat(64);
  const state={...initial,units:[own,...attackers,...rescuers],formations:[
    {...madrid,unitIds:[own.unitId]},
    {...madrid,ownerPlayerId:"beta",formationId:attackId,garrisonCityId:null,unitIds:attackers.map(u=>u.unitId),
      position:{xMilli:318000,yMilli:463000}},
    {...madrid,formationId:rescueId,garrisonCityId:null,unitIds:rescuers.map(u=>u.unitId),
      position:{xMilli:528000,yMilli:463000}},
  ]};
  const drafts=[applyCityEdit(state,initialCityDraft(state,"alpha"),recruit),initialCityDraft(state,"beta")];
  const frozen=CityLoopFrozenSchema.parse({
    schemaVersion:7,kind:"city_loop_frozen",runtimeProfile:{...CITY_RUNTIME,balance:state.economy.balance},
    startingSnapshotId:state.snapshotId,startingStateVersion:0,worldRef:state.worldRef,worldSeed:1,resolutionSeed:1,
    seedIdentity:"city-recapture-test",combatPolicy:state.combatPolicy,cityDrafts:drafts,
    turn:{schemaVersion:1,gameId:state.config.gameId,turnNumber:1,status:"closed",openedAtMs:0,
      deadlineAtMs:300000,closedAtMs:1,closeReason:"all_ready"},
    players:[{playerId:"alpha",revision:2,ready:true,orders:[{type:"move",orderId:"rescue",stackId:rescueId,destination:{x:368,y:463}}]},
      {playerId:"beta",revision:2,ready:true,orders:[{type:"move",orderId:"assault",stackId:attackId,destination:{x:368,y:463}}]}]
  });
  const result=executeCityForces(state,frozen);
  expect(result.captures).toEqual([
    {cityId:"madrid",fromPlayerId:"alpha",toPlayerId:"beta"},
    {cityId:"madrid",fromPlayerId:"beta",toPlayerId:"alpha"}
  ]);
  expect(result.battles).toHaveLength(2);
  expect(result.formations).toHaveLength(1);
  expect(result.formations[0]).toMatchObject({garrisonCityId:"madrid",ownerPlayerId:"alpha"});
  const settled=settleCityEconomy(state,drafts,result.captures,result.units,result.formations);
  expect(settled.economyReports[0]?.entries[0]).toMatchObject({kind:"canceled",reason:"capture",refund:400});
  expect(settled.economy.treasury[0]?.credits).toBe(2400);
  expect(executeCityForces({...state,units:[...state.units].reverse(),formations:[...state.formations].reverse()},frozen))
    .toEqual(result);
});

test("an undefended neutral city is claimed only by ending a movement leg at the city",async()=>{
  const {executeCityForces}=await import("../src/combat-turn.js");
  const initial=cityFixture(), madrid=initial.formations.find(f=>f.ownerPlayerId==="alpha")!;
  const state={...initial,formations:[{...madrid,garrisonCityId:null,position:{xMilli:452000,yMilli:125000}}]};
  const {CityLoopFrozenSchema,CITY_RUNTIME}=await import("@strategy-game/shared-types/server");
  const resolve=(x:number,y:number)=>executeCityForces(state,CityLoopFrozenSchema.parse({
    schemaVersion:7,kind:"city_loop_frozen",runtimeProfile:{...CITY_RUNTIME,balance:state.economy.balance},
    startingSnapshotId:state.snapshotId,startingStateVersion:0,worldRef:state.worldRef,worldSeed:1,resolutionSeed:1,
    seedIdentity:"bilbao-entry-test",combatPolicy:state.combatPolicy,
    cityDrafts:["alpha","beta"].map(p=>initialCityDraft(state,p)),
    turn:{schemaVersion:1,gameId:state.config.gameId,turnNumber:1,status:"closed",openedAtMs:0,
      deadlineAtMs:300000,closedAtMs:1,closeReason:"all_ready"},
    players:[{playerId:"alpha",revision:1,ready:true,orders:[{type:"move",orderId:"enter",stackId:madrid.formationId,destination:{x,y}}]},
      {playerId:"beta",revision:1,ready:true,orders:[]}]
  }));
  expect(resolve(455,38).captures).toEqual([]);
  const arrived=resolve(452,38);
  expect(arrived.captures).toEqual([{cityId:"bilbao",fromPlayerId:null,toPlayerId:"alpha"}]);
  expect(arrived.formations).toEqual([expect.objectContaining({garrisonCityId:"bilbao",unitIds:madrid.unitIds})]);
});
