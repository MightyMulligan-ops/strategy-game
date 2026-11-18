import {planLoop,initialLoopTurn,freezeLoop,resolveLoop,applyLoop,openLoopNext} from '@strategy-game/game-engine/server';
import {LOOP_RUNTIME,InitialWorldArchiveSchema} from '@strategy-game/shared-types/server';
import {movementDraftFixture} from './movement-draft-fixture.js';
import {turnFields} from '../src/mappings.js';
import type {StoredTurnRow} from '../src/turn-storage.js';
import type {LoopState} from '@strategy-game/shared-types/server';
import type {TurnState} from '@strategy-game/game-engine';
const value=(v:object)=>JSON.parse(JSON.stringify(v)) as StoredTurnRow['startingSnapshot']['payload'];
export function loopFixture(count=2){
 const f=movementDraftFixture(count),archive=InitialWorldArchiveSchema.parse(f.archive),plan=planLoop(f.config,f.players,archive),rows=new Map<number,StoredTurnRow>(),snapshots=new Map<number,StoredTurnRow['startingSnapshot']>();
 function add(snapshot:LoopState,state:TurnState){
  const n=state.turn.turnNumber,base=structuredClone(f.row);const configuration={...base.match.configuration!,rulesetId:'combat-loop',rulesetVersion:'1',simulationVersion:'combat-loop-v1',pinnedRuleset:value(LOOP_RUNTIME)};
  const row={...base,number:BigInt(n),startingStateVersion:BigInt(n-1),...turnFields(state),frozenInput:null,resolution:null,startingSnapshot:{...base.startingSnapshot,stateVersion:BigInt(n-1),completedTurnNumber:BigInt(n-1),snapshotId:snapshot.snapshotId,payload:value(snapshot)},players:base.players.map(p=>({...p,turnNumber:BigInt(n),revision:0n,ready:false,orders:[],revisions:p.revisions.map(r=>({...r,turnNumber:BigInt(n)}))})),match:{...base.match,configuration,currentStateVersion:BigInt(n-1)}} as StoredTurnRow;
  rows.set(n,row);snapshots.set(n-1,row.startingSnapshot);return row;
 }
 let snapshot=plan.snapshot,state=initialLoopTurn(snapshot,1000);add(snapshot,state);
 function close(){let row=rows.get(state.turn.turnNumber)!;for(const actor of state.players){const d=state.drafts.find(d=>d.playerId===actor.playerId)!;const command={schemaVersion:1 as const,turnNumber:state.turn.turnNumber,expectedRevision:d.revision,kind:'set_ready' as const,ready:true};state=applyLoop(state,snapshot,archive,actor.playerId,command,state.turn.openedAtMs+1).state;
   const p=row.players.find(p=>p.playerId===actor.playerId)!;p.revision=1n;p.ready=true;p.revisions.push({...p.revisions[0]!,revision:1n,kind:'SET_READY',ready:true,command:value(command)});
  }row=Object.assign(row,turnFields(state));const frozen=freezeLoop(state,snapshot,archive);row.frozenInput={...f.row.frozenInput,matchId:row.matchId,turnNumber:row.number,payload:value(frozen),seed:BigInt(frozen.resolutionSeed),frozenAt:new Date()} as NonNullable<StoredTurnRow['frozenInput']>;return row;
 }
 function advance(){const row=close(),result=resolveLoop(snapshot,row.frozenInput!.payload,archive),next=openLoopNext(state,state.turn.deadlineAtMs+5000);row.status='RESOLVED';row.resolution={matchId:row.matchId,turnNumber:row.number,nextStateVersion:row.number,resolutionId:result.resolutionId,payload:value({schemaVersion:1,kind:'loop_commit',result,nextOpenedAtMs:next.turn.openedAtMs}),recordedAt:new Date()};snapshot=result.nextState;state=next;add(snapshot,state);sync();return result}
 function sync(){for(const row of rows.values())row.match.currentStateVersion=BigInt(state.turn.turnNumber-1)}
 return {f,archive,plan,rows,snapshots,advance,close,current:()=>({snapshot,state}),sync};
}
