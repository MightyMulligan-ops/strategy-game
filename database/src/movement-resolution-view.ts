import { ResolutionViewSchema, ResolvedOwnFormationSchema } from "@strategy-game/shared-types";
import type { MovementAggregate } from "./movement-resolution-storage.js";
export class MovementEventCursorError extends Error {}
export function ownResolvedFormation(a:MovementAggregate,actor:string){
 if(!a.result)throw Error("Movement is not resolved");
 const f=a.result.nextState.formations.find(f=>f.ownerPlayerId===actor);if(!f)throw Error("Missing owned formation");
 const members=new Map(a.snapshot.units.map(u=>[u.unitId,u]));
 return ResolvedOwnFormationSchema.parse({schemaVersion:1,formationId:f.formationId,ownerPlayerId:actor,
  position:{x:f.position.xMilli/1000,y:f.position.yMilli/1000},units:f.unitIds.map(id=>{
   const u=members.get(id)!;return {schemaVersion:1,unitId:u.unitId,originalSpawnNodeId:u.originalSpawnNodeId,
    ...(u.kind==="LEADER"?{kind:"LEADER",rank:u.rank,specialization:u.specialization}:{kind:"INFANTRY"})};
  })});
}
export function ownResolutionView(a:MovementAggregate,actor:string,eventOffset=0){
 if(!a.result)return ResolutionViewSchema.parse({schemaVersion:1,matchId:a.row.matchId,state:"WAITING"});
 const formation=ownResolvedFormation(a,actor),point=(p:{xMilli:number;yMilli:number})=>({x:p.xMilli/1000,y:p.yMilli/1000});
 const own=a.result.audits.filter(r=>r.playerId===actor),encounters=a.result.encounters.filter(e=>e.members.some(m=>m.playerId===actor));
 const audits=own.map(r=>({auditId:r.auditId,orderId:r.orderId,moveNumber:r.moveNumber,outcome:r.outcome,from:point(r.from),to:point(r.to),traveled:r.traveled,remaining:r.remaining,encounterId:r.encounterId}));

 // One first-contact effect per own encounter. Later enemy arrivals must not
 // reveal enemy formation/action counts through extra timeline records.
 const contactEvents=encounters.flatMap(e=>{
  const first=e.contacts.filter(c=>c.mover===formation.formationId||c.defender===formation.formationId).sort((a,b)=>a.sequence-b.sequence)[0];
  if(!first||(first.kind!=="initial_contact"&&first.mover===formation.formationId))return [];
  return [{eventId:`contact:${e.encounterId}:${formation.formationId}`,at:first.sequence,orderId:null,moveNumber:0,
   type:first.kind==="initial_contact"?"initial_contact" as const:"hostile_contact" as const,
   from:formation.position,to:formation.position,traveled:0,encounterId:e.encounterId}];
 });
 const events=[...contactEvents,...audits.map((r,i)=>({eventId:r.auditId,at:own[i]!.sequence,orderId:r.orderId,moveNumber:r.moveNumber,
  type:r.outcome,from:r.from,to:r.to,traveled:r.traveled,encounterId:r.encounterId}))]
  .sort((a,b)=>a.at-b.at||(a.eventId<b.eventId?-1:a.eventId>b.eventId?1:0)).map(({at,...e},i)=>{void at;return {...e,sequence:i}});
 if(!Number.isSafeInteger(eventOffset)||eventOffset<0||eventOffset>events.length)throw new MovementEventCursorError("Invalid event cursor");
 const page=events.slice(eventOffset,eventOffset+256),nextEventCursor=eventOffset+page.length<events.length?eventOffset+page.length:null;
 return ResolutionViewSchema.parse({schemaVersion:1,matchId:a.row.matchId,state:"RESOLVED",formation,eventOffset,eventTotal:events.length,nextEventCursor,
 summary:{completed:audits.filter(r=>r.outcome==="executed").length,stopped:audits.filter(r=>r.outcome==="blocked_encounter").length,
 notExecuted:audits.filter(r=>r.outcome==="not_executed_after_encounter").length,pendingEncounters:encounters.length},audits,events:page,pendingEncounterIds:encounters.map(e=>e.encounterId)});
}
