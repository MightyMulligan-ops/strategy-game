import { MOVEMENT_RESOLUTION_RUNTIME_PROFILE, MOVEMENT_RESOLUTION_POLICY, MovementResolutionRuntimeSchema,
  MovementInitialSnapshotSchema, MovementFrozenInputSchema, MovementResolutionResultSchema } from "@strategy-game/shared-types/server";
import type { MovementInitialSnapshot, MovementFrozenInput, InitialWorldArchive, MovementResolutionResult } from "@strategy-game/shared-types/server";
import type { TurnState } from "./turn.js";
import { planTurnClosure, freezeClosureInput } from "./turn-closure.js";
import { planMovementDrafts, previewMovementDraft } from "./movement-drafts.js";
import { groupMovementOrders } from "./movement-queue.js";
import { auditHash, canonicalJson } from "./determinism.js";
import { sweptContact, compareContact, strictStoppingPoint, squaredMilliDistance } from "./swept-contact.js";
import type { MilliPoint } from "./swept-contact.js";
export function planMovementResolution(config:unknown,players:unknown,archive:unknown,runtime:unknown=MOVEMENT_RESOLUTION_RUNTIME_PROFILE){
 const profile=MovementResolutionRuntimeSchema.parse(runtime),{snapshotId:initialClosureSnapshotId,...base}=planTurnClosure(config,players,archive).snapshot;
 const metadata={...base,schemaVersion:6,kind:"movement_resolution",ruleset:profile.ruleset,simulationVersion:profile.simulationVersion,
 initialClosureSnapshotId,movementPolicy:MOVEMENT_RESOLUTION_POLICY};
 return Object.freeze({runtimeProfile:profile,snapshot:MovementInitialSnapshotSchema.parse({...metadata,snapshotId:`movement-initial:${auditHash({snapshot:metadata,runtimeProfile:profile})}`})});
}
export function validateMovementInitialSnapshot(input:unknown,archive:unknown,runtime:unknown){
 const s=MovementInitialSnapshotSchema.parse(input),p=planMovementResolution(s.config,s.players,archive,runtime);
 if(canonicalJson(s)!==canonicalJson(p.snapshot))throw Error("Invalid movement snapshot identity");return s;
}
export function freezeMovementInput(state:TurnState,snapshot:MovementInitialSnapshot,archive:InitialWorldArchive){
 const old=planTurnClosure(snapshot.config,snapshot.players,archive).snapshot;
 const frozen=freezeClosureInput(state,old,archive);
 return MovementFrozenInputSchema.parse({...frozen,schemaVersion:3,kind:"movement_resolution",runtimeProfile:MOVEMENT_RESOLUTION_RUNTIME_PROFILE,
 startingSnapshotId:snapshot.snapshotId,resolutionSeed:archive.payload.seed});
}
export function resolveMovement(snapshotInput:unknown,frozenInput:unknown,archive:InitialWorldArchive):MovementResolutionResult{
 const snapshot=validateMovementInitialSnapshot(snapshotInput,archive,MOVEMENT_RESOLUTION_RUNTIME_PROFILE),frozen=MovementFrozenInputSchema.parse(frozenInput);
 if(frozen.startingSnapshotId!==snapshot.snapshotId||canonicalJson(frozen.worldRef)!==canonicalJson(snapshot.worldRef)||
  frozen.turn.gameId!==snapshot.config.gameId||canonicalJson(frozen.players.map(p=>p.playerId))!==canonicalJson(snapshot.players.map(p=>p.playerId))||
  frozen.worldSeed!==archive.payload.seed)throw Error("Invalid authoritative resolution input");
 const old=planMovementDrafts(snapshot.config,snapshot.players,archive).snapshot;
 for(const p of frozen.players)previewMovementDraft(old,archive,p.playerId,p.orders);
 return executeValidatedMovement(snapshot,frozen);
}
/** Internal geometry core: production callers must use resolveMovement's archive,
 * identity and complete frozen-path validation. Exported for isolated geometry fixtures. */
export function executeValidatedMovement(snapshotInput:MovementInitialSnapshot,frozenInput:MovementFrozenInput):MovementResolutionResult{
 const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
 const formations=[...snapshotInput.formations].sort((a,b)=>compare(a.ownerPlayerId,b.ownerPlayerId)||compare(a.formationId,b.formationId));
 const unitMap=new Map(snapshotInput.units.map(u=>[u.unitId,u]));
 const snapshot={...snapshotInput,players:[...snapshotInput.players].sort((a,b)=>compare(a.playerId,b.playerId)),formations,
  units:formations.flatMap(f=>f.unitIds.map(id=>{const u=unitMap.get(id);if(!u)throw Error("Invalid formation member");return u}))};
 const frozen={...frozenInput,players:[...frozenInput.players].sort((a,b)=>compare(a.playerId,b.playerId))};
 const resolutionId=`movement-resolution:${auditHash({snapshot,frozen,policy:MOVEMENT_RESOLUTION_POLICY})}`;
 const planned=new Map<string,number>();
 for(const p of frozen.players){const last=new Map(snapshot.formations.map(f=>[f.formationId,f.position]));
  for(const order of p.orders){const from=last.get(order.stackId);if(!from)throw Error("Unknown formation");
   planned.set(`${p.playerId}:${order.orderId}`,Math.sqrt((order.destination.x-from.x)**2+(order.destination.y-from.y)**2));last.set(order.stackId,order.destination);
  }
 }
 const positions=new Map(snapshot.formations.map(f=>[f.formationId,Object.freeze({xMilli:f.position.x*1000,yMilli:f.position.y*1000})]));
 const owners=new Map(snapshot.formations.map(f=>[f.formationId,f.ownerPlayerId]));
 const blocked=new Set<string>(),edges: {a:string;b:string;contact:MovementResolutionResult["encounters"][number]["contacts"][number]}[]=[];
 type MutableAudit={-readonly [K in keyof MovementResolutionResult["audits"][number]]:MovementResolutionResult["audits"][number][K]};
 const audits: MutableAudit[]=[];
 const traveled=new Map(snapshot.formations.map(f=>[f.formationId,0]));
 let sequence=0;
 const connect=(a:string,b:string,contact:typeof edges[number]["contact"])=>{blocked.add(a);blocked.add(b);edges.push({a,b,contact})};
 const ids=[...positions.keys()].sort();
 for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const a=ids[i]!,b=ids[j]!;
  if(owners.get(a)!==owners.get(b)&&squaredMilliDistance(positions.get(a)!,positions.get(b)!)<=400000000n){
   const p=positions.get(a)!;connect(a,b,{mover:a,defender:b,orderId:null,moveNumber:0,sequence:sequence++,
    mathematicalContact:{x:p.xMilli/1000,y:p.yMilli/1000},stopped:p,parameter:0,kind:"initial_contact"});
  }
 }
 for(const group of groupMovementOrders(frozen.players.map(p=>({playerId:p.playerId,revision:p.revision,orders:p.orders})),frozen.resolutionSeed)){
  for(const entry of group.moves){
   const id=entry.order.stackId,from=positions.get(id);if(!from||owners.get(id)!==entry.playerId)throw Error("Invalid formation ownership");
   const to={xMilli:entry.order.destination.x*1000,yMilli:entry.order.destination.y*1000};
   const plannedDistance=planned.get(`${entry.playerId}:${entry.order.orderId}`)!;
   let end:MilliPoint=from,outcome:typeof audits[number]["outcome"]="not_executed_after_encounter";
   if(!blocked.has(id)){
    const hostiles=ids.filter(other=>owners.get(other)!==entry.playerId);
    const contacts=hostiles.flatMap(other=>{const c=sweptContact(from,to,positions.get(other)!);return c?[{other,contact:c}]:[]});
    contacts.sort((a,b)=>compareContact(a.contact,b.contact)||(a.other<b.other?-1:a.other>b.other?1:0));
    const first=contacts[0];
    if(first){
     end=strictStoppingPoint(from,to,first.contact,hostiles.map(other=>positions.get(other)!));outcome="blocked_encounter";
     for(const c of contacts.filter(c=>compareContact(c.contact,first.contact)===0))connect(id,c.other,{mover:id,defender:c.other,
      orderId:entry.order.orderId,moveNumber:group.moveNumber,sequence,kind:"swept_contact",parameter:c.contact.parameter,
      mathematicalContact:{x:(from.xMilli+(to.xMilli-from.xMilli)*c.contact.parameter)/1000,y:(from.yMilli+(to.yMilli-from.yMilli)*c.contact.parameter)/1000},stopped:end});
    }else{end=Object.freeze(to);outcome="executed"}
    positions.set(id,end);
   }
   const distance=Math.sqrt(((end.xMilli-from.xMilli)/1000)**2+((end.yMilli-from.yMilli)/1000)**2),total=traveled.get(id)!+distance;
   if(total>250)throw Error("Resolved movement exceeds budget");traveled.set(id,total);
   const auditId=`movement-audit:${auditHash({resolutionId,playerId:entry.playerId,orderId:entry.order.orderId})}`;
   audits.push({auditId,playerId:entry.playerId,formationId:id,orderId:entry.order.orderId,moveNumber:group.moveNumber,sequence:sequence++,
    outcome,from,to:end,plannedDistance,traveled:distance,remaining:250-total,encounterId:null});
  }
 }
 // Components are finalized only after every qualifying contact; no persisted encounter is amended.
 const parent=new Map(ids.map(id=>[id,id]));
 const root=(id:string):string=>{let r=id;while(parent.get(r)!==r)r=parent.get(r)!;return r};
 for(const e of edges){const a=root(e.a),b=root(e.b);if(a!==b)parent.set(a<b?b:a,a<b?a:b)}
 const components=new Map<string,string[]>();for(const id of blocked){const r=root(id),members=components.get(r)??[];members.push(id);components.set(r,members)}
 const encounters=[...components.values()].map(members=>{
  members.sort();const encounterId=`pending-encounter:${auditHash({resolutionId,members})}`;
  for(const audit of audits)if(members.includes(audit.formationId)&&audit.outcome!=="executed")audit.encounterId=encounterId;
  return {encounterId,resolutionId,status:"unresolved" as const,policy:"swept-circle-lattice-v1" as const,
   members:members.map(formationId=>({formationId,playerId:owners.get(formationId)!})),contacts:edges.filter(e=>members.includes(e.a)).map(e=>e.contact)};
 }).sort((a,b)=>a.encounterId<b.encounterId?-1:a.encounterId>b.encounterId?1:0);
 const stateMetadata={...snapshot,schemaVersion:7,kind:"movement_resolved",stateVersion:1,completedTurnNumber:1,
  initialSnapshotId:snapshot.snapshotId,resolutionId,formations:snapshot.formations.map(f=>({...f,position:positions.get(f.formationId)!}))};
 const {snapshotId:ignored,...nextMetadata}=stateMetadata;void ignored;
 return MovementResolutionResultSchema.parse({schemaVersion:2,kind:"movement_resolution",runtimeProfile:MOVEMENT_RESOLUTION_RUNTIME_PROFILE,
  resolutionId,startingSnapshotId:snapshot.snapshotId,seed:frozen.resolutionSeed,policy:MOVEMENT_RESOLUTION_POLICY,
  nextState:{...nextMetadata,snapshotId:`movement-resolved:${auditHash(nextMetadata)}`},audits,encounters});
}
