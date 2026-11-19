import {describe,it,expect,vi,afterEach} from 'vitest';
import {PassThrough} from 'node:stream';
import {LoopCurrentSchema} from '@strategy-game/shared-types';
import {MovementDraftError} from '@strategy-game/database';
import {lobbyFixture,origin} from './lobby-fixture.js';
import {MemoryAuth} from './memory-auth.js';
import type {FastifyInstance} from 'fastify';
const apps:FastifyInstance[]=[];afterEach(async()=>{for(const a of apps.splice(0))await a.close()});
const current=(n=1,revision=0)=>LoopCurrentSchema.parse({schemaVersion:1,kind:'loop_current',matchId:'match',turn:{schemaVersion:1,gameId:'match',turnNumber:n,status:'open',openedAtMs:1000,deadlineAtMs:2000},own:{revision,ready:false,orders:[]},formations:[],ownedLocationIds:[]});
const command={schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true};
async function fixture(){const auth=new MemoryAuth(),loops={current:vi.fn(async()=>current()),history:vi.fn(async()=>({schemaVersion:1 as const,kind:'loop_aftermath' as const,matchId:'match',turnNumber:1,aftermath:{schemaVersion:2 as const,matchId:'match',state:'RESOLVED' as const,formations:[],battles:[]}})),command:vi.fn(async()=>current(1,1))};const f=await lobbyFixture(auth,{} as never,undefined,undefined,undefined,undefined,undefined,undefined,loops);apps.push(f.app);return {...f,loops,auth,browser:await f.login()}}
describe('signed repeating routes: exact-turn privacy and CSRF',()=>{
 it('uses signed identity and private GET responses, with one exact historical turn',async()=>{const f=await fixture(),r=await f.request(f.browser,'GET','/api/matches/match/loop/current');expect(r.statusCode).toBe(200);expect(f.loops.current).toHaveBeenCalledExactlyOnceWith('match',f.browser.identityId);expect(r.headers['cache-control']).toBe('no-store');expect(r.headers['referrer-policy']).toBe('no-referrer');expect(r.body).not.toMatch(/seed|audit|snapshot|opponent/);expect((await f.request(f.browser,'GET','/api/matches/match/loop/turns/1/aftermath')).statusCode).toBe(200);expect(f.loops.history).toHaveBeenCalledExactlyOnceWith('match',1,f.browser.identityId)});
 it('binds path/body turn and expected revision, never accepts a mismatched acknowledgement',async()=>{const f=await fixture(),path='/api/matches/match/loop/turns/1/commands';expect((await f.request(f.browser,'POST',path,{...command,turnNumber:2})).statusCode).toBe(409);expect(f.loops.command).not.toHaveBeenCalled();expect((await f.request(f.browser,'POST',path,command)).statusCode).toBe(200);expect(f.loops.command).toHaveBeenCalledExactlyOnceWith('match',1,f.browser.identityId,command);f.loops.command.mockResolvedValueOnce(current(2,1));expect((await f.request(f.browser,'POST',path,command)).statusCode).toBe(500)});
 it.each(['seed=1','playerId=enemy','turnNumber=2','limit=10000'])('rejects unbounded/untrusted query%s',async(q)=>{const f=await fixture();expect((await f.request(f.browser,'GET',`/api/matches/match/loop/current?${q}`)).statusCode).toBe(400);expect(f.loops.current).not.toHaveBeenCalled()});
 it.each(['anonymous','onboarding','revoked'])('denies%s before repository reads',async(kind)=>{const f=await fixture();if(kind==='anonymous')f.browser.cookie='';if(kind==='onboarding')f.browser=await f.login(null);if(kind==='revoked')await f.auth.revokeAllSessions(f.browser.identityId);expect((await f.request(f.browser,'GET','/api/matches/match/loop/current')).statusCode).toBe(kind==='onboarding'?403:401);expect(f.loops.current).not.toHaveBeenCalled()});
 it('enforces origin and CSRF without command execution',async()=>{const f=await fixture();for(const headers of [{origin:'https://other.example','x-csrf-token':f.browser.csrf},{origin}]){const r=await f.app.inject({method:'POST',url:'/api/matches/match/loop/turns/1/commands',headers:{cookie:f.browser.cookie,...headers},payload:command});expect(r.statusCode).toBe(403)}expect(f.loops.command).not.toHaveBeenCalled()});
 it('checks exact intended turn after a delayed request body completes',async()=>{const f=await fixture(),body=new PassThrough();let active=1;f.loops.command.mockImplementation(async()=>{if(active!==1)throw new MovementDraftError('WRONG_TURN');return current(1,1)});const p=f.app.inject({method:'POST',url:'/api/matches/match/loop/turns/1/commands',headers:{cookie:f.browser.cookie,origin,'x-csrf-token':f.browser.csrf,'content-type':'application/json'},payload:body}).then(r=>r);body.write('{');active=2;body.end(JSON.stringify(command).slice(1));expect((await p).statusCode).toBe(409)});
 it('rejects hidden projection fields, wrong historical identity, and sanitizes internal errors',async()=>{const f=await fixture();f.loops.current.mockResolvedValueOnce({...current(),seed:'canary'} as never);const r=await f.request(f.browser,'GET','/api/matches/match/loop/current');expect(r.statusCode).toBe(500);expect(r.body+f.logs.join()).not.toContain('canary');f.loops.history.mockResolvedValueOnce({schemaVersion:1,kind:'loop_aftermath',matchId:'match',turnNumber:2,aftermath:{schemaVersion:2,matchId:'match',state:'RESOLVED',formations:[],battles:[]}});expect((await f.request(f.browser,'GET','/api/matches/match/loop/turns/1/aftermath')).statusCode).toBe(500);f.loops.current.mockRejectedValueOnce(new MovementDraftError('NOT_FOUND'));expect((await f.request(f.browser,'GET','/api/matches/match/loop/current')).statusCode).toBe(404)});
});

it('rejects client-supplied city charge and ownership before dispatching an authenticated command',async()=>{
 const {CITY_PROFILE,CITY_BALANCE_V1,CityCurrentSchema}=await import('@strategy-game/shared-types');
 const f=await fixture(),path='/api/matches/match/loop/turns/1/commands';
 const draft={schemaVersion:3,profile:CITY_PROFILE,turnNumber:1,expectedRevision:0,kind:'city_edit',
  edit:{kind:'recruit',cityId:'madrid',recruitmentId:'37d5bdee-08c1-4af6-b120-17a05ca161ff',unitType:'INFANTRY',quantity:1}};
 for(const injection of [{paid:0},{ownerPlayerId:'opponent'},{arrivalTurn:1}]){
  expect((await f.request(f.browser,'POST',path,{...draft,edit:{...draft.edit,...injection}})).statusCode).toBe(400);
 }
 expect(f.loops.command).not.toHaveBeenCalled();
 const view=CityCurrentSchema.parse({...current(1,1),schemaVersion:3,profile:CITY_PROFILE,
  balance:{...CITY_BALANCE_V1,startingCredits:2000},
  cityPlan:{credits:1900,recruitment:[],dispatches:[],commanders:[]},
  cities:['madrid','andorra-la-vella','bilbao'].map(cityId=>({cityId,name:cityId,capital:cityId!=='bilbao',
   position:{x:100,y:100},owned:cityId==='madrid',neutral:cityId==='bilbao',garrisonId:null,commanderId:null}))});
 f.loops.command.mockResolvedValueOnce(view as never);
 const response=await f.request(f.browser,'POST',path,draft);
 expect(response.statusCode).toBe(200);
 expect(response.headers['cache-control']).toBe('no-store');
 expect(f.loops.command).toHaveBeenCalledExactlyOnceWith('match',1,f.browser.identityId,draft);
});
