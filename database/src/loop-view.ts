import {RepeatingCurrentSchema as LoopCurrentSchema,RepeatingHistorySchema as LoopHistorySchema,CombatAftermathSchema,EUROPE_SCENARIO_VIEW} from '@strategy-game/shared-types';
import type {LoopAggregate} from './loop-storage.js';
export function loopFormations(a:LoopAggregate,actor:string,resolved=false){
 const s=resolved?a.result!.nextState:a.snapshot;
 return s.formations.filter(f=>f.ownerPlayerId===actor).map(f=>({schemaVersion:1 as const,formationId:f.formationId,ownerPlayerId:actor,position:{x:f.position.xMilli/1000,y:f.position.yMilli/1000},units:f.unitIds.map(id=>{
  const u=s.units.find(u=>u.unitId===id&&u.ownerPlayerId===actor)!;return {schemaVersion:1 as const,unitId:u.unitId,originalSpawnNodeId:u.originalSpawnNodeId,hp:u.hp,maxHp:u.maxHp,...(u.kind==='INFANTRY'?{kind:'INFANTRY' as const}:{kind:'LEADER' as const,rank:u.rank,specialization:u.specialization})};
 })}));
}
export function loopCurrent(a:LoopAggregate,actor:string){const own=a.state.drafts.find(d=>d.playerId===actor);if(!own)throw Error('Missing participant');
 const europe=a.snapshot.simulationVersion==='europe-playtest-v1';return LoopCurrentSchema.parse({...europeEnvelope(europe),kind:'loop_current',matchId:a.row.matchId,turn:a.state.turn,own:{revision:own.revision,ready:own.ready,orders:own.orders},formations:loopFormations(a,actor),ownedLocationIds:a.snapshot.cityOwners.filter(c=>c.ownerPlayerId===actor).map(c=>c.cityId)});
}
export function loopHistory(a:LoopAggregate,actor:string){
 if(!a.result)throw Error('Not resolved');const own=a.snapshot.formations.filter(f=>f.ownerPlayerId===actor),ids=new Set(own.map(f=>f.formationId)),survivors=new Set(a.result.nextState.units.filter(u=>u.ownerPlayerId===actor).map(u=>u.unitId));
 const aftermath=CombatAftermathSchema.parse({schemaVersion:2,matchId:a.row.matchId,state:'RESOLVED',formations:loopFormations(a,actor,true),battles:a.result.battles.filter(b=>b.formations.some(f=>ids.has(f.formationId))).map(b=>{
  const ownFormationIds=b.formations.filter(f=>ids.has(f.formationId)).map(f=>f.formationId),units=own.filter(f=>ownFormationIds.includes(f.formationId)).flatMap(f=>f.unitIds);
  return {ownFormationIds,lostUnitIds:units.filter(id=>!survivors.has(id)),survivingUnitIds:units.filter(id=>survivors.has(id)),position:{x:b.position.xMilli/1000,y:b.position.yMilli/1000},outcome:b.outcome==='mutual_destruction'?'mutual_destruction':b.victoriousPlayerIds.includes(actor)?'victory':'defeat',ownership:b.locationId?{locationId:b.locationId,recipient:b.recipientPlayerId===actor?'own':b.recipientPlayerId?b.victoriousPlayerIds.includes(actor)?'ally':'opponent':'unchanged'}:null};
 })});return LoopHistorySchema.parse({...europeEnvelope(a.snapshot.simulationVersion==='europe-playtest-v1'),kind:'loop_aftermath',matchId:a.row.matchId,turnNumber:a.state.turn.turnNumber,aftermath});
}

export function europeEnvelope(europe:boolean){if(!europe)return {schemaVersion:1 as const};const {originX,originY,maskPerGame,width,height,...profile}=EUROPE_SCENARIO_VIEW;void originX;void originY;void maskPerGame;void width;void height;return {schemaVersion:2 as const,profile}}
