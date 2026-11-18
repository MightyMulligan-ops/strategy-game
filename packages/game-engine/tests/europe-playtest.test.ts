import {describe,it,expect} from 'vitest';
import {armyFixture} from './initial-armies-fixture.js';
import {EUROPE_RUNTIME,InitialWorldArchiveSchema,LoopStateSchema,EuropeStateSchema} from '@strategy-game/shared-types/server';
import {EUROPE_SCENARIO_VIEW} from '@strategy-game/shared-types';
import {planLoop,initialLoopTurn,applyLoop,freezeLoop,resolveLoop,openLoopNext,previewLoop} from '../src/combat-loop.js';
import {europeLandPoint,europeLandSegment} from '../src/europe-playtest.js';
import {auditHash} from '../src/determinism.js';
function fixture(){const f=armyFixture(2,1),archive=InitialWorldArchiveSchema.parse(f.archive),snapshot=planLoop(f.config,f.players,archive,EUROPE_RUNTIME).snapshot;return {...f,archive,snapshot,state:initialLoopTurn(snapshot,1000)}}
const {originX,originY,maskPerGame,width,height,...profile}=EUROPE_SCENARIO_VIEW;void originX;void originY;void maskPerGame;void width;void height;
const command=(n:number,revision:number)=>({schemaVersion:2 as const,profile,turnNumber:n,expectedRevision:revision});
function ready(f:ReturnType<typeof fixture>){let state=f.state;for(const d of state.drafts){const out=applyLoop(state,f.snapshot,f.archive,d.playerId,{...command(state.turn.turnNumber,d.revision),kind:'set_ready',ready:true},state.turn.openedAtMs+1);if(out.error)throw Error(out.error);state=out.state}return state}
describe('Europe-only authoritative repeating integration',()=>{
 it('validates exact immutable two-camp starts and explicit relationships',()=>{
  const f=fixture();expect(f.snapshot.kind).toBe('europe_loop_state');expect(f.snapshot.combatPolicy.setup.relationshipPolicy.mode).toBe('explicit-v1');
  expect(f.snapshot.formations.map(f=>({x:f.position.xMilli/1000,y:f.position.yMilli/1000})).every(europeLandPoint)).toBe(true);
  expect(LoopStateSchema.safeParse(f.snapshot).success).toBe(false);
 });
 it('repeats1→2→3→4 without respawns, order copies or Ready carryover',()=>{
  let f=fixture();const initial=f.snapshot.units;
  for(let n=1;n<=3;n++){const closed=ready(f),frozen=freezeLoop(closed,f.snapshot,f.archive),r=resolveLoop(f.snapshot,frozen,f.archive);expect(resolveLoop(f.snapshot,structuredClone(frozen),f.archive)).toEqual(r);expect(r.nextState.units).toEqual(initial);f={...f,snapshot:r.nextState,state:openLoopNext(closed,closed.turn.deadlineAtMs+1)};expect(f.state.drafts.every(d=>!d.ready&&d.revision===0&&!d.orders.length)).toBe(true)}expect(f.state.turn.turnNumber).toBe(4);
 });
 it('rejects old-profile commands before any queue or readiness change',()=>{
  const f=fixture(),actor=f.players[0]!.playerId,out=applyLoop(f.state,f.snapshot,f.archive,actor,{schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true},1001);expect(out.error).toBe('INVALID_DRAFT');expect(out.state.drafts).toEqual(f.state.drafts);
 });
 it('rejects a water path at acceptance and frozen execution without partial outcome',()=>{
  const f=fixture(),form=f.snapshot.formations[0]!,actor=form.ownerPlayerId;
  let water:{x:number;y:number}|undefined;for(let x=0;x<=1000&&!water;x+=10)for(let y=0;y<=500;y+=10)if(!europeLandPoint({x,y})){water={x,y};break}
  expect(water).toBeDefined();const orders=[{orderId:'water',type:'move' as const,stackId:form.formationId,destination:water!}];
  expect(()=>previewLoop(f.snapshot,f.archive,actor,orders)).toThrow('INVALID_DRAFT');
  const closed=ready(f),frozen=freezeLoop(closed,f.snapshot,f.archive),forged={...frozen,players:frozen.players.map(d=>d.playerId===actor?{...d,orders}:d)};expect(()=>resolveLoop(f.snapshot,forged,f.archive)).toThrow();
 });
 it('resolves land interception/casualties and carries survivors forward',()=>{
  let f=fixture(),battles=0;const dead=new Set<string>();
  const attackerId=f.snapshot.formations[0]!.formationId,target=f.snapshot.formations[1]!.position;
  for(let n=1;n<=4&&battles===0;n++){
   const form=f.snapshot.formations.find(x=>x.formationId===attackerId)!,from={x:form.position.xMilli/1000,y:form.position.yMilli/1000},to={x:target.xMilli/1000,y:target.yMilli/1000},d=Math.hypot(to.x-from.x,to.y-from.y),t=Math.min(240,d)/d,destination={x:Math.round(from.x+(to.x-from.x)*t),y:Math.round(from.y+(to.y-from.y)*t)};
   expect(europeLandSegment(from,destination)).toBe(true);
   const out=applyLoop(f.state,f.snapshot,f.archive,form.ownerPlayerId,{...command(n,0),kind:'replace_orders',orders:[{orderId:`land-${n}`,type:'move',stackId:form.formationId,destination}]},f.state.turn.openedAtMs+1);expect(out.error).toBeUndefined();f={...f,state:out.state};
   const closed=ready(f),r=resolveLoop(f.snapshot,freezeLoop(closed,f.snapshot,f.archive),f.archive);battles+=r.battles.length;
   for(const u of f.snapshot.units)if(!r.nextState.units.some(v=>v.unitId===u.unitId))dead.add(u.unitId);
   expect(r.nextState.formations.every(f=>europeLandPoint({x:f.position.xMilli/1000,y:f.position.yMilli/1000}))).toBe(true);
   f={...f,snapshot:r.nextState,state:openLoopNext(closed,closed.turn.deadlineAtMs+1)};
  }expect(battles).toBe(1);expect(dead.size).toBeGreaterThan(0);expect(f.snapshot.units.every(u=>!dead.has(u.unitId))).toBe(true);
 });
 it('retains permanent provenance in a synthetic depleted land capture',()=>{
  const f=fixture(),[a,b]=f.snapshot.formations,target=f.archive.payload.startingState.cities.find(c=>c.ownerPlayerId===b!.ownerPlayerId)!.position;
  const units=f.snapshot.units.filter(u=>u.ownerPlayerId===a!.ownerPlayerId||u.kind==='INFANTRY'&&u.unitId===b!.unitIds[0]);
  const {snapshotId,...base}=f.snapshot;void snapshotId;const meta={...base,stateVersion:1,completedTurnNumber:1,predecessorResolutionId:'synthetic',units,formations:f.snapshot.formations.map(form=>({...form,position:{xMilli:(target.x+(form===a?-100:0))*1000,yMilli:target.y*1000},unitIds:form.unitIds.filter(id=>units.some(u=>u.unitId===id))}))};
  const snapshot=EuropeStateSchema.parse({...meta,snapshotId:`loop-state:${auditHash(meta)}`}),state={...initialLoopTurn(snapshot,1000),turn:{...f.state.turn,turnNumber:2}};
  const out=applyLoop(state,snapshot,f.archive,a!.ownerPlayerId,{...command(2,0),kind:'replace_orders',orders:[{orderId:'capture',type:'move',stackId:a!.formationId,destination:target}]},1001);
  const synthetic={...f,snapshot,state:out.state},closed=ready(synthetic),r=resolveLoop(snapshot,freezeLoop(closed,snapshot,f.archive),f.archive);
  expect(r.battles).toHaveLength(1);expect(r.nextState.cityOwners.find(c=>c.cityId===f.archive.payload.startingState.cities.find(c=>c.ownerPlayerId===b!.ownerPlayerId)!.cityId)!.ownerPlayerId).toBe(a!.ownerPlayerId);
  expect(r.nextState.units.every(u=>units.some(old=>old.unitId===u.unitId&&old.originalSpawnNodeId===u.originalSpawnNodeId))).toBe(true);
 });
});

import {adjacentCombatPosition} from '../src/combat-placement.js';
it('keeps new-profile survivor placement on eligible ground and aborts exhausted placement',()=>{
 const p=adjacentCombatPosition({x:10,y:10},{width:40,height:40},[],100000,p=>p.x===35);
 expect(p.x).toBe(35);expect((p.x-10)**2+(p.y-10)**2).toBeGreaterThan(400);
 expect(()=>adjacentCombatPosition({x:10,y:10},{width:40,height:40},[],100000,()=>false)).toThrow('COMBAT_PLACEMENT_UNAVAILABLE');
});
it('retains sub-mask contact precision and blocks narrow fractional coast crossings',()=>{
 const surface=prepareSurfaceNavigation({schemaVersion:1,maskId:'fractional-test',bounds:{width:100,height:100},land:[{outer:[{x:1,y:1},{x:99,y:1},{x:99,y:99},{x:1,y:99}]}],inlandWater:[{outer:[{x:50,y:2},{x:51,y:2},{x:51,y:98},{x:50,y:98}]}]});
 expect(surface.classifyContinuousPoint({x:49.9,y:40.1})).toBe('LAND');
 expect(surface.classifyContinuousPoint({x:50,y:40.1})).toBe('BOUNDARY');
 expect(surface.validateContinuousLandSegment({x:49.9,y:40.1},{x:51.1,y:40.1})).toBe(false);
 expect(surface.validateContinuousLandSegment({x:51.1,y:40.1},{x:49.9,y:40.1})).toBe(false);
});
import {prepareSurfaceNavigation} from '../src/surface-navigation.js';
