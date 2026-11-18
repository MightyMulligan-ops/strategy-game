import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,afterEach,describe,it,expect} from 'vitest';
import {EUROPE_RUNTIME,LOOP_RUNTIME} from '@strategy-game/shared-types/server';
import {EuropeCurrentSchema} from '@strategy-game/shared-types';
import {createDatabaseClient,testDatabaseUrl,LobbyRepository,LoopRepository} from '../src/index.js';
import {readLoop} from '../src/loop-storage.js';
describe.skipIf(process.env.RUN_DATABASE_TESTS!=='1')('Europe two-participant loop: fresh hosted disposable PostgreSQL only',()=>{
 let client:ReturnType<typeof createDatabaseClient>;const matches:string[]=[],accounts:string[]=[];
 beforeAll(async()=>{if(process.env.GITHUB_ACTIONS!=='true')throw Error('Hosted fresh disposable CI only');client=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));await client.$connect()});
 afterEach(async()=>{await client.match.deleteMany({where:{id:{in:matches}}});await client.playerIdentity.deleteMany({where:{id:{in:accounts}}});matches.length=0;accounts.length=0});afterAll(async()=>{await client?.$disconnect()});
 async function fresh(){
  const lobby=new LobbyRepository(client,undefined,Date.now,EUROPE_RUNTIME),members:string[]=[];
  for(let i=0;i<2;i++){const id=randomUUID(),name=`E${id.replaceAll('-','').slice(0,20)}`;accounts.push(id);members.push(id);await client.playerIdentity.create({data:{id,username:name,usernameKey:name.toLowerCase()}})}
  const l=await lobby.createLobby(members[0]!,{name:'Europe test',playerCapacity:2,turnDurationMs:300000,visibility:'PUBLIC'}),id=l.lobbyId;matches.push(id);await lobby.joinLobby(id,members[1]!);for(const m of members)await lobby.setReady(id,m,true);await lobby.startLobby(id,members[0]!);
  const repo=new LoopRepository(client),current=async(m=members[0]!)=>EuropeCurrentSchema.parse(await repo.current(id,m));
  const close=async()=>{for(const m of members){const v=await current(m);await repo.command(id,v.turn.turnNumber,m,{schemaVersion:2,profile:v.profile,turnNumber:v.turn.turnNumber,expectedRevision:v.own.revision,kind:'set_ready',ready:true})}};
  return {id,members,repo,current,close};
 }
 const inspect=(id:string)=>client.match.findUniqueOrThrow({where:{id},include:{world:true,configuration:true,turns:{orderBy:{number:'asc'},include:{players:{include:{revisions:true,orders:true}},frozenInput:true,resolution:true}},snapshots:{orderBy:{stateVersion:'asc'}}}});
 it('opens1→2→3→4 atomically with exact carryover, full windows and restart',async()=>{
  const f=await fresh(),initial=await f.current();
  for(let n=1;n<=3;n++){await f.close();expect(await f.repo.resolveClosed(f.id,15000)).toBe(true);const v=await f.current();expect(v.turn.turnNumber).toBe(n+1);expect(v.own).toEqual({revision:0,ready:false,orders:[]});expect(v.formations).toEqual(initial.formations);expect(v.turn.deadlineAtMs-v.turn.openedAtMs).toBe(300000);expect((await f.repo.history(f.id,n,f.members[0]!)).schemaVersion).toBe(2)}
  const stored=await inspect(f.id);expect(stored.snapshots).toHaveLength(4);expect(stored.turns).toHaveLength(4);expect(stored.turns.filter(t=>t.status==='OPEN')).toHaveLength(1);
  const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));try{expect((await new LoopRepository(second).current(f.id,f.members[0]!)).turn.turnNumber).toBe(4);expect(await new LoopRepository(second).resolveClosed(f.id,15000)).toBe(false)}finally{await second.$disconnect()}
 },120000);
 it('rejects water, stale profiles/turns and foreign formations without accepting intent',async()=>{
  const f=await fresh(),first=await f.current(),actor=first.formations[0]!.position.x<500?f.members[0]!:f.members[1]!,v=await f.current(actor),before=await inspect(f.id),other=await f.current(f.members.find(m=>m!==actor)!);
  const base={schemaVersion:2,profile:v.profile,turnNumber:1,expectedRevision:0};
  for(const command of [{schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true},{...base,profile:{...v.profile,maskId:'old'},kind:'set_ready',ready:true},{...base,kind:'replace_orders',orders:[{orderId:'foreign',type:'move',stackId:other.formations[0]!.formationId,destination:{x:240,y:240}}]},{...base,kind:'replace_orders',orders:[{orderId:'water',type:'move',stackId:v.formations[0]!.formationId,destination:{x:240,y:0}}]}])await expect(f.repo.command(f.id,1,actor,command)).rejects.toThrow();
  const after=await inspect(f.id);expect(after.turns[0]!.lastObservedAtMs).toBeGreaterThanOrEqual(before.turns[0]!.lastObservedAtMs);const withoutObservation=(r:typeof before)=>({...r,turns:r.turns.map(t=>({...t,lastObservedAtMs:0n}))});expect(withoutObservation(after)).toEqual(withoutObservation(before));await f.close();await f.repo.resolveClosed(f.id,15000);await expect(f.repo.command(f.id,1,f.members[0]!,{...base,kind:'set_ready',ready:true})).rejects.toThrow('WRONG_TURN');
 },60000);
 it('serializes competing commands and workers into exactly one successor',async()=>{
  const f=await fresh(),v=await f.current(),c={schemaVersion:2,profile:v.profile,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true};
  const writes=await Promise.allSettled([f.repo.command(f.id,1,f.members[0]!,c),f.repo.command(f.id,1,f.members[0]!,c)]);expect(writes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const b=await f.current(f.members[1]!);await f.repo.command(f.id,1,f.members[1]!,{...c,expectedRevision:b.own.revision});
  const results=await Promise.all([f.repo.resolveClosed(f.id,15000),f.repo.resolveClosed(f.id,15000)]);expect(results.filter(Boolean)).toHaveLength(1);expect((await inspect(f.id)).turns).toHaveLength(2);
 },60000);
 it('rolls back complete failed resolution and resumes the identical frozen input',async()=>{
  const f=await fresh();await f.close();const before=await inspect(f.id);await expect(new LoopRepository(client,()=>0).resolveClosed(f.id,15000)).rejects.toThrow();expect(await inspect(f.id)).toEqual(before);expect(await f.repo.resolveClosed(f.id,15000)).toBe(true);
 },60000);
 it('executes real land movement/contact, casualties, own aftermath and next-turn positions',async()=>{
  const f=await fresh(),start=await f.current(),attacker=start.formations[0]!,enemy=(await f.current(f.members[1]!)).formations[0]!,target=enemy.position;let battle=false;
  for(let n=1;n<=4&&!battle;n++){
   const v=await f.current(),form=v.formations.find(x=>x.formationId===attacker.formationId)!;const dx=target.x-form.position.x,dy=target.y-form.position.y,d=Math.hypot(dx,dy),t=Math.min(240,d)/d;
   await f.repo.command(f.id,n,f.members[0]!,{schemaVersion:2,profile:v.profile,turnNumber:n,expectedRevision:0,kind:'replace_orders',orders:[{orderId:`land-${n}`,type:'move',stackId:form.formationId,destination:{x:Math.round(form.position.x+dx*t),y:Math.round(form.position.y+dy*t)}}]});
   await f.close();await f.repo.resolveClosed(f.id,15000);const h=await f.repo.history(f.id,n,f.members[0]!);battle=h.aftermath.battles.length>0;
   if(battle){expect(h.aftermath.battles[0]!.lostUnitIds.length+h.aftermath.battles[0]!.survivingUnitIds.length).toBe(6);const other=await f.repo.history(f.id,n,f.members[1]!);expect(other.aftermath.battles[0]!.lostUnitIds.length+h.aftermath.battles[0]!.lostUnitIds.length).toBeGreaterThan(0)}
  }expect(battle).toBe(true);
  const a=await client.$transaction(tx=>readLoop(tx,f.id)),view=await f.current();expect(JSON.stringify(view)).not.toMatch(/seed|audit|snapshot|combatPolicy|relationships|opponent/);expect(view.formations.every(form=>form.units.every(u=>attacker.units.some(old=>old.unitId===u.unitId&&old.originalSpawnNodeId===u.originalSpawnNodeId)))).toBe(true);expect(a.snapshot.units.length).toBeLessThan(12);
 },120000);
 it('rejects immutable pin replacement and keeps old cohort admission distinct',async()=>{
  const f=await fresh();await expect(client.matchConfiguration.update({where:{matchId:f.id},data:{pinnedRuleset:JSON.parse(JSON.stringify(LOOP_RUNTIME)),simulationVersion:'combat-loop-v1',rulesetId:'combat-loop'}})).rejects.toThrow();expect((await f.current()).schemaVersion).toBe(2);
 },60000);
 it('recovers one persisted CLOSED Europe turn through the bounded existing worker interface',async()=>{
  const f=await fresh();await f.close();const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
  try{const restarted=new LoopRepository(second);expect(await restarted.dueMatches(100)).toContain(f.id);expect(await restarted.process(f.id,15000)).toBe(true);expect((await restarted.current(f.id,f.members[0]!)).turn.turnNumber).toBe(2);expect(await restarted.process(f.id,15000)).toBe(false);expect((await inspect(f.id)).turns).toHaveLength(2)}finally{await second.$disconnect()}
 },60000);

});
