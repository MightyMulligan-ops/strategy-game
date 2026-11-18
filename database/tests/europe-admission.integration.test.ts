import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect} from 'vitest';
import {EUROPE_RUNTIME,LOOP_RUNTIME} from '@strategy-game/shared-types/server';
import {createDatabaseClient,testDatabaseUrl} from '../src/index.js';
import {Prisma} from '../src/generated/prisma/client.js';
import {configurationRuntime} from '../src/turn-storage.js';
describe.skipIf(process.env.RUN_DATABASE_TESTS!=='1')('EUROPE107-SQL-ADMISSION-002 fresh hosted configuration cases',()=>{
 let client:ReturnType<typeof createDatabaseClient>;const matches:string[]=[];let host:string;
 beforeAll(async()=>{if(process.env.GITHUB_ACTIONS!=='true')throw Error('Approved fresh hosted CI only');client=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));await client.$connect()});
 beforeEach(async()=>{host=randomUUID();await client.playerIdentity.create({data:{id:host}})});
 afterEach(async()=>{if(client){await client.match.deleteMany({where:{id:{in:matches}}});await client.playerIdentity.deleteMany({where:{id:host}})}matches.length=0});afterAll(async()=>{await client?.$disconnect()});
 function config(id:string){return {schemaVersion:1,name:'Admission fixture',playerCapacity:2,turnDurationMs:300000n,rulesetId:'europe-playtest',rulesetVersion:'1',simulationVersion:'europe-playtest-v1',pinnedRuleset:JSON.parse(JSON.stringify(EUROPE_RUNTIME)),config:{schemaVersion:1,gameId:id,turnDurationMs:300000}}}
 it('admits an exact Europe OPEN configuration through SQL and application restoration',async()=>{
  const id=randomUUID();matches.push(id);await client.match.create({data:{id,status:'OPEN',hostIdentityId:host,createdAt:new Date(0),configuration:{create:config(id)}}});
  const c=await client.matchConfiguration.findUniqueOrThrow({where:{matchId:id}});expect(configurationRuntime(c)).toBe('combat_loop');expect(c.pinnedRuleset).toEqual(EUROPE_RUNTIME);
 });
 it.each(['schema','extra','mask','projection','scenario','missing-policy','metadata-id','metadata-version','metadata-simulation','capacity','row-version','config-game','config-duration','config-extra','partial','running'])('rejects %s atomically without an orphan parent',async(kind)=>{
  const id=randomUUID();matches.push(id);const c=config(id);let status:'OPEN'|'RUNNING'='OPEN';
  if(kind==='schema')c.pinnedRuleset.schemaVersion=1;
  if(kind==='extra')c.pinnedRuleset.extra=true;
  if(kind==='mask')c.pinnedRuleset.europe.maskId='spoof';
  if(kind==='projection')c.pinnedRuleset.europe.projectionId='old';
  if(kind==='scenario')c.pinnedRuleset.europe.scenarioId='other';
  if(kind==='missing-policy')delete c.pinnedRuleset.europe;
  if(kind==='metadata-id')c.rulesetId='combat-loop';
  if(kind==='metadata-version')c.rulesetVersion='2';
  if(kind==='metadata-simulation')c.simulationVersion='combat-loop-v1';
  if(kind==='capacity')c.playerCapacity=3;
  if(kind==='row-version')c.schemaVersion=2;
  if(kind==='config-game')c.config.gameId='other';
  if(kind==='config-duration')c.config.turnDurationMs=299999;
  const data:Prisma.MatchConfigurationCreateWithoutMatchInput={...c,...(kind==='partial'?{rulesetVersion:null}:{}),config:kind==='config-extra'?{...c.config,extra:true}:c.config};
  if(kind==='running')status='RUNNING';
  await expect(client.match.create({data:{id,status,hostIdentityId:host,createdAt:new Date(0),configuration:{create:data}}})).rejects.toThrow();expect(await client.match.findUnique({where:{id}})).toBeNull();
 });
 it('retains complete schema1 loop and all-null legacy configuration admission',async()=>{
  for(const pin of [LOOP_RUNTIME,null]){const id=randomUUID();matches.push(id);const c=config(id);
   await client.match.create({data:{id,status:'OPEN',hostIdentityId:host,createdAt:new Date(0),configuration:{create:{...c,rulesetId:pin?.ruleset.rulesetId??null,rulesetVersion:pin?.ruleset.version??null,simulationVersion:pin?.simulationVersion??null,pinnedRuleset:pin?JSON.parse(JSON.stringify(pin)):Prisma.DbNull}}}});
   expect(configurationRuntime(await client.matchConfiguration.findUniqueOrThrow({where:{matchId:id}}))).toBe(pin?'combat_loop':'legacy');
  }
 });
});
