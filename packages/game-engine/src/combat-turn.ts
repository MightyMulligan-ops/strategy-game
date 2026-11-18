import {MovementDraftOrdersSchema} from "@strategy-game/shared-types";
import {CombatInitialSnapshotSchema,CombatFrozenInputSchema,CombatTurnResultSchema,CombatSetupSchema,CombatTurnRuntimeSchema,
 COMBAT_TURN_RUNTIME_PROFILE,FIRST_COMBAT_SETUP} from "@strategy-game/shared-types/server";
import type {CombatInitialSnapshot,CombatFrozenInput,CombatTurnResult,CombatSetup,InitialWorldArchive} from "@strategy-game/shared-types/server";
import type {TurnState} from "./turn.js";
import {planInitialArmies} from "./initial-armies.js";
import {auditHash,canonicalJson,compareIds} from "./determinism.js";
import {previewMovementDraft} from "./movement-drafts.js";
import {gatherCombatEncounters,milli,world,distanceSquared} from "./combat-chronology.js";
import {adjacentCombatPosition} from "./combat-placement.js";
import {resolveMultiForceCombat,MULTI_FORCE_COMBAT_VERSION,MULTI_FORCE_ROLL,MULTI_FORCE_SCHEDULE} from "./multi-force-combat.js";
import type {MultiForceBudget} from "./multi-force-combat.js";
function freeze<T>(value:T):T{if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value)}return value;}
function relationships(players:readonly string[],setup:CombatSetup){
 const list=setup.relationshipPolicy.mode==="explicit-v1"?[...setup.relationshipPolicy.relationships]:players.flatMap(from=>players.filter(to=>to!==from).map(to=>({from,to,relation:"hostile" as const})));
 list.sort((a,b)=>compareIds(a.from,b.from)||compareIds(a.to,b.to));
 if(list.length!==players.length*(players.length-1)||new Set(list.map(r=>JSON.stringify([r.from,r.to]))).size!==list.length)throw Error("Invalid combat relationships");
 const allies=new Set(list.filter(r=>r.relation==="ally").map(r=>JSON.stringify([r.from,r.to])));
 const ally=(a:string,b:string)=>a===b||allies.has(JSON.stringify([a,b]));
 for(const r of list)if(r.from===r.to||!players.includes(r.from)||!players.includes(r.to)||ally(r.from,r.to)!==ally(r.to,r.from))throw Error("Invalid combat relationships");
 for(const a of players)for(const b of players)for(const c of players)if(ally(a,b)&&ally(b,c)&&!ally(a,c))throw Error("Non-transitive combat alliance");
 return list;
}
export function planCombatTurn(config:unknown,players:unknown,archive:unknown,runtime:unknown=COMBAT_TURN_RUNTIME_PROFILE,setupInput:unknown=FIRST_COMBAT_SETUP){
 const profile=CombatTurnRuntimeSchema.parse(runtime),parsedSetup=CombatSetupSchema.parse(setupInput),base=planInitialArmies(config,players,archive).snapshot;
 const rel=relationships(base.players.map(p=>p.playerId),parsedSetup);
 const setup={...parsedSetup,leadership:[...parsedSetup.leadership].sort((a,b)=>compareIds(a.specialization,b.specialization)||compareIds(a.unitType,b.unitType)),
  relationshipPolicy:parsedSetup.relationshipPolicy.mode==="explicit-v1"?{mode:"explicit-v1" as const,relationships:rel}:parsedSetup.relationshipPolicy};
 if(new Set(setup.leadership.map(p=>JSON.stringify([p.specialization,p.unitType]))).size!==setup.leadership.length||!setup.leadership.some(p=>p.specialization==="INFANTRY"&&p.unitType==="INFANTRY"))throw Error("Explicit infantry leadership policy required");
 const {snapshotId:initialArmiesSnapshotId,...army}=base;
 const combatPolicy={version:"chronological-speed-v1" as const,setup,relationships:relationships(base.players.map(p=>p.playerId),setup)};
 const metadata={...army,schemaVersion:8 as const,kind:"combat_initial" as const,ruleset:profile.ruleset,simulationVersion:profile.simulationVersion,
  initialArmiesSnapshotId,combatPolicy,units:base.units.map(u=>{const stats=u.kind==="INFANTRY"?setup.infantry:setup.lieutenant;return {...u,...stats,hp:stats.maxHp,leadershipEligible:u.kind==="INFANTRY"}}).sort((a,b)=>compareIds(a.unitId,b.unitId))};
 return freeze({runtimeProfile:profile,snapshot:CombatInitialSnapshotSchema.parse({...metadata,snapshotId:`combat-initial:${auditHash(metadata)}`})});
}
export function validateCombatInitialSnapshot(value:unknown,archive:unknown,runtime:unknown){
 const s=CombatInitialSnapshotSchema.parse(value),expected=planCombatTurn(s.config,s.players,archive,runtime,s.combatPolicy.setup).snapshot;
 if(canonicalJson(s)!==canonicalJson(expected))throw Error("Invalid combat initial identity");return freeze(s);
}
export function freezeCombatInput(state:TurnState,snapshot:CombatInitialSnapshot,archive:InitialWorldArchive){
 if(state.turn.status!=="closed"||canonicalJson(state.config)!==canonicalJson(snapshot.config)||canonicalJson(state.players)!==canonicalJson(snapshot.players))throw Error("Invalid combat closure");
 for(const d of state.drafts)previewMovementDraft(snapshot,archive,d.playerId,d.orders);
 return freeze(CombatFrozenInputSchema.parse({schemaVersion:4,kind:"combat_turn",runtimeProfile:COMBAT_TURN_RUNTIME_PROFILE,
  startingSnapshotId:snapshot.snapshotId,startingStateVersion:0,worldRef:snapshot.worldRef,worldSeed:archive.payload.seed,resolutionSeed:archive.payload.seed,
  combatPolicy:snapshot.combatPolicy,turn:state.turn,players:[...state.drafts].sort((a,b)=>compareIds(a.playerId,b.playerId)).map(d=>({...d,orders:MovementDraftOrdersSchema.parse(d.orders)}))}));
}
export function resolveCombatTurn(snapshotInput:unknown,frozenInput:unknown,archive:InitialWorldArchive,budget?:MultiForceBudget):CombatTurnResult{
 const snapshot=validateCombatInitialSnapshot(snapshotInput,archive,COMBAT_TURN_RUNTIME_PROFILE),frozen=CombatFrozenInputSchema.parse(frozenInput);
 if(frozen.startingSnapshotId!==snapshot.snapshotId||frozen.resolutionSeed!==archive.payload.seed||frozen.worldSeed!==archive.payload.seed||
  canonicalJson(frozen.worldRef)!==canonicalJson(snapshot.worldRef)||canonicalJson(frozen.combatPolicy)!==canonicalJson(snapshot.combatPolicy)||
  frozen.turn.gameId!==snapshot.config.gameId||frozen.turn.turnNumber!==1||frozen.turn.status!=="closed"||
  canonicalJson(frozen.players.map(p=>p.playerId))!==canonicalJson(snapshot.players.map(p=>p.playerId)))throw Error("Invalid combat frozen identity");
 for(const p of frozen.players)previewMovementDraft(snapshot,archive,p.playerId,p.orders);
 return executeValidatedCombatTurn(snapshot,frozen,archive,budget);
}
/** Geometry/scenario seam. Persistence MUST use resolveCombatTurn with archive,
 * complete initial identity and frozen-history validation, never this seam. */
export function executeValidatedCombatTurn(snapshotInput:CombatInitialSnapshot,frozenInput:CombatFrozenInput,archive:InitialWorldArchive,budget?:MultiForceBudget):CombatTurnResult{
 const snapshot=CombatInitialSnapshotSchema.parse(snapshotInput),frozen=CombatFrozenInputSchema.parse(frozenInput);
 return executeCombatForces(snapshot,frozen,archive,budget);
}
/** Internal kernel; only callers with their own strict runtime validation may enter. */
export function executeCombatForces(snapshot:CombatInitialSnapshot,frozen:CombatFrozenInput,archive:InitialWorldArchive,budget?:MultiForceBudget,carriedOwners?:readonly {cityId:string;ownerPlayerId:string}[],surface?:{point:(p:{x:number;y:number})=>boolean;segment:(a:{x:number;y:number},b:{x:number;y:number})=>boolean}):CombatTurnResult{
 const forms=[...snapshot.formations].sort((a,b)=>compareIds(a.formationId,b.formationId));
 const units=[...snapshot.units].sort((a,b)=>compareIds(a.unitId,b.unitId));
 if(new Set(forms.map(f=>f.formationId)).size!==forms.length||new Set(units.map(u=>u.unitId)).size!==units.length||
  new Set(forms.flatMap(f=>f.unitIds)).size!==units.length||forms.flatMap(f=>f.unitIds).length!==units.length||
  forms.some(f=>f.unitIds.some(id=>!units.some(u=>u.unitId===id&&u.ownerPlayerId===f.ownerPlayerId))))throw Error("Invalid combat membership");
 relationships(snapshot.players.map(p=>p.playerId),{...snapshot.combatPolicy.setup,relationshipPolicy:{mode:"explicit-v1",relationships:snapshot.combatPolicy.relationships}});
 const canonical={...snapshot,formations:forms.map(f=>({...f,unitIds:[...f.unitIds].sort(compareIds)})),units};
 const resolutionId=`combat-turn:${auditHash({snapshot:canonical,frozen:{...frozen,players:[...frozen.players].sort((a,b)=>compareIds(a.playerId,b.playerId))}})}`;
 const movement=gatherCombatEncounters(canonical,frozen);
 if(surface)for(const e of movement.encounters){
  if(!surface.point(e.position)||[...e.members.keys()].some(id=>!surface.segment(movement.position(id,e.time),e.position)))throw Error("EUROPE_CONTACT_SURFACE_UNAVAILABLE");
 }
 const hp=new Map(units.map(u=>[u.unitId,u.hp])),positions=new Map(forms.map(f=>[f.formationId,milli(movement.position(f.formationId,250))]));
 const cityOwners=(carriedOwners??archive.payload.startingState.cities).map(c=>({cityId:c.cityId,ownerPlayerId:c.ownerPlayerId})).sort((a,b)=>compareIds(a.cityId,b.cityId));
 const battles:CombatTurnResult["battles"][number][]=[];
 for(const e of movement.encounters){
  const participants=forms.filter(f=>e.members.has(f.formationId));
  const playerIds=[...new Set(participants.map(f=>f.ownerPlayerId))];
  const relevant=snapshot.combatPolicy.relationships.filter(r=>playerIds.includes(r.from)&&playerIds.includes(r.to));
  const cities=archive.payload.startingState.cities.filter(c=>distanceSquared(c.position,e.position)<=400)
   .sort((a,b)=>distanceSquared(a.position,e.position)-distanceSquared(b.position,e.position)||compareIds(a.cityId,b.cityId));
  const city=cities[0];
  if(surface&&city&&(!surface.point(city.position)||!surface.segment(e.position,city.position)))throw Error("EUROPE_CAPTURE_SURFACE_UNAVAILABLE");
  const input={schemaVersion:1,rulesetVersion:MULTI_FORCE_COMBAT_VERSION,encounterId:e.encounterId,seed:frozen.resolutionSeed,
   ownership:city?{locationId:city.cityId,ownerPlayerId:cityOwners.find(c=>c.cityId===city.cityId)!.ownerPlayerId}:null,
   rules:{schedule:MULTI_FORCE_SCHEDULE,roll:MULTI_FORCE_ROLL,statFloor:"minimum-one-v1",alliances:"equivalence-v1",leadership:snapshot.combatPolicy.setup.leadership},relationships:relevant,
   formations:participants.map(f=>({formationId:f.formationId,ownerPlayerId:f.ownerPlayerId,stance:e.members.get(f.formationId)!,
    units:f.unitIds.map(id=>{const u=units.find(u=>u.unitId===id)!;const {schemaVersion,ownerPlayerId,kind,...rest}=u;void schemaVersion;void ownerPlayerId;
     return {...rest,kind:kind==="INFANTRY"?"TROOP":"LEADER",unitType:kind==="INFANTRY"?"INFANTRY":"LEADER"};})}))};
  const result=resolveMultiForceCombat(input,budget);if(!result.ok)throw Error(`COMBAT_${result.error.code}`);
  const audit=result.audit;
  for(const u of audit.units)hp.set(u.unitId,u.finalHp);
  const survivors=participants.filter(f=>f.unitIds.some(id=>hp.get(id)!>0));
  const recipient=audit.ownershipRecipientPlayerId;
  if(city&&recipient)cityOwners.find(c=>c.cityId===city.cityId)!.ownerPlayerId=recipient;
  for(const f of survivors.filter(f=>!city||!recipient||f.ownerPlayerId===recipient))positions.set(f.formationId,milli(city&&recipient?city.position:e.position));
  const relocating=survivors.filter(f=>city&&recipient&&f.ownerPlayerId!==recipient),placed=new Set<string>();
  for(const f of relocating){
   const occupied=forms.filter(other=>other.formationId!==f.formationId&&other.ownerPlayerId!==f.ownerPlayerId&&(!relocating.some(x=>x.formationId===other.formationId)||placed.has(other.formationId))&&other.unitIds.some(id=>hp.get(id)!>0)).map(other=>world(positions.get(other.formationId)!));
   positions.set(f.formationId,milli(adjacentCombatPosition(city!.position,archive.payload.bounds,occupied,100000,surface?p=>surface.point(p)&&surface.segment(city!.position,p):undefined)));placed.add(f.formationId);
  }
  battles.push({encounterId:e.encounterId,position:milli(e.position),locationId:city?.cityId??null,
   formations:participants.map(f=>({formationId:f.formationId,stance:e.members.get(f.formationId)!})),outcome:audit.outcome,
   victoriousPlayerIds:audit.victoriousPlayerIds,recipientPlayerId:recipient,auditJson:JSON.stringify(audit)});
 }
 const audits:CombatTurnResult["audits"][number][]=[];
 for(const f of forms){const stop=movement.stops.get(f.formationId),encounter=movement.assigned.get(f.formationId);let remaining=250;
  for(const l of movement.legs.get(f.formationId)!){const before=stop!==undefined&&stop<l.start,blocked=stop!==undefined&&stop>=l.start&&stop<=l.end;
   const traveled=before?0:Math.max(0,Math.min(l.end,stop??l.end)-l.start);remaining-=traveled;
   const from=before?positions.get(f.formationId)!:milli(l.from),to=before?from:blocked?milli(movement.position(f.formationId,stop!)):milli(l.to);
   audits.push({auditId:`combat-move:${auditHash({resolutionId,formationId:f.formationId,orderId:l.orderId})}`,playerId:f.ownerPlayerId,formationId:f.formationId,
    orderId:l.orderId,moveNumber:l.moveNumber,sequence:audits.length,outcome:before?"not_executed_after_encounter":blocked?"blocked_encounter":"executed",
    from,to,plannedDistance:l.end-l.start,traveled,remaining:Math.max(0,remaining),encounterId:encounter?.encounterId??null});
  }
 }
 const activeUnits=units.filter(u=>hp.get(u.unitId)!>0).map(u=>({...u,hp:hp.get(u.unitId)!}));
 const activeForms=forms.map(f=>({...f,unitIds:[...f.unitIds].sort(compareIds).filter(id=>hp.get(id)!>0),position:positions.get(f.formationId)!})).filter(f=>f.unitIds.length);
 for(let i=0;i<activeForms.length;i++)for(let j=i+1;j<activeForms.length;j++){
  const a=activeForms[i]!,b=activeForms[j]!;
  if(snapshot.combatPolicy.relationships.some(r=>r.from===a.ownerPlayerId&&r.to===b.ownerPlayerId&&r.relation==="hostile")&&distanceSquared(world(a.position),world(b.position))<=400)throw Error("COMBAT_PLACEMENT_UNAVAILABLE");
 }
 if(surface&&activeForms.some(f=>!surface.point(world(f.position))))throw Error("EUROPE_FINAL_POSITION_NOT_LAND");
 const {snapshotId:initialSnapshotId,...base}=canonical;
 const next={...base,schemaVersion:9 as const,kind:"combat_resolved" as const,stateVersion:1 as const,completedTurnNumber:1 as const,initialSnapshotId,resolutionId,
  units:activeUnits,formations:activeForms,cityOwners};
 return freeze(CombatTurnResultSchema.parse({schemaVersion:3,kind:"combat_turn",runtimeProfile:COMBAT_TURN_RUNTIME_PROFILE,resolutionId,
  startingSnapshotId:snapshot.snapshotId,seed:frozen.resolutionSeed,nextState:{...next,snapshotId:`combat-resolved:${auditHash(next)}`},battles,audits}));
}
