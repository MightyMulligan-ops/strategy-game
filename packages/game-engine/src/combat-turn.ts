import type { CityId } from "@strategy-game/shared-types";
import type { CityLoopState, CityLoopFrozen, CityCapture, CityFormation } from "@strategy-game/shared-types/server";
import { chronologicalCityMovement } from "./combat-chronology.js";
import type { Leg, Point } from "./combat-chronology.js";
import { CITY_SCENARIO } from "./city-scenario.js";
import { consolidateGarrison, ownGarrison } from "./city-garrison.js";
import { europeLandPoint, europeLandSegment } from "./europe-playtest.js";
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

/** City-only battle and ownership timeline. After each complete battle the
 * surviving formations are stationary and may defend against later arrivals. */
export function executeCityForces(snapshot: CityLoopState, frozen: CityLoopFrozen, budget?: MultiForceBudget) {
 const units = new Map(snapshot.units.map(u=>[u.unitId,u]));
 const owners = new Map(snapshot.cityOwners.map(c=>[c.cityId,c.ownerPlayerId]));
 const captures: CityCapture[] = [], battles: CombatTurnResult["battles"][number][] = [];
 const routes = new Map<string, Leg[]>();
 const forms = [...snapshot.formations].sort((a,b)=>compareIds(a.formationId,b.formationId));
 const changing = new Map<string,Set<string>>();
 for (const draft of frozen.cityDrafts) for (const dispatch of draft.dispatches) {
  const garrison = ownGarrison(snapshot,draft.playerId,dispatch.cityId)!;
  const reserved = changing.get(garrison.formationId) ?? new Set();
  dispatch.unitIds.forEach(id=>reserved.add(id));
  changing.set(garrison.formationId,reserved);
  const formationId = `formation:${auditHash({ matchId:snapshot.config.gameId, turn:frozen.turn.turnNumber,
   playerId:draft.playerId, dispatchId:dispatch.dispatchId })}`;
  const f = {...garrison,formationId,garrisonCityId:null,unitIds:[...dispatch.unitIds].sort(compareIds)};
  forms.push(f);
  routes.set(formationId, [cityLeg(dispatch.dispatchId,1,world(f.position),dispatch.destination,0)]);
 }
 const initial = forms.map(f=>({...f,unitIds:f.unitIds.filter(id=>!changing.get(f.formationId)?.has(id))})).filter(f=>f.unitIds.length);
 for (const f of initial) if (!routes.has(f.formationId)) {
  const orders = frozen.players.find(p=>p.playerId===f.ownerPlayerId)!.orders.filter(o=>o.stackId===f.formationId);
  let from=world(f.position),time=0;
  routes.set(f.formationId,orders.map((o,i)=>{
   const leg=cityLeg(o.orderId,i+1,from,o.destination,time);
   from=leg.to;time=leg.end;return leg;
  }));
 }
 const encounterByForm = new Map<string,string>();
 const stopped = new Set<string>();
 const capture = (cityId: CityId, owner: string) => {
  const previous = owners.get(cityId)!;
  if(previous!==owner){captures.push({cityId,fromPlayerId:previous,toPlayerId:owner});owners.set(cityId,owner)}
 };
 const motion=chronologicalCityMovement(initial,routes,({time,contacts,arrivals},active,stop,position)=>{
  const groups: Set<string>[]=[];
  for (const pair of contacts) {
   const joined=groups.filter(g=>pair.some(id=>g.has(id)));
   const group=new Set([...pair,...joined.flatMap(g=>[...g])]);
   for (const g of joined) groups.splice(groups.indexOf(g),1);
   groups.push(group);
  }
  const siteAt=(id:string)=>CITY_SCENARIO.find(c=>distanceSquared(c.position,position(id))===0);
  // Simultaneous waypoint arrivals to a contested city participate together.
  for (const city of CITY_SCENARIO) {
   const atCity=arrivals.filter(id=>siteAt(id)?.cityId===city.cityId);
   const touching=groups.filter(g=>[...g].some(id=>distanceSquared(city.position,position(id))<=400));
   if(atCity.length===0||touching.length===0)continue;
   const group=new Set([...atCity,...touching.flatMap(g=>[...g])]);
   for(const g of touching)groups.splice(groups.indexOf(g),1);
   groups.push(group);
  }
  for (const group of groups.sort((a,b)=>compareIds([...a].sort(compareIds)[0]!,[...b].sort(compareIds)[0]!))) {
   const fighters=[...group].sort(compareIds).map(id=>active.get(id)!);
   const moving=(id:string)=>!stopped.has(id)&&(routes.get(id)??[]).some(l=>l.end>l.start&&l.start<=time&&time<=l.end);
   const point=fighters.find(f=>!moving(f.formationId));
   const center=point?position(point.formationId):world(milli({
    x:fighters.reduce((sum,f)=>sum+position(f.formationId).x,0)/fighters.length,
    y:fighters.reduce((sum,f)=>sum+position(f.formationId).y,0)/fighters.length
   }));
   const city=CITY_SCENARIO.filter(c=>distanceSquared(c.position,center)<=400)
    .sort((a,b)=>distanceSquared(a.position,center)-distanceSquared(b.position,center)||compareIds(a.cityId,b.cityId))[0];
   const destination=city?.position??center;
   if(!europeLandPoint(destination)||fighters.some(f=>!europeLandSegment(position(f.formationId),destination)))throw Error("CITY_CONTACT_SURFACE_UNAVAILABLE");
   const encounterId=`encounter:${auditHash({snapshot:snapshot.snapshotId,time,sequence:battles.length,group:[...group].sort(compareIds)})}`;
   const participants=new Set(fighters.map(f=>f.ownerPlayerId));
   const garrisons = new Map(fighters.filter(f=>f.garrisonCityId!==null).map(f=>[f.formationId,
    frozen.cityDrafts.find(d=>d.playerId===f.ownerPlayerId)?.commanders.find(c=>c.cityId===f.garrisonCityId)?.unitId??null]));
   const input={
    schemaVersion:1,rulesetVersion:MULTI_FORCE_COMBAT_VERSION,encounterId,seed:frozen.resolutionSeed,
    ownership:city?{locationId:city.cityId,ownerPlayerId:owners.get(city.cityId)!}:null,
    rules:{schedule:MULTI_FORCE_SCHEDULE,roll:MULTI_FORCE_ROLL,statFloor:"minimum-one-v1",alliances:"equivalence-v1",leadership:snapshot.combatPolicy.setup.leadership},
    relationships:snapshot.combatPolicy.relationships.filter(r=>participants.has(r.from)&&participants.has(r.to)),
    formations:fighters.map(f=>({formationId:f.formationId,ownerPlayerId:f.ownerPlayerId,stance:moving(f.formationId)?"moving":"stationary",
     units:f.unitIds.map(id=>{
      const {schemaVersion,ownerPlayerId,kind,...u}=units.get(id)!;void schemaVersion;void ownerPlayerId;
      return {...u,kind:kind==="INFANTRY"?"TROOP":"LEADER",unitType:kind==="INFANTRY"?"INFANTRY":"LEADER"};
     })}))
   };
   const result=resolveMultiForceCombat(input,budget,garrisons);
   if(!result.ok)throw Error(`CITY_COMBAT_${result.error.code}`);
   for(const f of fighters){stop(f.formationId);stopped.add(f.formationId);if(!encounterByForm.has(f.formationId))encounterByForm.set(f.formationId,encounterId)}
   for(const casualty of result.audit.units){
    if(casualty.finalHp===0)units.delete(casualty.unitId);
    else units.set(casualty.unitId,{...units.get(casualty.unitId)!,hp:casualty.finalHp});
   }
   const survivors=fighters.map(f=>({...f,unitIds:f.unitIds.filter(id=>units.has(id)),position:milli(destination)}))
    .filter(f=>f.unitIds.length);
   for(const f of fighters)active.delete(f.formationId);
   for(const f of survivors)active.set(f.formationId,f);
   const recipient=result.audit.ownershipRecipientPlayerId;
   if(city&&recipient){
    capture(city.cityId,recipient);
    merge(city.cityId,recipient,survivors.filter(f=>f.ownerPlayerId===recipient),active,stop);
   }
   battles.push({encounterId,position:milli(center),locationId:city?.cityId??null,
    formations:input.formations.map(f=>({formationId:f.formationId,stance:f.stance==="moving"?"moving":"stationary"})),
    outcome:result.audit.outcome,victoriousPlayerIds:result.audit.victoriousPlayerIds,recipientPlayerId:recipient,auditJson:JSON.stringify(result.audit)});
  }
  for(const city of CITY_SCENARIO){
   const incoming=arrivals.filter(id=>!stopped.has(id)&&active.has(id)&&siteAt(id)?.cityId===city.cityId).map(id=>active.get(id)!);
   if(!incoming.length)continue;
   const actor=incoming[0]!.ownerPlayerId;
   if(incoming.some(f=>f.ownerPlayerId!==actor))throw Error("CITY_CONTEST_UNRESOLVED");
   capture(city.cityId,actor);
   merge(city.cityId,actor,incoming,active,stop);
  }
 });
 function merge(cityId:CityId,actor:string,arrivals:readonly CityFormation[],active:Map<string,CityFormation>,stop:(id:string)=>void){
  for(const f of arrivals){stop(f.formationId);stopped.add(f.formationId)}
  const same=consolidateGarrison(snapshot,[...active.values()],actor,cityId,arrivals);
  active.clear();
  for(const f of same)active.set(f.formationId,f);
  const garrison=same.find(f=>f.garrisonCityId===cityId&&f.ownerPlayerId===actor);
  if(garrison){stop(garrison.formationId);stopped.add(garrison.formationId)}
 }
 const audits:CombatTurnResult["audits"][number][]=[];
 for(const f of initial){
  const stop=motion.stops.get(f.formationId);let remaining=250;
  for(const l of routes.get(f.formationId)??[]){
   const before=stop!==undefined&&stop<l.start,blocked=stop!==undefined&&stop>=l.start&&stop<l.end;
   const traveled=before?0:Math.max(0,Math.min(l.end,stop??l.end)-l.start);
   const ratio=l.end===l.start?1:traveled/(l.end-l.start);
   const to=milli({x:l.from.x+(l.to.x-l.from.x)*ratio,y:l.from.y+(l.to.y-l.from.y)*ratio});
   const encounterId=encounterByForm.get(f.formationId)??null;
   remaining-=traveled;
   audits.push({auditId:`combat-move:${auditHash({ snapshot:snapshot.snapshotId,formationId:f.formationId,orderId:l.orderId })}`,
    playerId:f.ownerPlayerId,formationId:f.formationId,orderId:l.orderId,moveNumber:l.moveNumber,sequence:audits.length,
    outcome:before?"not_executed_after_encounter":blocked?"blocked_encounter":"executed",
    from:milli(l.from),to,plannedDistance:l.end-l.start,traveled,remaining:Math.max(0,remaining),encounterId});
  }
 }
 return {units:[...units.values()].sort((a,b)=>compareIds(a.unitId,b.unitId)),formations:motion.formations,captures,battles,audits};
}
function cityLeg(orderId:string,moveNumber:number,from:Point,to:Point,start:number):Leg{
 return {orderId,moveNumber,from,to,start,end:start+Math.sqrt(distanceSquared(from,to))};
}
