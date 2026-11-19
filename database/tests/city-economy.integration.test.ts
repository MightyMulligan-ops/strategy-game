import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CITY_RUNTIME } from "@strategy-game/shared-types/server";
import { CITY_PROFILE, CityCurrentSchema } from "@strategy-game/shared-types";
import { createDatabaseClient, FormationReadRepository, LobbyRepository, LoopRepository, testDatabaseUrl, WorldRepository } from "../src/index.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS!=="1")("city economy with fresh hosted PostgreSQL",()=>{
 let client: ReturnType<typeof createDatabaseClient>;
 const matches:string[]=[], accounts:string[]=[];
 beforeAll(async()=>{
  if(process.env.GITHUB_ACTIONS!=="true")throw Error("Hosted fresh disposable CI only");
  client=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));await client.$connect();
 });
 afterEach(async()=>{
  await client.match.deleteMany({where:{id:{in:matches}}});
  await client.playerIdentity.deleteMany({where:{id:{in:accounts}}});
  matches.length=0;accounts.length=0;
 });
 afterAll(async()=>{await client?.$disconnect()});
 async function fresh(startingCredits?:number){
  const lobbies=new LobbyRepository(client,undefined,Date.now,CITY_RUNTIME);
  const members=await Promise.all([0,1,2].map(async()=>{
   const id=randomUUID(),username=`U${id.replaceAll("-","").slice(0,20)}`;
   accounts.push(id);await client.playerIdentity.create({data:{id,username,usernameKey:username.toLowerCase()}});return id;
  }));
  const [host,guest,outsider]=members as [string,string,string];
  const lobby=await lobbies.createLobby(host,{name:"Cities",playerCapacity:2,turnDurationMs:300000,visibility:"PUBLIC",...(startingCredits===undefined?{}:{startingCredits})});
  const id=lobby.lobbyId;matches.push(id);await lobbies.joinLobby(id,guest);
  for(const actor of [host,guest])await lobbies.setReady(id,actor,true);
  await lobbies.startLobby(id,host);
  const repo=new LoopRepository(client);
  const current=async(actor=host)=>CityCurrentSchema.parse(await repo.current(id,actor));
  const send=async(actor:string,command:object,rev?:number)=>{
   const view=await current(actor);
   return repo.command(id,view.turn.turnNumber,actor,{schemaVersion:3,profile:CITY_PROFILE,turnNumber:view.turn.turnNumber,
    expectedRevision:rev??view.own.revision,...command});
  };
  const ready=async(actor:string,on=true)=>send(actor,{kind:"set_ready",ready:on});
  const buy=(cityId:string,quantity=1,recruitmentId=randomUUID(),unitType="INFANTRY")=>({kind:"city_edit",edit:{kind:"recruit",cityId,unitType,quantity,recruitmentId}});
  return {id,lobby,host,guest,outsider,repo,current,send,ready,buy};
 }
 it("pins creation, locks Ready edits, restores private drafts, and opens the next turn with recruits and income",async()=>{
  const f=await fresh(), initial=await f.current(), city=initial.cities.find(c=>c.owned)!;
  expect(f.lobby.settings.startingCredits).toBe(2000);
  expect(initial.cities.map(c=>c.name)).toEqual(["Madrid","Andorra la Vella","Bilbao"]);
  expect(initial.cities.find(c=>c.cityId==="bilbao")?.owned).toBe(false);
  expect(initial.formations[0]?.position).toEqual(city.position);
  expect((await new FormationReadRepository(client).getFormations(f.id,f.host)).schemaVersion).toBe(6);
  const world=await new WorldRepository(client).getWorld(f.id,f.host);
  expect(world.state==="READY"&&world.world.territories.every(t=>!t.city)).toBe(true);
  const buy=f.buy(city.cityId,2,undefined,"LIEUTENANT");
  await f.send(f.host,buy);
  await expect(f.send(f.host,buy,0)).rejects.toThrow("STALE_REVISION");
  await expect(f.send(f.host,buy)).rejects.toThrow("INVALID_DRAFT");
  await expect(f.repo.current(f.id,f.outsider)).rejects.toThrow("NOT_FOUND");
  expect((await f.current(f.guest)).cityPlan).toMatchObject({credits:2000,recruitment:[]});
  expect((await new LoopRepository(client).current(f.id,f.host))).toEqual(await f.current());
  await f.ready(f.host);
  const cancel={kind:"city_edit",edit:{kind:"cancel_recruitment",recruitmentId:buy.edit.recruitmentId}};
  await expect(f.send(f.host,cancel)).rejects.toThrow("READY_LOCKED");
  await f.ready(f.host,false);await f.send(f.host,cancel);
  expect((await f.current()).cityPlan.credits).toBe(2000);
  await expect(f.send(f.host,cancel)).rejects.toThrow("INVALID_DRAFT");
  await f.send(f.host,f.buy(city.cityId,2,undefined,"LIEUTENANT"));
  await f.ready(f.host);await f.ready(f.guest);
  expect(await Promise.all([f.repo.resolveClosed(f.id,15000),new LoopRepository(client).resolveClosed(f.id,15000)]))
   .toEqual(expect.arrayContaining([true,false]));
  const next=await f.current();
  expect(next.turn.turnNumber).toBe(2);
  expect(next.own).toEqual({revision:0,orders:[],ready:false});
  expect(next.cityPlan).toMatchObject({credits:2000,recruitment:[]});
  expect(next.formations[0]?.units.filter(u=>u.kind==="LEADER")).toHaveLength(3);
  const history=await f.repo.history(f.id,1,f.host);
  expect(history).toMatchObject({economy:[{kind:"canceled",refund:400},{kind:"completed"},{kind:"income",amount:400}]});
  expect(await f.repo.history(f.id,1,f.guest)).toMatchObject({economy:[{kind:"income",amount:400}]});
 },60000);
 it("serializes competing purchases and rolls settlement back completely before restart",async()=>{
  const f=await fresh(200), initial=await f.current(), city=initial.cities.find(c=>c.owned)!;
  const concurrent=await Promise.allSettled([f.send(f.host,f.buy(city.cityId,2),0),f.send(f.host,f.buy(city.cityId,2),0)]);
  expect(concurrent.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect((await f.current()).cityPlan.credits).toBe(0);
  await expect(f.send(f.host,f.buy(city.cityId))).rejects.toThrow("INVALID_DRAFT");
  await f.ready(f.host);await f.ready(f.guest);
  await expect(new LoopRepository(client,()=>0).resolveClosed(f.id,15000)).rejects.toThrow();
  expect(await client.gameSnapshotRecord.count({where:{matchId:f.id}})).toBe(1);
  expect(await client.resolutionResult.count({where:{matchId:f.id}})).toBe(0);
  expect(await client.turn.count({where:{matchId:f.id,status:"CLOSED"}})).toBe(1);
  const restarted=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
  try{
   const repo=new LoopRepository(restarted);
   expect(await repo.dueMatches(100)).toContain(f.id);
   expect(await repo.process(f.id,15000)).toBe(true);
   expect(await repo.process(f.id,15000)).toBe(false);
   expect(await repo.current(f.id,f.host)).toMatchObject({turn:{turnNumber:2},cityPlan:{credits:400}});
  }finally{await restarted.$disconnect()}
 },60000);
 it("dispatches selected recruits and preserves identity and original city through the next turn",async()=>{
  const f=await fresh(), first=await f.current(), city=first.cities.find(c=>c.owned)!;
  await f.send(f.host,f.buy(city.cityId,1));
  await f.ready(f.host);await f.ready(f.guest);
  await f.repo.resolveClosed(f.id,15000);
  const second=await f.current(), garrison=second.formations[0]!;
  const recruit=garrison.units.find(u=>!first.formations[0]!.units.some(old=>old.unitId===u.unitId))!;
  const leader=garrison.units.find(u=>u.kind==="LEADER")!;
  const destination={x:city.position.x,y:city.position.y-1};
  await f.send(f.host,{kind:"city_edit",edit:{kind:"dispatch",dispatch:{cityId:city.cityId,dispatchId:randomUUID(),
   destination,unitIds:[recruit.unitId,leader.unitId]}}});
  expect((await f.current()).formations[0]?.position).toEqual(city.position);
  await f.ready(f.host);await f.ready(f.guest);
  await f.repo.resolveClosed(f.id,15000);
  const third=await f.current();
  const field=third.formations.find(form=>form.units.some(u=>u.unitId===recruit.unitId))!;
  expect(third.turn.turnNumber).toBe(3);
  expect(field.position).toEqual(destination);
  expect(field.units).toEqual(expect.arrayContaining([recruit,leader]));
  expect(field.units).toHaveLength(2);
  expect(third.formations.find(form=>form.formationId===garrison.formationId)?.units).toHaveLength(5);
 },60000);
 it("rejects a fabricated SQL discount without changing the current plan",async()=>{
  const f=await fresh(), view=await f.current(), city=view.cities.find(c=>c.owned)!;
  const playerId=view.formations[0]!.ownerPlayerId, buy=f.buy(city.cityId);
  const revision=await client.playerSubmissionRevision.findUniqueOrThrow({where:{matchId_turnNumber_playerId_revision:{
   matchId:f.id,turnNumber:1n,playerId,revision:0n}}});
  const {kind, ...intent}=buy.edit;void kind;
  await expect(client.playerSubmissionRevision.create({data:{matchId:f.id,turnNumber:1n,playerId,revision:1n,
   kind:"CITY_EDIT",ready:false,orders:[],command:{schemaVersion:3,profile:CITY_PROFILE,turnNumber:1,expectedRevision:0,...buy},
   cityDraft:JSON.parse(JSON.stringify({...revision.cityDraft as object,recruitment:[{...intent,paid:0,arrivalTurn:2}]}))}}))
   .rejects.toThrow("Invalid city edit");
  expect(await f.current()).toEqual(view);
 },60000);
 it("rejects rewriting the frozen balance or revision",async()=>{
  const f=await fresh();
  await expect(client.matchConfiguration.update({where:{matchId:f.id},data:{pinnedRuleset:{}}})).rejects.toThrow();
  await expect(client.playerSubmissionRevision.updateMany({where:{matchId:f.id},data:{cityDraft:{}}})).rejects.toThrow();
  expect((await f.current()).cityPlan.credits).toBe(2000);
 },60000);
});
