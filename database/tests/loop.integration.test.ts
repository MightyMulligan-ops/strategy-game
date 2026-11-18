import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,afterEach,describe,it,expect} from 'vitest';
import {generateWorld} from '@strategy-game/game-engine';
import {LOOP_RUNTIME,FIRST_COMBAT_SETUP} from '@strategy-game/shared-types/server';
import {createDatabaseClient,testDatabaseUrl,LobbyRepository,LoopRepository,FormationReadRepository} from '../src/index.js';
import {readLoop} from '../src/loop-storage.js';
describe.skipIf(process.env.RUN_DATABASE_TESTS!=='1')('repeating turns: approved fresh hosted PostgreSQL only',()=>{
 let client:ReturnType<typeof createDatabaseClient>;const matches:string[]=[],accounts:string[]=[];
 beforeAll(async()=>{if(process.env.GITHUB_ACTIONS!=='true')throw Error('Only separately approved hosted disposable PostgreSQL');client=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));await client.$connect()});
 afterEach(async()=>{if(client){await client.match.deleteMany({where:{id:{in:matches}}});await client.playerIdentity.deleteMany({where:{id:{in:accounts}}})}matches.length=0;accounts.length=0});afterAll(async()=>{if(client)await client.$disconnect()});
 async function fresh(count=2,duration=300000,allied=false){
  const world=(players:readonly string[])=>{const r=generateWorld({schemaVersion:1,generatorVersion:'territory-grid-v1',seed:123,players,settings:{regionSide:5}});if(!r.ok)throw Error('fixture');return r.world};
  const lobby=new LobbyRepository(client,world,Date.now,LOOP_RUNTIME),members:string[]=[];
  for(let i=0;i<count;i++){const id=randomUUID(),name=`L${id.replaceAll('-','').slice(0,20)}`;accounts.push(id);members.push(id);await client.playerIdentity.create({data:{id,username:name,usernameKey:name.toLowerCase()}})}
  const l=await lobby.createLobby(members[0]!,{name:'Loop integration',playerCapacity:40,turnDurationMs:duration,visibility:'PUBLIC'}),id=l.lobbyId;matches.push(id);
  for(const member of members.slice(1))await lobby.joinLobby(id,member);for(const member of members)await lobby.setReady(id,member,true);
  let start=lobby;if(allied){const participants=await client.matchParticipant.findMany({where:{matchId:id}}),ids=members.map(m=>participants.find(p=>p.identityId===m)!.playerId),relationships=ids.flatMap(from=>ids.filter(to=>to!==from).map(to=>({from,to,relation:ids.slice(0,2).includes(from)&&ids.slice(0,2).includes(to)?'ally' as const:'hostile' as const})));start=new LobbyRepository(client,world,Date.now,LOOP_RUNTIME,{...FIRST_COMBAT_SETUP,infantry:{...FIRST_COMBAT_SETUP.infantry,maxHp:70},relationshipPolicy:{mode:'explicit-v1',relationships}})}
  await start.startLobby(id,members[0]!);const repo=new LoopRepository(client);
  const close=async()=>{for(const m of members){const v=await repo.current(id,m);if(!v.own.ready)await repo.command(id,v.turn.turnNumber,m,{schemaVersion:1,turnNumber:v.turn.turnNumber,expectedRevision:v.own.revision,kind:'set_ready',ready:true})}};
  return {id,members,repo,close};
 }
 const inspect=(id:string)=>client.match.findUniqueOrThrow({where:{id},include:{world:true,configuration:true,turns:{orderBy:{number:'asc'},include:{players:{include:{revisions:true,orders:true}},frozenInput:true,resolution:true}},snapshots:{orderBy:{stateVersion:'asc'}}}});
 it.each([2,4,40])('persists1→2→3→4 for%i players, exact reset/carryover and restart',async(count)=>{
  const f=await fresh(count),initial=await inspect(f.id);const seeds=new Set<bigint>();
  for(let n=1;n<=3;n++){
   const previous=await f.repo.current(f.id,f.members[0]!);await f.close();const closed=await inspect(f.id);seeds.add(closed.turns[n-1]!.frozenInput!.seed!);expect(await f.repo.resolveClosed(f.id,15000)).toBe(true);
   const next=await f.repo.current(f.id,f.members[0]!);expect(next.turn.turnNumber).toBe(n+1);expect(next.formations).toEqual(previous.formations);expect(next.ownedLocationIds).toEqual(previous.ownedLocationIds);expect(next.own).toEqual({revision:0,ready:false,orders:[]});expect(next.turn.deadlineAtMs-next.turn.openedAtMs).toBe(300000);
   const r=await inspect(f.id);expect(r.currentStateVersion).toBe(BigInt(n));expect(r.turns).toHaveLength(n+1);expect(r.snapshots).toHaveLength(n+1);expect(r.world).toEqual(initial.world);expect(r.configuration).toEqual(initial.configuration);
   expect(r.turns[n]!.players.every(p=>p.revision===0n&&!p.ready&&p.orders.length===0&&p.revisions.length===1)).toBe(true);
   const historical=await f.repo.history(f.id,n,f.members[0]!);expect(historical.turnNumber).toBe(n);expect(historical.aftermath.battles).toEqual([]);
  }expect(seeds.size).toBe(3);const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));try{expect((await new LoopRepository(second).current(f.id,f.members[0]!)).turn.turnNumber).toBe(4);expect(await new LoopRepository(second).resolveClosed(f.id,15000)).toBe(false)}finally{await second.$disconnect()}
 },120000);
 it('carries synthetic allied capture intoTurn4 and repeated combat throughTurn7',async()=>{
  const f=await fresh(4,300000,true),initial=await f.repo.current(f.id,f.members[2]!),target=initial.formations[0]!.position;
  for(let n=1;n<=3;n++){
   for(const member of f.members.slice(0,2)){const v=await f.repo.current(f.id,member),form=v.formations[0]!,dx=target.x-form.position.x,dy=target.y-form.position.y,d=Math.hypot(dx,dy);
    const travel=n===3?d:Math.min(240,Math.max(0,d-35));const destination={x:Math.round(form.position.x+dx/d*travel),y:Math.round(form.position.y+dy/d*travel)};
    await f.repo.command(f.id,n,member,{schemaVersion:1,turnNumber:n,expectedRevision:v.own.revision,kind:'replace_orders',orders:[{orderId:`march-${n}`,type:'move',stackId:form.formationId,destination}]});
   }
   await f.close();expect(await f.repo.resolveClosed(f.id,15000)).toBe(true);
  }
  const after=await inspect(f.id),receipt=after.turns[2]!.resolution!.payload as unknown as {result:{battles:{locationId:string;recipientPlayerId:string}[];nextState:{cityOwners:{cityId:string;ownerPlayerId:string}[];formations:{ownerPlayerId:string;position:{xMilli:number;yMilli:number}}[]}}};
  expect(receipt.result.battles).toHaveLength(1);const battle=receipt.result.battles[0]!;expect(battle.locationId).toBeTruthy();expect(receipt.result.nextState.cityOwners.find(c=>c.cityId===battle.locationId)!.ownerPlayerId).toBe(battle.recipientPlayerId);
  const views=await Promise.all(f.members.map(m=>f.repo.current(f.id,m)));expect(views.every(v=>v.turn.turnNumber===4&&v.own.revision===0&&!v.own.ready&&!v.own.orders.length)).toBe(true);
  expect(views[0]!.formations.length+views[1]!.formations.length).toBe(2);expect(views[2]!.formations).toEqual([]);
  const victor=views.find(v=>v.ownedLocationIds.includes(battle.locationId))!;expect(victor.formations[0]!.position).toEqual(target);
  const ally=views.slice(0,2).find(v=>v.formations.length&&v!==victor)!;expect(Math.hypot(ally.formations[0]!.position.x-target.x,ally.formations[0]!.position.y-target.y)).toBeGreaterThan(20);
  const history=await f.repo.history(f.id,3,f.members[2]!);expect(history.aftermath.battles[0]!.outcome).toBe('defeat');expect(history.aftermath.battles[0]!.lostUnitIds.length).toBe(6);
  await f.repo.command(f.id,4,f.members[2]!,{schemaVersion:1,turnNumber:4,expectedRevision:0,kind:'set_ready',ready:true});
  const restarted=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));try{expect((await new LoopRepository(restarted).current(f.id,f.members[0]!)).ownedLocationIds).toEqual(views[0]!.ownedLocationIds)}finally{await restarted.$disconnect()}
  // A second complete battle against the remaining hostile force, with no respawn.
  // Common InfantryHP70 is an explicit synthetic fixture policy, not production balance.
  const secondTarget=views[3]!.formations[0]!.position;
  for(let n=4;n<=6;n++){
   for(const member of f.members.slice(0,2)){const v=await f.repo.current(f.id,member),form=v.formations.find(x=>x.units.some(u=>u.kind==='LEADER'));if(!form)throw Error('Synthetic attacker lost its leader before the second campaign');
    const dx=secondTarget.x-form.position.x,dy=secondTarget.y-form.position.y,d=Math.hypot(dx,dy),travel=n===6?d:Math.min(240,Math.max(0,d-35));
    await f.repo.command(f.id,n,member,{schemaVersion:1,turnNumber:n,expectedRevision:v.own.revision,kind:'replace_orders',orders:[{orderId:`second-${n}`,type:'move',stackId:form.formationId,destination:{x:Math.round(form.position.x+dx/d*travel),y:Math.round(form.position.y+dy/d*travel)}}]});
   }
   await f.close();expect(await f.repo.resolveClosed(f.id,15000)).toBe(true);
  }
  const latest=await inspect(f.id),results=latest.turns.filter(t=>t.resolution).map(t=>(t.resolution!.payload as unknown as {result:{battles:unknown[]}}).result);
  expect(results.filter(r=>r.battles.length)).toHaveLength(2);expect((await f.repo.current(f.id,f.members[0]!)).turn.turnNumber).toBe(7);
  expect((await f.repo.history(f.id,3,f.members[2]!)).aftermath.battles[0]!.lostUnitIds).toEqual(history.aftermath.battles[0]!.lostUnitIds);
  expect((await f.repo.history(f.id,6,f.members[0]!)).aftermath.battles).toHaveLength(1);

 },180000);
 it('serializes concurrent resolvers and rejects a stale-turn request even at matching revision0',async()=>{const f=await fresh();await f.close();const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));try{expect((await Promise.all([f.repo.resolveClosed(f.id,15000),new LoopRepository(second).resolveClosed(f.id,15000)])).sort()).toEqual([false,true])}finally{await second.$disconnect()}await expect(f.repo.command(f.id,1,f.members[0]!,{schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true})).rejects.toMatchObject({code:'WRONG_TURN'});expect((await f.repo.current(f.id,f.members[0]!)).own.revision).toBe(0)},30000);
 it('observes an overdue worker restart once and grants a full new window, without catch-up',async()=>{const f=await fresh(2,2000);await new Promise(r=>setTimeout(r,2200));const restarted=new LoopRepository(client);expect(await restarted.process(f.id,15000)).toBe(true);const v=await restarted.current(f.id,f.members[0]!);expect(v.turn.turnNumber).toBe(2);expect(v.turn.deadlineAtMs-v.turn.openedAtMs).toBe(2000);expect(v.turn.openedAtMs).toBeGreaterThanOrEqual(Date.now()-1500);expect(await restarted.process(f.id,15000)).toBe(false)},30000);
 it('rolls back on trusted opening clock rollback and then resumes identical frozen input',async()=>{const f=await fresh();await f.close();const before=await inspect(f.id);await expect(new LoopRepository(client,()=>0).resolveClosed(f.id,15000)).rejects.toThrow();expect(await inspect(f.id)).toEqual(before);expect(await f.repo.resolveClosed(f.id,15000)).toBe(true)},30000);
 it.each(['GameSnapshotRecord','ResolutionResult','Turn','PlayerTurnState','PlayerSubmissionRevision','Match'])('rolls back a failed%s transition stage including successor initialization',async(table)=>{
  const f=await fresh();await f.close();const before=await inspect(f.id),name=`loop_failure_${randomUUID().replaceAll('-','')}`,column=table==='Match'?'"id"':'"matchId"';
  const condition=table==='GameSnapshotRecord'?'"stateVersion"=0':table==='ResolutionResult'?'false':table==='Turn'?'"number"=1':table==='Match'?'"currentStateVersion"=0':'"turnNumber"=1';
  await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${column}<>'${f.id}' OR ${condition}) NOT VALID`);
  try{await expect(f.repo.resolveClosed(f.id,15000)).rejects.toThrow();expect(await inspect(f.id)).toEqual(before)}finally{await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`)}expect(await f.repo.resolveClosed(f.id,15000)).toBe(true);
 },30000);
 it('rejects direct immutable history/state edits and detects forged sequential bundle inserts',async()=>{
  const f=await fresh();await f.close();await f.repo.resolveClosed(f.id,15000);const before=await inspect(f.id);
  await expect(client.gameSnapshotRecord.update({where:{matchId_stateVersion:{matchId:f.id,stateVersion:1n}},data:{payload:{}}})).rejects.toThrow();await expect(client.turn.update({where:{matchId_number:{matchId:f.id,number:1n}},data:{status:'OPEN'}})).rejects.toThrow();
  await expect(client.turn.create({data:{matchId:f.id,number:4n,startingStateVersion:1n,status:'OPEN',openedAtMs:1n,deadlineAtMs:300001n,lastObservedAtMs:1n}})).rejects.toThrow();expect(await inspect(f.id)).toEqual(before);
  const a=await client.$transaction(tx=>readLoop(tx,f.id));expect(a.state.turn.turnNumber).toBe(2);
 },30000);
 it('does not leak enemy identities/positions/units at current or history projection boundary',async()=>{const f=await fresh(),views=await Promise.all(f.members.map(m=>f.repo.current(f.id,m)));const own=JSON.stringify(views[0]);for(const form of views[1]!.formations){expect(own).not.toContain(form.formationId);for(const u of form.units)expect(own).not.toContain(u.unitId)}expect(own).not.toMatch(/seed|auditJson|worldRef|lastObserved/);expect((await new FormationReadRepository(client).getFormations(f.id,f.members[0]!)).schemaVersion).toBe(4)},30000);
});
