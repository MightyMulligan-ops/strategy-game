import {RepeatingCommandSchema as LoopCommandSchema,MovementDraftOrdersSchema,TurnRecordSchema} from '@strategy-game/shared-types';
import type {RepeatingCommand as LoopCommand,MovementDraftOrder} from '@strategy-game/shared-types';
import {RepeatingStateSchema as LoopStateSchema,RepeatingFrozenSchema as LoopFrozenSchema,RepeatingResultSchema as LoopResultSchema,RepeatingRuntimeSchema as LoopRuntimeSchema,LOOP_RUNTIME,EUROPE_RUNTIME,FIRST_COMBAT_SETUP,COMBAT_TURN_RUNTIME_PROFILE} from '@strategy-game/shared-types/server';
import type {LoopState,LoopFrozen,InitialWorldArchive,CombatInitialSnapshot,CombatFrozenInput,LoopResult} from '@strategy-game/shared-types/server';
import {planCombatTurn,executeCombatForces} from './combat-turn.js';
import type {MultiForceBudget} from './multi-force-combat.js';
import {validateEuropeScenario,europeLandPoint,europeLandSegment} from './europe-playtest.js';
import {auditHash,canonicalJson} from './determinism.js';
import {observeDeadline,createTurn,openNextTurn} from './turn.js';
import type {PlayerTurnDraft,TurnState} from './turn.js';
export class LoopFailure extends Error{constructor(readonly code:string){super(code)}}
export const loopSame=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const runtimeFor=(s:LoopState)=>s.simulationVersion==='europe-playtest-v1'?EUROPE_RUNTIME:LOOP_RUNTIME;
function seal(value:Omit<LoopState,'snapshotId'>):LoopState{const {snapshotId:previous,...meta}=value as LoopState;void previous;return LoopStateSchema.parse({...meta,snapshotId:`loop-state:${auditHash(meta)}`})}
export function planLoop(config:unknown,players:unknown,archive:InitialWorldArchive,runtime:unknown=LOOP_RUNTIME,setup?:unknown){
 const profile=LoopRuntimeSchema.parse(runtime),europe=profile.simulationVersion==='europe-playtest-v1';if(europe)validateEuropeScenario(archive);
 const explicit={...FIRST_COMBAT_SETUP,relationshipPolicy:{mode:'explicit-v1' as const,relationships:archive.payload.players.flatMap(from=>archive.payload.players.filter(to=>to!==from).map(to=>({from,to,relation:'hostile' as const})))}};
 if(europe&&setup!==undefined&&!loopSame(setup,FIRST_COMBAT_SETUP)&&!loopSame(setup,explicit))throw new LoopFailure('INTERNAL_ERROR');
 const initial=planCombatTurn(config,players,archive,undefined,europe?explicit:setup).snapshot;
 const {snapshotId,...s}=initial;void snapshotId;
 return {runtimeProfile:profile,snapshot:seal({...s,schemaVersion:europe?11:10,kind:europe?'europe_loop_state':'loop_state',ruleset:profile.ruleset,simulationVersion:profile.simulationVersion,
  predecessorResolutionId:null,formations:s.formations.map(f=>({...f,position:{xMilli:f.position.x*1000,yMilli:f.position.y*1000}})),cityOwners:archive.payload.startingState.cities.map(c=>({cityId:c.cityId,ownerPlayerId:c.ownerPlayerId})).sort((a,b)=>a.cityId<b.cityId?-1:1)})};
}
export function validateLoopState(input:unknown,archive:InitialWorldArchive):LoopState{
 const s=LoopStateSchema.parse(input),{snapshotId,...meta}=s;
 if(snapshotId!==`loop-state:${auditHash(meta)}`||s.config.gameId!==s.worldRef.matchId||s.worldRef.matchId!==archive.matchId)throw new LoopFailure('INTERNAL_ERROR');
 if(s.stateVersion===0&&!loopSame(s,planLoop(s.config,s.players,archive,runtimeFor(s),s.combatPolicy.setup).snapshot))throw new LoopFailure('INTERNAL_ERROR');
 const unitIds=new Set(s.units.map(u=>u.unitId)),formIds=new Set(s.formations.map(f=>f.formationId)),members=s.formations.flatMap(f=>f.unitIds);
 if(unitIds.size!==s.units.length||formIds.size!==s.formations.length||members.length!==unitIds.size||new Set(members).size!==members.length||
  s.units.some(u=>!s.players.some(p=>p.playerId===u.ownerPlayerId))||s.formations.some(f=>f.unitIds.some(id=>!s.units.some(u=>u.unitId===id&&u.ownerPlayerId===f.ownerPlayerId))||f.position.xMilli>archive.payload.bounds.width*1000||f.position.yMilli>archive.payload.bounds.height*1000)||
  s.cityOwners.length!==archive.payload.startingState.cities.length||new Set(s.cityOwners.map(c=>c.cityId)).size!==s.cityOwners.length||s.cityOwners.some(c=>!archive.payload.startingState.cities.some(x=>x.cityId===c.cityId)||!s.players.some(p=>p.playerId===c.ownerPlayerId)))throw new LoopFailure('INTERNAL_ERROR');
 if(s.simulationVersion==='europe-playtest-v1'){validateEuropeScenario(archive);if(s.formations.some(f=>!europeLandPoint({x:f.position.xMilli/1000,y:f.position.yMilli/1000})))throw new LoopFailure('INTERNAL_ERROR')}
 return s;
}
/** Current state, never the immutable initial six-unit roster. No numeric source radius invented. */
export function previewLoop(snapshot:LoopState,archive:InitialWorldArchive,actor:string,input:unknown){
 const orders=MovementDraftOrdersSchema.parse(input),byForm=new Map<string,readonly MovementDraftOrder[]>();
 for(const order of orders){if(!snapshot.formations.some(f=>f.formationId===order.stackId&&f.ownerPlayerId===actor))throw new LoopFailure('INVALID_DRAFT');byForm.set(order.stackId,[...byForm.get(order.stackId)??[],order])}
 return snapshot.formations.filter(f=>f.ownerPlayerId===actor).map(f=>{let from={x:f.position.xMilli/1000,y:f.position.yMilli/1000},distance=0;
  const route=byForm.get(f.formationId)??[],units=snapshot.units.filter(u=>f.unitIds.includes(u.unitId));
  if(route.length&&!units.some(u=>u.kind==='LEADER'))throw new LoopFailure('INVALID_DRAFT');
  const segments=route.map((o,i)=>{if(o.destination.x>archive.payload.bounds.width||o.destination.y>archive.payload.bounds.height)throw new LoopFailure('INVALID_DRAFT');
   if(snapshot.simulationVersion==='europe-playtest-v1'&&!europeLandSegment(from,o.destination))throw new LoopFailure('INVALID_DRAFT');
   const length=Math.sqrt((o.destination.x-from.x)**2+(o.destination.y-from.y)**2);distance+=length;const s={orderId:o.orderId,moveNumber:i+1,from,destination:o.destination,distance:length,cumulative:distance};from=o.destination;return s});
  if(distance>250)throw new LoopFailure('INVALID_DRAFT');return {formationId:f.formationId,range:250 as const,distance,remaining:250-distance,segments};
 });
}
export function reviseLoop(snapshot:LoopState,archive:InitialWorldArchive,draft:PlayerTurnDraft,input:unknown){
 const c=LoopCommandSchema.parse(input);if((snapshot.simulationVersion==='europe-playtest-v1')!==(c.schemaVersion===2))throw new LoopFailure('INVALID_DRAFT');if(c.turnNumber!==snapshot.completedTurnNumber+1)throw new LoopFailure('WRONG_TURN');
 if(c.expectedRevision!==draft.revision)throw new LoopFailure('STALE_REVISION');if(draft.revision===Number.MAX_SAFE_INTEGER)throw new LoopFailure('REVISION_EXHAUSTED');
 if(c.kind==='set_ready'){if(c.ready===draft.ready)throw new LoopFailure('READY_UNCHANGED');return {...draft,revision:draft.revision+1,ready:c.ready}}
 if(draft.ready)throw new LoopFailure('READY_LOCKED');if(c.kind==='cancel_order'&&!draft.orders.some(o=>o.orderId===c.orderId))throw new LoopFailure('ORDER_NOT_FOUND');
 const orders=c.kind==='replace_orders'?c.orders:draft.orders.filter(o=>o.orderId!==c.orderId);previewLoop(snapshot,archive,draft.playerId,orders);return {...draft,revision:draft.revision+1,orders};
}
export function applyLoop(state:TurnState,snapshot:LoopState,archive:InitialWorldArchive,actor:string,c:LoopCommand,now:number){
 if(c.turnNumber!==state.turn.turnNumber)throw new LoopFailure('WRONG_TURN');
 const observed=observeDeadline(state,now);if(observed.turn.status!=='open')return {state:observed,error:'TURN_CLOSED'};
 const own=observed.drafts.find(d=>d.playerId===actor);if(!own)throw new LoopFailure('NOT_FOUND');
 try{const draft=reviseLoop(snapshot,archive,own,c),drafts=observed.drafts.map(d=>d.playerId===actor?draft:d);
  const turn=drafts.every(d=>d.ready)?TurnRecordSchema.parse({...observed.turn,status:'closed',closedAtMs:now,closeReason:'all_ready'}):observed.turn;
  return {state:{...observed,drafts,turn},draft};
 }catch(e){if(e instanceof LoopFailure)return {state:observed,error:e.code};throw e}
}
export function freezeLoop(state:TurnState,snapshot:LoopState,archive:InitialWorldArchive):LoopFrozen{
 if(state.turn.status!=='closed'||state.turn.turnNumber!==snapshot.stateVersion+1||!loopSame(state.config,snapshot.config)||!loopSame(state.players,snapshot.players))throw new LoopFailure('INTERNAL_ERROR');
 for(const d of state.drafts)previewLoop(snapshot,archive,d.playerId,d.orders);
 const turn=state.turn.turnNumber;
 return LoopFrozenSchema.parse({schemaVersion:snapshot.simulationVersion==='europe-playtest-v1'?6:5,kind:snapshot.simulationVersion==='europe-playtest-v1'?'europe_loop_frozen':'loop_frozen',runtimeProfile:runtimeFor(snapshot),startingSnapshotId:snapshot.snapshotId,startingStateVersion:snapshot.stateVersion,
  worldRef:snapshot.worldRef,worldSeed:archive.payload.seed,resolutionSeed:(archive.payload.seed+turn-1)%0x100000000,
  seedIdentity:`loop-seed:${auditHash({match:snapshot.config.gameId,turn,state:snapshot.snapshotId,worldSeed:archive.payload.seed})}`,combatPolicy:snapshot.combatPolicy,turn:state.turn,players:state.drafts});
}
export function resolveLoop(snapshotInput:ReturnType<(typeof import('@strategy-game/shared-types/server').LoopStateSchema)['parse']>,frozenInput:unknown,archive:InitialWorldArchive,budget?:MultiForceBudget):ReturnType<(typeof import('@strategy-game/shared-types/server').LoopResultSchema)['parse']>;
export function resolveLoop(snapshotInput:unknown,frozenInput:unknown,archive:InitialWorldArchive,budget?:MultiForceBudget):LoopResult;
export function resolveLoop(snapshotInput:unknown,frozenInput:unknown,archive:InitialWorldArchive,budget?:MultiForceBudget):LoopResult{
 const s=validateLoopState(snapshotInput,archive),f=LoopFrozenSchema.parse(frozenInput);
 const state:TurnState={config:s.config,players:s.players,turn:f.turn,drafts:f.players,lastObservedAtMs:f.turn.closedAtMs};
 if(!loopSame(f,freezeLoop(state,s,archive)))throw new LoopFailure('INTERNAL_ERROR');
 const {cityOwners:ignoredOwners,predecessorResolutionId:ignoredPredecessor,...surrogateBase}=s;void ignoredOwners;void ignoredPredecessor;
 const surrogate:CombatInitialSnapshot={...surrogateBase,schemaVersion:8,kind:'combat_initial',ruleset:COMBAT_TURN_RUNTIME_PROFILE.ruleset,simulationVersion:'combat-turn-v1',stateVersion:0,completedTurnNumber:0,
  snapshotId:`combat-initial:${auditHash({loop:s.snapshotId,turn:f.turn.turnNumber})}`,formations:s.formations.map(x=>({...x,position:{x:x.position.xMilli/1000,y:x.position.yMilli/1000}}))};
 const frozen:CombatFrozenInput={...f,schemaVersion:4,kind:'combat_turn',runtimeProfile:COMBAT_TURN_RUNTIME_PROFILE,startingSnapshotId:surrogate.snapshotId,startingStateVersion:0,turn:{...f.turn,turnNumber:1}};
 const result=executeCombatForces(surrogate,frozen,archive,budget,s.cityOwners,s.simulationVersion==='europe-playtest-v1'?{point:europeLandPoint,segment:europeLandSegment}:undefined);
 const resolutionId=`loop-result:${auditHash({state:s.snapshotId,frozen:f})}`;
 const next=seal({...s,stateVersion:s.stateVersion+1,completedTurnNumber:s.completedTurnNumber+1,predecessorResolutionId:resolutionId,units:result.nextState.units,formations:result.nextState.formations,cityOwners:result.nextState.cityOwners});
 return LoopResultSchema.parse({schemaVersion:s.simulationVersion==='europe-playtest-v1'?5:4,kind:s.simulationVersion==='europe-playtest-v1'?'europe_loop_result':'loop_result',runtimeProfile:runtimeFor(s),resolutionId,startingSnapshotId:s.snapshotId,turnNumber:f.turn.turnNumber,seed:f.resolutionSeed,seedIdentity:f.seedIdentity,nextState:next,battles:result.battles,audits:result.audits});
}
export function openLoopNext(previous:TurnState,openedAtMs:number){return openNextTurn({...previous,turn:TurnRecordSchema.parse({...previous.turn,status:'resolved'})},openedAtMs)}
export function initialLoopTurn(snapshot:LoopState,now:number){return createTurn(snapshot.config,snapshot.players,now)}
