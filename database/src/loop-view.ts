import { CITY_PROFILE, CityAftermathSchema, CityPlanSchema } from '@strategy-game/shared-types';
import { CITY_SCENARIO, cityCommander, initialCityDraft } from '@strategy-game/game-engine/server';
import type { RepeatingDraft } from '@strategy-game/game-engine/server';
import {RepeatingCurrentSchema as LoopCurrentSchema,RepeatingHistorySchema as LoopHistorySchema,CombatAftermathSchema,EUROPE_SCENARIO_VIEW} from '@strategy-game/shared-types';
import type {LoopAggregate} from './loop-storage.js';
export function loopFormations(a:LoopAggregate,actor:string,resolved=false){
 const s=resolved?a.result!.nextState:a.snapshot;
 return s.formations.filter(f=>f.ownerPlayerId===actor).map(f=>({schemaVersion:1 as const,formationId:f.formationId,ownerPlayerId:actor,position:{x:f.position.xMilli/1000,y:f.position.yMilli/1000},units:f.unitIds.map(id=>{
  const u=s.units.find(u=>u.unitId===id&&u.ownerPlayerId===actor)!;return {schemaVersion:1 as const,unitId:u.unitId,originalSpawnNodeId:u.originalSpawnNodeId,hp:u.hp,maxHp:u.maxHp,...(u.kind==='INFANTRY'?{kind:'INFANTRY' as const}:{kind:'LEADER' as const,rank:u.rank,specialization:u.specialization})};
 })}));
}
export function loopCurrent(a:LoopAggregate,actor:string){const own=a.state.drafts.find(d=>d.playerId===actor);if(!own)throw Error('Missing participant');
 const base={kind:'loop_current',matchId:a.row.matchId,turn:a.state.turn,own:{revision:own.revision,ready:own.ready,orders:own.orders},
  formations:loopFormations(a,actor),ownedLocationIds:a.snapshot.cityOwners.filter(c=>c.ownerPlayerId===actor).map(c=>c.cityId)};
 if(a.snapshot.kind==='city_loop_state'){
  const snapshot=a.snapshot;
  const {playerId,manualCancellations,...plan}=(own as RepeatingDraft).city??initialCityDraft(snapshot,actor);
  void playerId;void manualCancellations;
  const cityPlan=CityPlanSchema.parse(plan);
  const cities=CITY_SCENARIO.map(({cityId,name,capital,position})=>{
   const garrison=snapshot.formations.find(f=>f.garrisonCityId===cityId&&f.ownerPlayerId===actor);
   const reserved=new Set(cityPlan.dispatches.flatMap(d=>d.unitIds));
   return {cityId,name,capital,position,owned:base.ownedLocationIds.includes(cityId),neutral:snapshot.cityOwners.find(c=>c.cityId===cityId)?.ownerPlayerId===null,garrisonId:garrison?.formationId??null,
    commanderId:cityCommander(snapshot.units.filter(u=>garrison?.unitIds.includes(u.unitId)&&!reserved.has(u.unitId)),cityPlan.commanders.find(c=>c.cityId===cityId)?.unitId)};
  });
  return LoopCurrentSchema.parse({...base,schemaVersion:3,profile:CITY_PROFILE,balance:snapshot.economy.balance,cityPlan,cities});
 }
 return LoopCurrentSchema.parse({...europeEnvelope(a.snapshot.simulationVersion==='europe-playtest-v1'),...base});
}
export function loopHistory(a:LoopAggregate,actor:string){
 if(!a.result)throw Error('Not resolved');const own=a.snapshot.formations.filter(f=>f.ownerPlayerId===actor),ids=new Set(own.map(f=>f.formationId)),survivors=new Set(a.result.nextState.units.filter(u=>u.ownerPlayerId===actor).map(u=>u.unitId));
 if(a.result.kind==='city_loop_result'){
  const battles=a.result.battles.flatMap(b=>{
   // The audited roster covers units split for dispatch, units consolidated in
   // a city, and survivors who participated in more than one battle.
   const audit=JSON.parse(b.auditJson) as {units:{ownerPlayerId:string;formationId:string;unitId:string;finalHp:number}[]};
   const own=audit.units.filter(u=>u.ownerPlayerId===actor);
   if(!own.length)return [];
   return [{ownFormationIds:[...new Set(own.map(u=>u.formationId))],
    lostUnitIds:own.filter(u=>u.finalHp===0).map(u=>u.unitId),survivingUnitIds:own.filter(u=>u.finalHp>0).map(u=>u.unitId),
    position:{x:b.position.xMilli/1000,y:b.position.yMilli/1000},
    outcome:b.outcome==='mutual_destruction'?'mutual_destruction':b.victoriousPlayerIds.includes(actor)?'victory':'defeat',
    ownership:b.locationId?{locationId:b.locationId,recipient:b.recipientPlayerId===actor?'own':b.recipientPlayerId?'opponent':'unchanged'}:null}];
  });
  const aftermath=CityAftermathSchema.parse({schemaVersion:2,matchId:a.row.matchId,state:'RESOLVED',formations:loopFormations(a,actor,true),battles});
  return LoopHistorySchema.parse({schemaVersion:3,profile:CITY_PROFILE,kind:'loop_aftermath',matchId:a.row.matchId,
   turnNumber:a.state.turn.turnNumber,aftermath,economy:a.result.economyReports.find(r=>r.playerId===actor)!.entries});
 }
 const aftermath=CombatAftermathSchema.parse({schemaVersion:2,matchId:a.row.matchId,state:'RESOLVED',formations:loopFormations(a,actor,true),battles:a.result.battles.filter(b=>b.formations.some(f=>ids.has(f.formationId))).map(b=>{
  const ownFormationIds=b.formations.filter(f=>ids.has(f.formationId)).map(f=>f.formationId),units=own.filter(f=>ownFormationIds.includes(f.formationId)).flatMap(f=>f.unitIds);
  return {ownFormationIds,lostUnitIds:units.filter(id=>!survivors.has(id)),survivingUnitIds:units.filter(id=>survivors.has(id)),position:{x:b.position.xMilli/1000,y:b.position.yMilli/1000},outcome:b.outcome==='mutual_destruction'?'mutual_destruction':b.victoriousPlayerIds.includes(actor)?'victory':'defeat',ownership:b.locationId?{locationId:b.locationId,recipient:b.recipientPlayerId===actor?'own':b.recipientPlayerId?b.victoriousPlayerIds.includes(actor)?'ally':'opponent':'unchanged'}:null};
 })});return LoopHistorySchema.parse({...europeEnvelope(a.snapshot.simulationVersion==='europe-playtest-v1'),kind:'loop_aftermath',matchId:a.row.matchId,turnNumber:a.state.turn.turnNumber,aftermath});
}

export function europeEnvelope(europe:boolean){if(!europe)return {schemaVersion:1 as const};const {originX,originY,maskPerGame,width,height,...profile}=EUROPE_SCENARIO_VIEW;void originX;void originY;void maskPerGame;void width;void height;return {schemaVersion:2 as const,profile}}
