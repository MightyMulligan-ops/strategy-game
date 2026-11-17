import {readStoredTurn} from "../src/turn-storage.js";
import {restoreWorldArchive} from "../src/world-repository.js";
import {json} from "../src/mappings.js";
import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,afterEach,describe,it,expect} from "vitest";
import {COMBAT_TURN_RUNTIME_PROFILE} from "@strategy-game/shared-types/server";
import {generateWorld} from "@strategy-game/game-engine";
import {resolveCombatTurn} from "@strategy-game/game-engine/server";
import {createDatabaseClient,testDatabaseUrl,LobbyRepository,FormationReadRepository,MovementDraftRepository,
 TurnClosureRepository,MovementResolutionRepository,TurnReadRepository,MatchRepository} from "../src/index.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS!=="1")("Stage B fresh disposable hosted PostgreSQL only",()=>{
 let client:ReturnType<typeof createDatabaseClient>;const matches:string[]=[],accounts:string[]=[];
 beforeAll(async()=>{if(process.env.GITHUB_ACTIONS!=="true")throw Error("Only separately approved fresh hosted CI");client=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));await client.$connect()});
 afterEach(async()=>{if(client){await client.match.deleteMany({where:{id:{in:matches}}});await client.playerIdentity.deleteMany({where:{id:{in:accounts}}});}matches.length=0;accounts.length=0;});
 afterAll(async()=>{if(client)await client.$disconnect()});
 async function fresh(count=2){
  const world=(players:readonly string[])=>{const r=generateWorld({schemaVersion:1,generatorVersion:"territory-grid-v1",seed:123,players,settings:{regionSide:5}});if(!r.ok)throw Error("fixture");return r.world};
  const lobby=new LobbyRepository(client,world,Date.now,COMBAT_TURN_RUNTIME_PROFILE),members:string[]=[];
  for(let i=0;i<count;i++){const id=randomUUID(),name=`C${id.replaceAll("-","").slice(0,20)}`;accounts.push(id);members.push(id);await client.playerIdentity.create({data:{id,username:name,usernameKey:name.toLowerCase()}})}
  const l=await lobby.createLobby(members[0]!,{name:"Combat integration",playerCapacity:40,turnDurationMs:300000,visibility:"PUBLIC"}),id=l.lobbyId;matches.push(id);
  for(const member of members.slice(1))await lobby.joinLobby(id,member);for(const member of members)await lobby.setReady(id,member,true);await lobby.startLobby(id,members[0]!);
  const read=new TurnReadRepository(client),formations=new FormationReadRepository(client),drafts=new MovementDraftRepository(client),closure=new TurnClosureRepository(client),resolver=new MovementResolutionRepository(client);
  const close=async(revisions:Record<number,number>={})=>{for(let i=0;i<members.length;i++)await closure.setReady(id,1,members[i]!,{schemaVersion:1,expectedRevision:revisions[i]??0,ready:true})};
  return {id,members,read,formations,drafts,closure,resolver,close};
 }
 const inspect=(id:string)=>client.match.findUniqueOrThrow({where:{id},include:{configuration:true,world:true,snapshots:{orderBy:{stateVersion:"asc"}},turns:{include:{frozenInput:true,resolution:true},orderBy:{number:"asc"}}}});
 it.each([2,4,40])("initializes, freezes, atomically resolves and restores %i players without Turn2",async(count)=>{
  const f=await fresh(count);await f.close();const before=await inspect(f.id);expect(before.turns[0]!.frozenInput!.payload).toMatchObject({schemaVersion:4,kind:"combat_turn",combatPolicy:{version:"chronological-speed-v1"}});
  expect(await f.resolver.resolveClosed(f.id,15000)).toBe(true);const after=await inspect(f.id);
  expect(after.currentStateVersion).toBe(1n);expect(after.turns).toHaveLength(1);expect(after.turns[0]!.status).toBe("RESOLVED");expect(after.snapshots).toHaveLength(2);
  expect(after.turns[0]!.resolution!.payload).toMatchObject({schemaVersion:3,kind:"combat_turn",battles:[],nextState:{schemaVersion:9,kind:"combat_resolved"}});
  expect(after.world).toEqual(before.world);expect(after.configuration).toEqual(before.configuration);expect(after.turns[0]!.frozenInput).toEqual(before.turns[0]!.frozenInput);
  const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));try{
   expect((await new MatchRepository(second).loadTurn(f.id,1)).state.turn.status).toBe("resolved");expect(await new MovementResolutionRepository(second).resolveClosed(f.id,15000)).toBe(false);
   expect(await new TurnReadRepository(second).getAftermath(f.id,f.members[0]!)).toMatchObject({schemaVersion:2,state:"RESOLVED",battles:[]});
  }finally{await second.$disconnect()}
 },60000);
 it("commits a complete reachable mutual battle and own-only losses/survivors",async()=>{
  const f=await fresh(),views=await Promise.all(f.members.map(m=>f.formations.getFormations(f.id,m)));
  if(views[0]!.state!=="READY"||views[1]!.state!=="READY")throw Error("fixture");const a=views[0]!.formations[0]!,b=views[1]!.formations[0]!,mid={x:(a.position.x+b.position.x)/2,y:(a.position.y+b.position.y)/2};
  for(let i=0;i<2;i++)await f.drafts.submitDraft(f.id,1,f.members[i]!,{schemaVersion:1,expectedRevision:0,kind:"replace_orders",orders:[{type:"move",orderId:`private-${i}`,stackId:i?b.formationId:a.formationId,destination:mid}]});
  await f.close({0:1,1:1});expect(await f.resolver.resolveClosed(f.id,15000)).toBe(true);
  const view=await f.read.getAftermath(f.id,f.members[0]!);expect(view).toMatchObject({schemaVersion:2,state:"RESOLVED",battles:[{ownFormationIds:[a.formationId]}]});
  const text=JSON.stringify(view);expect(text).not.toContain(b.formationId);for(const u of b.units)expect(text).not.toContain(u.unitId);
  expect(text).not.toMatch(/seed|auditJson|rounds|private-1|sequence|time/);
  expect((await f.formations.getFormations(f.id,f.members[0]!)).schemaVersion).toBe(3);
  const row=await inspect(f.id),result=row.turns[0]!.resolution!.payload as unknown as {battles:unknown[];nextState:{units:unknown[]}};
  expect(result.battles).toHaveLength(1);expect(result.nextState.units.length).toBeLessThan(12);
  expect(await f.read.getAftermath(f.id,f.members[0]!)).toEqual(view);
 },30000);
 it("serializes duplicate/concurrent execution using the same immutable seed",async()=>{
  const f=await fresh();await f.close();const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));try{
   expect((await Promise.all([f.resolver.resolveClosed(f.id,15000),new MovementResolutionRepository(second).resolveClosed(f.id,15000)])).sort()).toEqual([false,true]);
   expect(await client.resolutionResult.count({where:{matchId:f.id}})).toBe(1);expect(await client.gameSnapshotRecord.count({where:{matchId:f.id}})).toBe(2);
  }finally{await second.$disconnect()}
 },30000);
 it.each(["GameSnapshotRecord","ResolutionResult","Turn","Match"])("rolls back injected %s failure to identical CLOSED input, then recovers",async(table)=>{
  const f=await fresh();await f.close();const before=await inspect(f.id),name=`combat_failure_${randomUUID().replaceAll("-","")}`;
  const column=table==="Match"?'"id"':'"matchId"',condition=table==="GameSnapshotRecord"?'"stateVersion"=0':table==="ResolutionResult"?'false':table==="Turn"?'"status"<>\'RESOLVED\'':'"currentStateVersion"=0';
  await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${column}<>'${f.id}' OR ${condition}) NOT VALID`);
  try{await expect(f.resolver.resolveClosed(f.id,15000)).rejects.toThrow();expect(await inspect(f.id)).toEqual(before)}finally{await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`)}
  expect(await f.resolver.resolveClosed(f.id,15000)).toBe(true);
 },30000);
 it.each(["missing-hp","missing-coordinate","forged-owner","forged-capture"])("rejects forged %s inside a complete transaction and rolls everything back",async(kind)=>{
  const f=await fresh();await f.close();const a=await client.$transaction(tx=>readStoredTurn(tx,f.id,1));if(a.kind!=="combat_turn"||!a.row.match.world||!a.row.frozenInput)throw Error("fixture");
  const result=resolveCombatTurn(a.snapshot,a.row.frozenInput.payload,restoreWorldArchive(a.row.match.world)),next=JSON.parse(JSON.stringify(result.nextState));
  if(kind==="missing-hp")delete next.units[0].hp;
  if(kind==="missing-coordinate")delete next.formations[0].position.xMilli;
  if(kind==="forged-owner")next.units[0].ownerPlayerId="forged";
  if(kind==="forged-capture")next.cityOwners[0].ownerPlayerId=next.cityOwners[1].ownerPlayerId;
  const before=await inspect(f.id);
  await expect(client.$transaction(async(tx)=>{
   await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id"=${f.id} FOR UPDATE`;
   await tx.turn.updateMany({where:{matchId:f.id},data:{status:"RESOLVING"}});
   await tx.gameSnapshotRecord.create({data:{matchId:f.id,stateVersion:1n,completedTurnNumber:1n,snapshotId:next.snapshotId,payload:json(next)}});
   await tx.resolutionResult.create({data:{matchId:f.id,turnNumber:1n,nextStateVersion:1n,resolutionId:result.resolutionId,payload:json({...result,nextState:next})}});
   await tx.turn.updateMany({where:{matchId:f.id},data:{status:"RESOLVED"}});
   await tx.match.update({where:{id:f.id},data:{currentStateVersion:1n}});
  },{timeout:15000})).rejects.toThrow();
  expect(await inspect(f.id)).toEqual(before);expect(await f.resolver.resolveClosed(f.id,15000)).toBe(true);
 },30000);
 it.each(["frozen","snapshot","result","turn-two","resolving","version"])("rejects forbidden %s changes without partial artifacts",async(kind)=>{
  const f=await fresh();await f.close();if(kind!=="resolving")await f.resolver.resolveClosed(f.id,15000);const before=await inspect(f.id);
  const action=()=>kind==="frozen"?client.frozenTurnInputRecord.updateMany({where:{matchId:f.id},data:{payload:{}}}):kind==="snapshot"?client.gameSnapshotRecord.updateMany({where:{matchId:f.id,stateVersion:1n},data:{payload:{}}}):kind==="result"?client.resolutionResult.updateMany({where:{matchId:f.id},data:{payload:{}}}):kind==="version"?client.match.update({where:{id:f.id},data:{currentStateVersion:2n}}):kind==="resolving"?client.turn.updateMany({where:{matchId:f.id},data:{status:"RESOLVING"}}):client.turn.create({data:{matchId:f.id,number:2n,startingStateVersion:1n,status:"OPEN",openedAtMs:0n,deadlineAtMs:300000n,lastObservedAtMs:0n}});
  await expect(action()).rejects.toThrow();expect(await inspect(f.id)).toEqual(before);
 },30000);
});
