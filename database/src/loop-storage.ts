import {isDeepStrictEqual as same} from 'node:util';
import {LoopCommandSchema,TurnRecordSchema} from '@strategy-game/shared-types';
import {LoopCommitSchema,LoopRuntimeSchema,LoopFrozenSchema} from '@strategy-game/shared-types/server';
import type {LoopState,LoopResult,InitialWorldArchive} from '@strategy-game/shared-types/server';
import {planLoop,validateLoopState,reviseLoop,freezeLoop,resolveLoop,loopSame} from '@strategy-game/game-engine/server';
import type {TurnState,PlayerTurnDraft} from '@strategy-game/game-engine';
import type {Prisma} from './generated/prisma/client.js';
import {storedTurnInclude} from './turn-storage.js';
import type {StoredTurnRow} from './turn-storage.js';
import {json,orderRows,restoreTurnRecord,safeNumber} from './mappings.js';
import {restoreWorldArchive} from './world-repository.js';
import {PersistenceError} from './errors.js';
export function loopInvalid():never{throw new PersistenceError('invalid_storage','Repeating turn storage is inconsistent')}
export function restoreLoopDrafts(row:StoredTurnRow,snapshot:LoopState,archive:InitialWorldArchive){
 return [...row.players].sort((a,b)=>a.playerId<b.playerId?-1:1).map(p=>{
  const history=[...p.revisions].sort((a,b)=>a.revision<b.revision?-1:1);let d:PlayerTurnDraft={playerId:p.playerId,revision:0,ready:false,orders:[]};
  const expected=new Map<string,Omit<ReturnType<typeof orderRows>[number],'active'|'draftPosition'|'moveNumber'> & {active:boolean;draftPosition:number|null;moveNumber:number|null}>();
  if(p.matchId!==row.matchId||p.turnNumber!==row.number||!p.active||history.length!==safeNumber(p.revision)+1)loopInvalid();
  for(const [i,h]of history.entries()){
   if(h.revision!==BigInt(i)||h.matchId!==row.matchId||h.turnNumber!==row.number||h.playerId!==p.playerId)loopInvalid();
   if(i===0){if(h.kind!=='INITIAL'||h.ready||h.command!==null||!same(h.orders,[]))loopInvalid();continue}
   const c=LoopCommandSchema.parse(h.command);if(h.kind!==(c.kind==='set_ready'?'SET_READY':c.kind==='replace_orders'?'REPLACE_ORDERS':'CANCEL_ORDER'))loopInvalid();
   d=reviseLoop(snapshot,archive,d,c);if(h.ready!==d.ready||!same(h.orders,json(d.orders)))loopInvalid();
   if(c.kind==='set_ready')continue;
   for(const [id,o]of expected)if(o.active)expected.set(id,{...o,active:false,draftPosition:null,moveNumber:null,lastRevision:BigInt(i)});
   for(const o of orderRows(row.matchId,safeNumber(row.number),d))expected.set(o.orderId,o);
  }
  if(d.revision!==safeNumber(p.revision)||d.ready!==p.ready||expected.size!==p.orders.length)loopInvalid();
  for(const o of p.orders){const e=expected.get(o.orderId);if(!e||Object.entries(e).some(([k,v])=>!same(v,o[k as keyof typeof o])))loopInvalid()}
  return d;
 });
}
export function restoreLoopRow(row:StoredTurnRow,archive:InitialWorldArchive){
 const snapshot=validateLoopState(row.startingSnapshot.payload,archive),number=safeNumber(row.number),turn=restoreTurnRecord(row);
 if(row.matchId!==snapshot.config.gameId||snapshot.stateVersion!==number-1||row.startingStateVersion!==row.number-1n||row.startingSnapshot.snapshotId!==snapshot.snapshotId||row.startingSnapshot.stateVersion!==row.startingStateVersion||row.startingSnapshot.completedTurnNumber!==row.startingStateVersion||
  !['open','closed','resolved'].includes(turn.status)||turn.deadlineAtMs-turn.openedAtMs!==snapshot.config.turnDurationMs||row.lastObservedAtMs<row.openedAtMs||
  (turn.status==='open'&&(row.lastObservedAtMs>=row.deadlineAtMs||row.frozenInput!==null||row.resolution!==null))||
  (turn.status!=='open'&&(turn.closedAtMs>safeNumber(row.lastObservedAtMs)||turn.closeReason==='all_ready'&&row.lastObservedAtMs>=row.deadlineAtMs)))loopInvalid();
 const drafts=restoreLoopDrafts(row,snapshot,archive);if(!same(drafts.map(d=>d.playerId),snapshot.players.map(p=>p.playerId)))loopInvalid();
 const state:TurnState={config:snapshot.config,players:snapshot.players,turn,lastObservedAtMs:safeNumber(row.lastObservedAtMs),drafts};
 if(turn.status==='open'){if(drafts.every(d=>d.ready))loopInvalid()}
 else{const f=freezeLoop({...state,turn:TurnRecordSchema.parse({...turn,status:'closed'})},snapshot,archive);
  if(!row.frozenInput||row.frozenInput.seed!==BigInt(f.resolutionSeed)||!same(row.frozenInput.payload,json(f)))loopInvalid()}
 let result:LoopResult|null=null,nextOpenedAtMs:number|null=null;
 if(turn.status==='resolved'){
  if(!row.resolution||!row.frozenInput)loopInvalid();const commit=LoopCommitSchema.parse(row.resolution.payload);
  result=resolveLoop(snapshot,row.frozenInput.payload,archive);nextOpenedAtMs=commit.nextOpenedAtMs;
  if(!loopSame(result,commit.result)||row.resolution.resolutionId!==result.resolutionId||row.resolution.nextStateVersion!==row.number||nextOpenedAtMs<state.lastObservedAtMs||!Number.isSafeInteger(nextOpenedAtMs+snapshot.config.turnDurationMs))loopInvalid();
 }else if(row.resolution)loopInvalid();
 return {row,snapshot,state,result,nextOpenedAtMs,archive};
}
export type LoopAggregate=ReturnType<typeof restoreLoopRow>;
/** Constant-turn footprint: genesis plus requested/adjacent rows, never a whole-match history dump. */
export async function readLoop(tx:Prisma.TransactionClient,matchId:string,requested?:number):Promise<LoopAggregate>{
 const m=await tx.match.findUniqueOrThrow({where:{id:matchId},include:{configuration:true,world:true,participants:{where:{active:true}}}});
 if(!m.configuration||!m.world||m.status!=='RUNNING')loopInvalid();LoopRuntimeSchema.parse(m.configuration.pinnedRuleset);
 const archive=restoreWorldArchive(m.world),current=safeNumber(m.currentStateVersion)+1,n=requested??current;
 if(!Number.isSafeInteger(n)||n<1||n>current)loopInvalid();
 const fetch=(number:number)=>tx.turn.findUniqueOrThrow({where:{matchId_number:{matchId,number:BigInt(number)}},include:storedTurnInclude});
 const row=await fetch(n),a=restoreLoopRow(row,archive);
 if(!same(m.configuration.config,a.snapshot.config)||m.configuration.turnDurationMs!==BigInt(a.snapshot.config.turnDurationMs)||m.configuration.rulesetId!=='combat-loop'||m.configuration.rulesetVersion!=='1'||m.configuration.simulationVersion!=='combat-loop-v1'||
  !same(m.participants.map(p=>p.playerId).sort(),a.snapshot.players.map(p=>p.playerId))||m.participants.some(p=>!p.active)||a.snapshot.players.some(p=>!p.active))loopInvalid();
 const genesis=await tx.gameSnapshotRecord.findUniqueOrThrow({where:{matchId_stateVersion:{matchId,stateVersion:0n}}});
 const start=planLoop(a.snapshot.config,a.snapshot.players,archive,undefined,a.snapshot.combatPolicy.setup).snapshot;
 if(genesis.snapshotId!==start.snapshotId||!same(genesis.payload,json(start))||genesis.completedTurnNumber!==0n)loopInvalid();
 for(const unit of a.snapshot.units){const original=start.units.find(u=>u.unitId===unit.unitId);if(!original)loopInvalid();const {hp:oldHp,...originalFields}=original,{hp:newHp,...fields}=unit;void oldHp;void newHp;if(!same(fields,originalFields))loopInvalid()}
 for(const form of a.snapshot.formations){const original=start.formations.find(f=>f.formationId===form.formationId);if(!original||form.ownerPlayerId!==original.ownerPlayerId||form.unitIds.some(id=>!original.unitIds.includes(id)))loopInvalid()}
 if(n>1){const previous=restoreLoopRow(await fetch(n-1),archive);if(!previous.result||!loopSame(previous.result.nextState,a.snapshot)||previous.nextOpenedAtMs!==a.state.turn.openedAtMs)loopInvalid()}
 if(a.result){const next=await fetch(n+1);if(next.startingSnapshot.snapshotId!==a.result.nextState.snapshotId||!same(next.startingSnapshot.payload,json(a.result.nextState))||next.openedAtMs!==BigInt(a.nextOpenedAtMs!))loopInvalid()}
 if(n===current&&a.result||n<current&&!a.result)loopInvalid();
 if(await tx.turn.count({where:{matchId,status:{in:['OPEN','CLOSED','RESOLVING']}}})!==1||await tx.turn.count({where:{matchId}})!==current||await tx.gameSnapshotRecord.count({where:{matchId}})!==current||await tx.resolutionResult.count({where:{matchId}})!==current-1)loopInvalid();
 return a;
}
// Frozen shape checked separately for SQL/test callers too.
export const parseLoopFrozen=LoopFrozenSchema.parse;
