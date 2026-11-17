import {describe,it,expect} from "vitest";
import {armyFixture} from "./initial-armies-fixture.js";
import {createTurn,observeClosureDeadline} from "../src/index.js";
import {planCombatTurn,freezeCombatInput,resolveCombatTurn,executeValidatedCombatTurn} from "../src/combat-turn.js";
import {contactTime} from "../src/combat-chronology.js";
import {adjacentCombatPosition} from "../src/combat-placement.js";
import {InitialWorldArchiveSchema,FIRST_COMBAT_SETUP} from "@strategy-game/shared-types/server";
function fixture(count=2){const f=armyFixture(count),archive=InitialWorldArchiveSchema.parse(f.archive),plan=planCombatTurn(f.config,f.players,archive);
 const state=observeClosureDeadline(createTurn(f.config,f.players,1000),2000),frozen=freezeCombatInput(state,plan.snapshot,archive);
 return {...f,archive,plan,frozen};}
function geometry(positions:[number,number][],orders:Record<number,[number,number][]>,allies:number[][]=[]){
 const f=fixture(positions.length),snapshot=structuredClone(f.plan.snapshot);
 snapshot.formations.forEach((form,i)=>Object.assign(form,{position:{x:positions[i]![0],y:positions[i]![1]}}));
 const relations=snapshot.combatPolicy.relationships.map(r=>({...r,relation:allies.some(g=>g.map(i=>snapshot.players[i]!.playerId).includes(r.from)&&g.map(i=>snapshot.players[i]!.playerId).includes(r.to))?"ally" as const:"hostile" as const}));
 const setup={...snapshot.combatPolicy.setup,relationshipPolicy:{mode:"explicit-v1" as const,relationships:relations}};
 Object.assign(snapshot,{combatPolicy:{...snapshot.combatPolicy,setup,relationships:relations}});
 const frozen={...f.frozen,combatPolicy:snapshot.combatPolicy,players:f.frozen.players.map((p,i)=>({...p,orders:(orders[i]??[]).map(([x,y],n)=>({type:"move" as const,orderId:`order:${i}:${n}`,stackId:snapshot.formations[i]!.formationId,destination:{x,y}}))}))};
 return {...f,snapshot,frozen,run:()=>executeValidatedCombatTurn(snapshot,frozen,f.archive)};
}
describe("Stage B versioned integration and chronological contact",()=>{
 it.each([2,4,40])("freezes and resolves %i-player no-contact Turn1 without changing historical state",count=>{
  const f=fixture(count),before=structuredClone(f);const result=resolveCombatTurn(f.plan.snapshot,f.frozen,f.archive);
  expect(result.nextState.schemaVersion).toBe(9);expect(result.nextState.completedTurnNumber).toBe(1);expect(result.battles).toEqual([]);
  expect(result.nextState.units).toEqual(f.plan.snapshot.units);expect(f).toEqual(before);
  expect(result.nextState.cityOwners).toHaveLength(count);expect(f.frozen.combatPolicy.relationships).toHaveLength(count*(count-1));
 });
 it("rejects missing/asymmetric/non-transitive explicit relationships rather than defaulting hostility",()=>{
  const f=fixture(3),relations=f.plan.snapshot.combatPolicy.relationships;
  for(const input of [relations.slice(1),relations.map((r,i)=>i===0?{...r,relation:"ally"}:r),relations.map(r=>({...r,relation:r.from===f.players[1]!.playerId||r.to===f.players[1]!.playerId?"ally":"hostile"}))]){
   expect(()=>planCombatTurn(f.config,f.players,f.archive,undefined,{...FIRST_COMBAT_SETUP,relationshipPolicy:{mode:"explicit-v1",relationships:input}})).toThrow();
  }
 });
 it("pins policies/seed/snapshot and rejects tampering or out-of-range paths",()=>{
  const f=fixture();expect(()=>resolveCombatTurn(f.plan.snapshot,{...f.frozen,resolutionSeed:1},f.archive)).toThrow();
  const bad=structuredClone(f.plan.snapshot);Object.assign(bad.units[0]!,{attack:500});expect(()=>resolveCombatTurn(bad,f.frozen,f.archive)).toThrow();
  const badOrders=f.frozen.players.map((p,i)=>({...p,orders:i?[]:[{type:"move",orderId:"far",stackId:f.plan.snapshot.formations[0]!.formationId,destination:{x:4900,y:4200}}]}));
  expect(()=>resolveCombatTurn(f.plan.snapshot,{...f.frozen,players:badOrders},f.archive)).toThrow();
 });
 it("finds relative moving interception and exact axial contact without player precedence",()=>{
  expect(contactTime({x:0,y:0},{x:1,y:0},{x:100,y:0},{x:-1,y:0},100)).toBe(40);
  const g=geometry([[0,100],[100,100]],{0:[[100,100]],1:[[0,100]]}),r=g.run();
  expect(r.battles).toHaveLength(1);expect(r.battles[0]!.formations.every(f=>f.stance==="moving")).toBe(true);
  expect(r.audits.map(a=>a.traveled)).toEqual([40,40]);
  expect(r.battles[0]!.position).toEqual({xMilli:50000,yMilli:100000});
 });
 it("intercepts the first reachable hostile and never resumes or joins a later battle",()=>{
  const g=geometry([[0,100],[80,100],[180,100],[190,100]],{0:[[200,100],[220,100]]});const r=g.run();
  expect(r.battles).toHaveLength(2);const id=g.snapshot.formations[0]!.formationId;
  expect(r.battles.filter(b=>b.formations.some(f=>f.formationId===id))).toHaveLength(1);
  expect(r.audits.filter(a=>a.formationId===id).map(a=>a.outcome)).toEqual(["blocked_encounter","not_executed_after_encounter"]);
 });
 it("does not collide with a moving enemy's already vacated path",()=>{
  const g=geometry([[0,100],[100,100]],{0:[[100,100]],1:[[200,100]]});
  expect(g.run().battles).toEqual([]);
 });
 it("gathers allied reinforcements that reach the encounter, not a later blocked route",()=>{
  const g=geometry([[0,100],[100,100],[200,100]],{0:[[100,100]],2:[[100,100]]},[[0,2]]);
  expect(g.run().battles).toHaveLength(1);expect(g.run().battles[0]!.formations).toHaveLength(3);
  const blocked=geometry([[0,100],[100,100],[300,100],[310,100]],{0:[[100,100]],2:[[100,100]]},[[0,2]]).run();
  expect(blocked.battles).toHaveLength(2);expect(blocked.battles.every(b=>b.formations.length===2)).toBe(true);
 });
 it("keeps three hostile movers separate in one complete fight with private audit",()=>{
  const g=geometry([[0,100],[100,100],[50,0]],{0:[[50,100]],1:[[50,100]],2:[[50,100]]});
  const r=g.run();expect(r.battles).toHaveLength(1);expect(r.battles[0]!.formations).toHaveLength(3);
  const audit=JSON.parse(r.battles[0]!.auditJson);expect(audit.input.formations.every((f:{stance:string})=>f.stance==="moving")).toBe(true);
  expect(audit.rounds[0].pairRoles).toHaveLength(3);expect(audit.units).toHaveLength(18);
 });
 it("groups same-player formations without merging IDs or provenance",()=>{
  const g=geometry([[0,100],[100,100],[200,100]],{0:[[100,100]],2:[[100,100]]});
  const owner=g.snapshot.formations[0]!.ownerPlayerId,previous=g.snapshot.formations[2]!.ownerPlayerId;
  Object.assign(g.snapshot.formations[2]!,{ownerPlayerId:owner});g.snapshot.units.filter(u=>u.ownerPlayerId===previous).forEach(u=>Object.assign(u,{ownerPlayerId:owner}));
  const players=g.frozen.players.map(p=>p.playerId===owner?{...p,orders:[...p.orders,...g.frozen.players.find(p=>p.playerId===previous)!.orders]}:p.playerId===previous?{...p,orders:[]}:p);
  const r=executeValidatedCombatTurn(g.snapshot,{...g.frozen,players},g.archive);expect(r.battles[0]!.formations).toHaveLength(3);
  expect(JSON.parse(r.battles[0]!.auditJson).input.formations.filter((f:{ownerPlayerId:string})=>f.ownerPlayerId===owner)).toHaveLength(2);
  for(const u of r.nextState.units)expect(u.originalSpawnNodeId).toBe(g.snapshot.units.find(x=>x.unitId===u.unitId)!.originalSpawnNodeId);
 });
 it("keeps a stationary defender on DEF and completes hostile attackers' battle after it dies",()=>{
  const g=geometry([[0,100],[100,100],[200,100]],{0:[[100,100]],2:[[100,100]]});
  const defender=g.snapshot.formations[1]!;
  g.snapshot.units.filter(u=>u.ownerPlayerId===defender.ownerPlayerId).forEach(u=>Object.assign(u,{hp:1,maxHp:1,attack:1,defense:1}));
  const r=g.run(),audit=JSON.parse(r.battles[0]!.auditJson);
  expect(audit.rounds.flatMap((r:{actions:{sourcePlayerId:string;role:string}[]})=>r.actions).filter((a:{sourcePlayerId:string})=>a.sourcePlayerId===defender.ownerPlayerId).every((a:{role:string})=>a.role==="DEF")).toBe(true);
  const round=audit.rounds.findIndex((r:{number:number;casualties:string[]})=>defender.unitIds.every(id=>audit.rounds.slice(0,r.number).some((q:{casualties:string[]})=>q.casualties.includes(id))));
  expect(audit.rounds.length).toBeGreaterThan(round+1);
 });
 it("captures a city, preserves archive and places allied survivors nearest valid adjacent",()=>{
  const g=geometry([[0,100],[100,100],[200,100]],{0:[[100,100]],2:[[100,100]]},[[0,2]]);
  const archive=structuredClone(g.archive),city=archive.payload.startingState.cities[0]!;Object.assign(city,{position:{x:100,y:100},ownerPlayerId:g.snapshot.formations[1]!.ownerPlayerId});
  const r=executeValidatedCombatTurn(g.snapshot,g.frozen,archive),b=r.battles[0]!;expect(b.locationId).toBe(city.cityId);expect(b.recipientPlayerId).not.toBeNull();
  expect(r.nextState.cityOwners.find(c=>c.cityId===city.cityId)!.ownerPlayerId).toBe(b.recipientPlayerId);
  for(const f of r.nextState.formations){const p={x:f.position.xMilli/1000,y:f.position.yMilli/1000};
   if(f.ownerPlayerId===b.recipientPlayerId)expect(p).toEqual(city.position);else expect((p.x-100)**2+(p.y-100)**2).toBeGreaterThan(400);
  }
  expect(archive.payload.startingState.cities[0]!.ownerPlayerId).toBe(g.snapshot.formations[1]!.ownerPlayerId);
 });
 it("retains ownership on simultaneous destruction and removes destroyed active formations",()=>{
  const g=geometry([[100,100],[110,100]],{});g.snapshot.units.forEach(u=>Object.assign(u,{hp:1,maxHp:1,attack:1,defense:1}));
  const r=g.run();expect(r.battles[0]!.outcome).toBe("mutual_destruction");expect(r.nextState.units).toEqual([]);expect(r.nextState.formations).toEqual([]);
  expect(r.nextState.cityOwners).toEqual([...g.archive.payload.startingState.cities].sort((a,b)=>a.cityId<b.cityId?-1:1).map(c=>({cityId:c.cityId,ownerPlayerId:c.ownerPlayerId})));
 });
 it("is invariant to roster/member/input permutations and independent calls",()=>{
  const g=geometry([[0,100],[100,100],[50,0]],{0:[[50,100]],1:[[50,100]],2:[[50,100]]});
  const a=g.run(),snapshot={...g.snapshot,formations:[...g.snapshot.formations].reverse().map(f=>({...f,unitIds:[...f.unitIds].reverse()})),units:[...g.snapshot.units].reverse()};
  expect(executeValidatedCombatTurn(snapshot,{...g.frozen,players:[...g.frozen.players].reverse()},g.archive)).toEqual(a);
  expect(()=>executeValidatedCombatTurn(g.snapshot,g.frozen,g.archive,{maxRounds:1,maxActions:1})).toThrow("COMBAT_WORK_LIMIT");expect(g.run()).toEqual(a);
 });
 it("places at map edges, uses exact nearest x/y tie and aborts exhausted placement",()=>{
  expect(adjacentCombatPosition({x:0,y:0},{width:100,height:100},[])).toEqual({x:1,y:20});
  expect(()=>adjacentCombatPosition({x:0,y:0},{width:10,height:10},[])).toThrow("COMBAT_PLACEMENT_UNAVAILABLE");
  expect(()=>adjacentCombatPosition({x:0,y:0},{width:100,height:100},[],1)).toThrow("COMBAT_PLACEMENT_LIMIT");
 });
});
