import {describe,it,expect} from 'vitest';
import {armyFixture} from './initial-armies-fixture.js';
import {InitialWorldArchiveSchema,LoopStateSchema} from '@strategy-game/shared-types/server';
import {planLoop,initialLoopTurn,applyLoop,freezeLoop,resolveLoop,openLoopNext,validateLoopState,previewLoop} from '../src/combat-loop.js';
import {auditHash} from '../src/determinism.js';
import {observeDeadline} from '../src/turn.js';
import type {LoopState,InitialWorldArchive} from '@strategy-game/shared-types/server';
import type {TurnState} from '../src/turn.js';
function fixture(count=2){const f=armyFixture(count),archive=InitialWorldArchiveSchema.parse(f.archive),snapshot=LoopStateSchema.parse(planLoop(f.config,f.players,archive).snapshot);return {...f,archive,snapshot,state:initialLoopTurn(snapshot,1000)}}
function ready(state:TurnState,snapshot:LoopState,archive:InitialWorldArchive){let s=state;for(const d of s.drafts)s=applyLoop(s,snapshot,archive,d.playerId,{schemaVersion:1,turnNumber:s.turn.turnNumber,expectedRevision:d.revision,kind:'set_ready',ready:true},s.turn.openedAtMs+1).state;return s}
function signed(s:LoopState){const {snapshotId,...meta}=s;void snapshotId;return LoopStateSchema.parse({...meta,snapshotId:`loop-state:${auditHash(meta)}`})}
describe('repeating pure runtime: deterministic state and fresh planning',()=>{
 it.each([2,4,40])('advances1→2→3→4 for%i players with exact carryover and unique turn seeds',count=>{
  const f=fixture(count);let snapshot=f.snapshot,state=f.state;const seeds=new Set<number>();
  for(let n=1;n<=3;n++){
   const closed=ready(state,snapshot,f.archive),frozen=freezeLoop(closed,snapshot,f.archive),result=resolveLoop(snapshot,frozen,f.archive);seeds.add(frozen.resolutionSeed);
   expect(resolveLoop(snapshot,structuredClone(frozen),f.archive)).toEqual(result);expect(result.nextState.units).toEqual(snapshot.units);expect(result.nextState.cityOwners).toEqual(snapshot.cityOwners);expect(result.nextState.combatPolicy).toEqual(snapshot.combatPolicy);
   state=openLoopNext({...closed,lastObservedAtMs:closed.turn.openedAtMs+2},closed.turn.deadlineAtMs+50000);snapshot=result.nextState;
   expect(state.turn.turnNumber).toBe(n+1);expect(state.turn.deadlineAtMs-state.turn.openedAtMs).toBe(f.config.turnDurationMs);expect(state.drafts.every(d=>!d.ready&&d.revision===0&&d.orders.length===0)).toBe(true);
  }expect(seeds.size).toBe(3);expect(state.turn.turnNumber).toBe(4);
 });
 it('resets budget and clears old orders, without resetting position or provenance',()=>{
  const f=fixture(),form=f.snapshot.formations[0]!,actor=form.ownerPlayerId,start={x:form.position.xMilli/1000,y:form.position.yMilli/1000};
  const direction=start.x+200<=f.archive.payload.bounds.width?1:-1;
  const out=applyLoop(f.state,f.snapshot,f.archive,actor,{schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'replace_orders',orders:[{orderId:'old',type:'move',stackId:form.formationId,destination:{x:start.x+direction*200,y:start.y}}]},1001);const closed=ready(out.state,f.snapshot,f.archive),r=resolveLoop(f.snapshot,freezeLoop(closed,f.snapshot,f.archive),f.archive),next=openLoopNext(closed,3000);
  expect(r.nextState.formations.find(x=>x.formationId===form.formationId)!.position.xMilli).toBe((start.x+direction*200)*1000);expect(r.nextState.units).toEqual(f.snapshot.units);expect(next.drafts.every(d=>!d.orders.length)).toBe(true);
  expect(previewLoop(r.nextState,f.archive,actor,[{orderId:'new',type:'move',stackId:form.formationId,destination:{x:start.x,y:start.y}}])[0]!.remaining).toBe(50);
  expect(()=>applyLoop(next,r.nextState,f.archive,actor,{schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true},3001)).toThrow('WRONG_TURN');
 });
 it('uses full next window after overdue observation and fails closed on rollback/unsafe clocks',()=>{
  const f=fixture(),closed=observeDeadline(f.state,100000);expect(closed.turn).toMatchObject({status:'closed',closeReason:'deadline',closedAtMs:f.state.turn.deadlineAtMs});
  expect(openLoopNext(closed,100001).turn).toMatchObject({openedAtMs:100001,deadlineAtMs:100001+f.config.turnDurationMs});expect(()=>openLoopNext(closed,99999)).toThrow();expect(()=>openLoopNext(closed,Number.MAX_SAFE_INTEGER)).toThrow();
 });
 it('retains explicit Unready/readiness locks and stale revisions at the exact deadline',()=>{
  const f=fixture(),actor=f.players[0]!.playerId;
  let s=applyLoop(f.state,f.snapshot,f.archive,actor,{schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true},1001).state;
  expect(applyLoop(s,f.snapshot,f.archive,actor,{schemaVersion:1,turnNumber:1,expectedRevision:1,kind:'replace_orders',orders:[]},1002).error).toBe('READY_LOCKED');
  s=applyLoop(s,f.snapshot,f.archive,actor,{schemaVersion:1,turnNumber:1,expectedRevision:1,kind:'set_ready',ready:false},1002).state;
  expect(s.drafts[0]!.ready).toBe(false);expect(applyLoop(s,f.snapshot,f.archive,actor,{schemaVersion:1,turnNumber:1,expectedRevision:1,kind:'set_ready',ready:true},1003).error).toBe('STALE_REVISION');
  expect(applyLoop(s,f.snapshot,f.archive,actor,{schemaVersion:1,turnNumber:1,expectedRevision:2,kind:'set_ready',ready:true},s.turn.deadlineAtMs).state.turn.status).toBe('closed');
 });
 it('rejects destroyed/foreign formations and leaderless movement while retaining empty participation',()=>{
  const f=fixture(),s=signed({...f.snapshot,stateVersion:1,completedTurnNumber:1,predecessorResolutionId:'synthetic',units:[],formations:[]});
  expect(previewLoop(s,f.archive,f.players[0]!.playerId,[])).toEqual([]);expect(()=>previewLoop(s,f.archive,f.players[0]!.playerId,[{orderId:'bad',type:'move',stackId:f.snapshot.formations[0]!.formationId,destination:{x:0,y:0}}])).toThrow();
  const closed=ready({...f.state,turn:{...f.state.turn,turnNumber:2}},s,f.archive);expect(resolveLoop(s,freezeLoop(closed,s,f.archive),f.archive).nextState.units).toEqual([]);
  const lonely=structuredClone(f.snapshot),troop=lonely.units.find(u=>u.kind==='INFANTRY')!,form=lonely.formations.find(x=>x.ownerPlayerId===troop.ownerPlayerId)!;
  Object.assign(lonely,{stateVersion:1,completedTurnNumber:1,predecessorResolutionId:'synthetic',units:[troop],formations:[{...form,unitIds:[troop.unitId]}]});const one=signed(lonely);
  expect(()=>previewLoop(one,f.archive,troop.ownerPlayerId,[{orderId:'source',type:'move',stackId:form.formationId,destination:{x:form.position.xMilli/1000,y:form.position.yMilli/1000}}])).toThrow('INVALID_DRAFT');expect(one.units[0]!.originalSpawnNodeId).toBe(troop.originalSpawnNodeId);
 });
 it('repeated synthetic battles preserve casualties/capture/policies throughTurn4 without resurrection',()=>{
  const f=fixture(3),archive=structuredClone(f.archive),base=structuredClone(f.snapshot),forms=base.formations;
  // Synthetic non-genesis state: intact attacker versus two previously depleted enemies.
  const units=base.units.filter(u=>u.ownerPlayerId===forms[0]!.ownerPlayerId||u.kind==='INFANTRY'&&u.unitId===forms.find(x=>x.ownerPlayerId===u.ownerPlayerId)!.unitIds.find(id=>base.units.find(z=>z.unitId===id)!.kind==='INFANTRY'));
  const positions=[{xMilli:0,yMilli:100000},{xMilli:100000,yMilli:100000},{xMilli:300000,yMilli:100000}];
  let snapshot=signed({...base,stateVersion:1,completedTurnNumber:1,predecessorResolutionId:'synthetic',units,formations:forms.map((x,i)=>({...x,position:positions[i]!,unitIds:x.unitIds.filter(id=>units.some(u=>u.unitId===id))}))});
  Object.assign(archive.payload.startingState.cities[0]!,{position:{x:100,y:100}});const captured=archive.payload.startingState.cities[0]!;Object.assign(captured,{ownerPlayerId:forms[1]!.ownerPlayerId});snapshot=signed({...snapshot,cityOwners:snapshot.cityOwners.map(c=>c.cityId===captured.cityId?{...c,ownerPlayerId:captured.ownerPlayerId}:c)});
  let state={...initialLoopTurn(snapshot,1000),turn:{...f.state.turn,turnNumber:2}};const dead=new Set<string>();let battles=0;
  for(const [n,x]of [[2,100],[3,300]] as const){const form=snapshot.formations.find(f=>f.ownerPlayerId===forms[0]!.ownerPlayerId)!;
   state=applyLoop(state,snapshot,archive,form.ownerPlayerId,{schemaVersion:1,turnNumber:n,expectedRevision:0,kind:'replace_orders',orders:[{orderId:`move-${n}`,type:'move',stackId:form.formationId,destination:{x,y:100}}]},state.turn.openedAtMs+1).state;
   const closed=ready(state,snapshot,archive),frozen=freezeLoop(closed,snapshot,archive);if(n===2){const before=structuredClone(snapshot);expect(()=>resolveLoop(snapshot,frozen,archive,{maxRounds:1,maxActions:1})).toThrow('COMBAT_WORK_LIMIT');expect(snapshot).toEqual(before)}const r=resolveLoop(snapshot,frozen,archive);battles+=r.battles.length;
   for(const u of snapshot.units)if(!r.nextState.units.some(v=>v.unitId===u.unitId))dead.add(u.unitId);
   expect(r.nextState.units.every(u=>!dead.has(u.unitId))).toBe(true);expect(r.nextState.combatPolicy).toEqual(snapshot.combatPolicy);expect(r.nextState.units.every(u=>u.hp===u.maxHp)).toBe(true);
   expect(r.nextState.cityOwners.find(c=>c.cityId===captured.cityId)!.ownerPlayerId).toBe(forms[0]!.ownerPlayerId);snapshot=r.nextState;state=openLoopNext(closed,state.turn.deadlineAtMs+1);
  }
  expect(battles).toBe(2);expect(state.turn.turnNumber).toBe(4);expect(dead.size).toBeGreaterThan(0);expect(validateLoopState(snapshot,archive)).toEqual(snapshot);
 });
 it('rejects changed hashes and deterministic work exhaustion without mutating inputs',()=>{const f=fixture(),s=structuredClone(f.snapshot);Object.assign(s,{units:s.units.slice(1)});expect(()=>validateLoopState(s,f.archive)).toThrow();const closed=ready(f.state,f.snapshot,f.archive),frozen=freezeLoop(closed,f.snapshot,f.archive);expect(resolveLoop(f.snapshot,frozen,f.archive)).toEqual(resolveLoop(f.snapshot,frozen,f.archive))});
});
