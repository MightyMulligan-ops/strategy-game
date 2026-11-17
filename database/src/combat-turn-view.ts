import {CombatAftermathSchema,CombatFormationViewSchema} from "@strategy-game/shared-types";
import type {CombatAggregate} from "./combat-turn-storage.js";
/** Explicit own-only allowlists. Never spread a server audit into transport. */
export function ownCombatFormations(a:CombatAggregate,actor:string){
 const state=a.result?.nextState??a.snapshot;
 return state.formations.filter(f=>f.ownerPlayerId===actor).map(f=>({schemaVersion:1 as const,formationId:f.formationId,ownerPlayerId:actor,
  position:"xMilli" in f.position?{x:f.position.xMilli/1000,y:f.position.yMilli/1000}:f.position,
  units:f.unitIds.map(id=>{const u=state.units.find(u=>u.unitId===id&&u.ownerPlayerId===actor);if(!u)throw Error("Invalid own unit");
   return {schemaVersion:1 as const,unitId:u.unitId,originalSpawnNodeId:u.originalSpawnNodeId,hp:u.hp,maxHp:u.maxHp,
    ...(u.kind==="LEADER"?{kind:"LEADER" as const,rank:u.rank,specialization:u.specialization}:{kind:"INFANTRY" as const})};})}));
}
export function ownCombatFormationView(a:CombatAggregate,actor:string){return CombatFormationViewSchema.parse({schemaVersion:3,matchId:a.row.matchId,state:"READY",
 collisionRadius:10,pendingEncounter:false,formations:ownCombatFormations(a,actor)});}
export function ownCombatAftermath(a:CombatAggregate,actor:string,eventOffset=0){
 if(eventOffset!==0)throw Error("Invalid combat aftermath cursor");
 if(!a.result)return {schemaVersion:1 as const,matchId:a.row.matchId,state:"WAITING" as const};
 const own=a.snapshot.formations.filter(f=>f.ownerPlayerId===actor),ownIds=new Set(own.map(f=>f.formationId));
 const survivors=new Set(a.result.nextState.units.filter(u=>u.ownerPlayerId===actor).map(u=>u.unitId));
 return CombatAftermathSchema.parse({schemaVersion:2,matchId:a.row.matchId,state:"RESOLVED",formations:ownCombatFormations(a,actor),
  battles:a.result.battles.filter(b=>b.formations.some(f=>ownIds.has(f.formationId))).map(b=>{
   const ownFormationIds=b.formations.filter(f=>ownIds.has(f.formationId)).map(f=>f.formationId).sort();
   const ids=own.filter(f=>ownFormationIds.includes(f.formationId)).flatMap(f=>f.unitIds).sort();
   return {ownFormationIds,lostUnitIds:ids.filter(id=>!survivors.has(id)),survivingUnitIds:ids.filter(id=>survivors.has(id)),
    position:{x:b.position.xMilli/1000,y:b.position.yMilli/1000},outcome:b.outcome==="mutual_destruction"?"mutual_destruction":b.victoriousPlayerIds.includes(actor)?"victory":"defeat",
    ownership:b.locationId?{locationId:b.locationId,recipient:b.recipientPlayerId===actor?"own":b.recipientPlayerId?(b.victoriousPlayerIds.includes(actor)?"ally":"opponent"):"unchanged"}:null};
  }).sort((a,b)=>a.ownFormationIds.join()<b.ownFormationIds.join()?-1:a.ownFormationIds.join()>b.ownFormationIds.join()?1:0)});
}
