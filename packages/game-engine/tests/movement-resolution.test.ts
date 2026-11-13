import {describe,it,expect,vi} from "vitest";
import {armyFixture} from "./initial-armies-fixture.js";
import {createTurn,planMovementResolution,freezeMovementInput,resolveMovement,sweptContact,strictStoppingPoint,compareContact,squaredMilliDistance,observeClosureDeadline} from "../src/index.js";
import {executeValidatedMovement} from "../src/movement-resolution.js";
import {InitialWorldArchiveSchema,MovementInitialSnapshotSchema,MovementFrozenInputSchema} from "@strategy-game/shared-types/server";
import {canonicalJson} from "../src/determinism.js";
const p=(x:number,y=100)=>({xMilli:x*1000,yMilli:y*1000});
function fixture(count=2){
 const f=armyFixture(count),archive=InitialWorldArchiveSchema.parse(f.archive),plan=planMovementResolution(f.config,f.players,archive);
 const state=observeClosureDeadline(createTurn(f.config,f.players,1000),2000),frozen=freezeMovementInput(state,plan.snapshot,archive);
 return {...f,archive,plan,frozen};
}
function geometry(positions:[number,number][],orders:Record<number,[number,number][]>,sameOwner?:[number,number]){
 const f=fixture(positions.length),snapshot=structuredClone(f.plan.snapshot);
 snapshot.formations.forEach((s,i)=>{Object.assign(s,{position:{x:positions[i]![0],y:positions[i]![1]}})});
 if(sameOwner)Object.assign(snapshot.formations[sameOwner[1]]!,{ownerPlayerId:snapshot.formations[sameOwner[0]]!.ownerPlayerId});
 const players=f.frozen.players.map((player,i)=>({...player,orders:(orders[i]??[]).map(([x,y],n)=>({orderId:`o${i}-${n}`,type:"move" as const,stackId:snapshot.formations[i]!.formationId,destination:{x,y}}))}));
 return {f,snapshot,frozen:{...f.frozen,players},run:()=>executeValidatedMovement(snapshot,{...f.frozen,players})};
}
describe("exact swept-circle-lattice-v1 geometry",()=>{
 it("stops strictly before exact axial contact and charges from stored position",()=>{
  const c=sweptContact(p(0),p(100),p(100))!;expect(c.parameter).toBe(.8);
  expect(strictStoppingPoint(p(0),p(100),c,[p(100)])).toEqual(p(79.999));
 });
 it.each([[150,150,100,110],[200,160,150,130],[250,100,200,90]])("keeps a %i/%i diagonal on-path and outside contact",(x,y,tx,ty)=>{
  const from=p(0,0),to=p(x,y),target=p(tx,ty),c=sweptContact(from,to,target)!;expect(c).not.toBeNull();
  const stop=strictStoppingPoint(from,to,c,[target]);
  expect(BigInt(stop.xMilli)*BigInt(to.yMilli)).toBe(BigInt(stop.yMilli)*BigInt(to.xMilli));expect(squaredMilliDistance(stop,target)>400000000n).toBe(true);
 });
 it("detects exact tangency at the segment midpoint and backs up even without penetration",()=>{
  const c=sweptContact(p(0,0),p(100,0),p(50,20))!;expect(c.parameter).toBe(.5);
  expect(strictStoppingPoint(p(0,0),p(100,0),c,[p(50,20)])).toEqual(p(49.999,0));
 });
 it.each([0,19.999,20])("preserves initial touching/overlap distance %s without teleport",(distance)=>{
  const c=sweptContact(p(0),p(100),p(distance))!;expect(c.parameter).toBe(0);expect(strictStoppingPoint(p(0),p(100),c,[p(distance)])).toEqual(p(0));
 });
 it("handles zero-length paths and empty swept space",()=>{
  expect(sweptContact(p(0),p(0),p(100))).toBeNull();expect(sweptContact(p(0),p(100),p(50,121))).toBeNull();
 });
 it("compares simultaneous irrational roots exactly without a collision epsilon",()=>{
  const a=sweptContact(p(0),p(100),p(80,110))!,b=sweptContact(p(0),p(100),p(80,90))!,near=sweptContact(p(0),p(100),p(60,110))!;
  expect(compareContact(a,b)).toBe(0);expect(compareContact(near,a)).toBe(-1);expect(compareContact(a,near)).toBe(1);
 });
 it("finds the last exact lattice point on a coprime diagonal",()=>{
  const from=p(0,0),to=p(100,101),target=p(90,90),c=sweptContact(from,to,target)!;
  const stop=strictStoppingPoint(from,to,c,[target]);expect(stop.xMilli%100).toBe(0);expect(stop.yMilli%101).toBe(0);
  expect(squaredMilliDistance(stop,target)>400000000n).toBe(true);
 });
});
describe("hostile contact graph and authoritative audits",()=>{
 it("includes every simultaneous first-contact defender in one canonical encounter",()=>{
  const g=geometry([[0,100],[80,110],[80,90],[500,400]],{0:[[100,100],[110,100]]}),r=g.run();
  expect(r.encounters).toHaveLength(1);expect(r.encounters[0]!.members).toHaveLength(3);expect(r.encounters[0]!.contacts.filter(c=>c.kind==="swept_contact")).toHaveLength(2);expect(r.encounters[0]!.contacts.filter(c=>c.kind==="initial_contact")).toHaveLength(1);
  expect(r.audits.map(a=>a.outcome)).toEqual(["blocked_encounter","not_executed_after_encounter"]);
  expect(r.audits[1]!.traveled).toBe(0);expect(r.audits[0]!.remaining).toBe(250-r.audits[0]!.traveled);
 });
 it("detects starting contacts with empty queues and blocks every later order",()=>{
  const g=geometry([[100,100],[110,100],[500,400]],{0:[[200,100]],1:[[210,100]]}),r=g.run();
  expect(r.encounters).toHaveLength(1);expect(r.encounters[0]!.contacts[0]!.kind).toBe("initial_contact");
  expect(r.audits.every(a=>a.outcome==="not_executed_after_encounter")).toBe(true);
  expect(r.nextState.formations[0]!.position).toEqual(p(100));expect(r.nextState.formations[1]!.position).toEqual(p(110));
  expect(geometry([[100,100],[100,100]],{}).run().encounters).toHaveLength(1);
 });
 it("keeps distant engagements separate and unrelated movement active",()=>{
  const g=geometry([[100,100],[110,100],[500,300],[510,300],[800,400]],{4:[[850,400]]}),r=g.run();
  expect(r.encounters).toHaveLength(2);expect(r.audits[0]!.outcome).toBe("executed");expect(r.nextState.formations[4]!.position).toEqual(p(850,400));
 });
 it("does not create a hostile edge or merge from same-owner overlap",()=>{
  const g=geometry([[100,100],[100,100],[800,400]],{0:[[150,100]]},[0,1]),r=g.run();
  expect(r.encounters).toEqual([]);expect(r.audits[0]!.outcome).toBe("executed");expect(r.nextState.formations).toHaveLength(3);
 });
 it("joins a later qualifying arrival to an existing component",()=>{
  const g=geometry([[100,100],[110,100],[250,100]],{2:[[100,100]]}),r=g.run();
  expect(r.encounters).toHaveLength(1);expect(r.encounters[0]!.members).toHaveLength(3);
 });
 it("combines two components only through actual simultaneous hostile links",()=>{
  const g=geometry([[100,100],[100,105],[140,100],[140,105],[120,0]],{4:[[120,100]]}),r=g.run();
  expect(r.encounters).toHaveLength(1);expect(r.encounters[0]!.members).toHaveLength(5);
 });
 it("is invariant to formation enumeration and never mutates inputs",()=>{
  const g=geometry([[0,100],[80,110],[80,90],[500,400]],{0:[[100,100]]}),before=canonicalJson(g.snapshot),a=g.run();
  const shuffled={...g.snapshot,formations:[...g.snapshot.formations].reverse()};
  // Result state uses canonical initial roster/formation ordering.
  const b=executeValidatedMovement(shuffled,g.frozen);
  expect(a).toEqual(b);expect(canonicalJson(g.snapshot)).toBe(before);
 });
});
describe("strict replay and production input validation",()=>{
 it.each([2,4,10,40])("replays %i-player empty frozen queues with immutable identities",(count)=>{
  const f=fixture(count),r=resolveMovement(f.plan.snapshot,f.frozen,f.archive);
  expect(r.nextState.stateVersion).toBe(1);expect(r.nextState.completedTurnNumber).toBe(1);expect(r.audits).toEqual([]);expect(r.encounters).toEqual([]);
  expect(r.nextState.units).toEqual(f.plan.snapshot.units);expect(r.nextState.formations.map(s=>s.unitIds)).toEqual(f.plan.snapshot.formations.map(s=>s.unitIds));
  expect(canonicalJson(resolveMovement(f.plan.snapshot,f.frozen,f.archive))).toBe(canonicalJson(r));
 },30_000);
 it.each([0,250,251])("validates frozen budget %i without repairing authoritative input",(distance)=>{
  const f=fixture(),formation=f.plan.snapshot.formations[0]!,direction=formation.position.x<500?1:-1;
  const frozen={...f.frozen,players:f.frozen.players.map((p,i)=>({...p,orders:i?[]:[{type:"move",orderId:"one",stackId:formation.formationId,destination:{x:formation.position.x+direction*distance,y:formation.position.y}}]}))};
  if(distance<=250){const r=resolveMovement(f.plan.snapshot,frozen,f.archive);expect(r.audits[0]!.outcome).toBe("executed");expect(r.audits[0]!.traveled).toBe(distance)}
  else expect(()=>resolveMovement(f.plan.snapshot,frozen,f.archive)).toThrow();
 });
 it("rejects mismatched seed, runtime, archive, roster, snapshot and unsupported composition",()=>{
  const f=fixture();expect(MovementFrozenInputSchema.safeParse({...f.frozen,resolutionSeed:f.frozen.worldSeed+1}).success).toBe(false);
  expect(()=>resolveMovement({...f.plan.snapshot,units:[]},f.frozen,f.archive)).toThrow();
  expect(()=>resolveMovement(f.plan.snapshot,{...f.frozen,startingSnapshotId:'forged'},f.archive)).toThrow();
  expect(()=>resolveMovement(f.plan.snapshot,{...f.frozen,players:[...f.frozen.players].reverse()},f.archive)).toThrow();
  expect(MovementInitialSnapshotSchema.safeParse({...f.plan.snapshot,schemaVersion:5}).success).toBe(false);
 });
 it("reads neither ambient clock/randomness nor display settings",()=>{
  const f=fixture(),a=resolveMovement(f.plan.snapshot,f.frozen,f.archive),clock=vi.spyOn(Date,"now").mockImplementation(()=>{throw Error("clock")}),random=vi.spyOn(Math,"random").mockImplementation(()=>{throw Error("random")});
  try{expect(resolveMovement(f.plan.snapshot,f.frozen,f.archive)).toEqual(a)}finally{clock.mockRestore();random.mockRestore()}
 });
 it("reuses seeded equal-number precedence and completes every Move 1 before Move 2",()=>{
  const g=geometry([[0,100],[100,100]],{0:[[50,100],[60,100]],1:[[50,100],[40,100]]});
  const firsts=new Set<string>();
  for(let seed=0;seed<16;seed++){
   const r=executeValidatedMovement(g.snapshot,{...g.frozen,worldSeed:seed,resolutionSeed:seed});
   firsts.add(r.audits[0]!.playerId);expect(r.audits.map(a=>a.moveNumber)).toEqual([1,1,2,2]);
   expect(r.audits.filter(a=>a.outcome==="executed")).toHaveLength(1);expect(r.encounters).toHaveLength(1);
  }
  expect(firsts.size).toBe(2);
 });

});
