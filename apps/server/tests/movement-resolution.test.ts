import{afterEach,describe,it,expect,vi}from"vitest";
import type{FastifyInstance}from"fastify";
import{TurnReadError}from"@strategy-game/database";
import type{ResolutionView}from"@strategy-game/shared-types";
import{lobbyFixture}from"./lobby-fixture.js";
import{MemoryAuth}from"./memory-auth.js";
const apps:FastifyInstance[]=[];afterEach(async()=>{for(const a of apps.splice(0))await a.close()});
const path='/api/matches/match/turns/1/resolution';
async function fixture(){const accounts=new MemoryAuth(),getResolution=vi.fn(async():Promise<ResolutionView>=>({schemaVersion:1,matchId:'match',state:'WAITING'}));
 const f=await lobbyFixture(accounts,{} as never,undefined,undefined,{getTurn:vi.fn(),getResolution});apps.push(f.app);return{...f,accounts,getResolution,browser:await f.login()}}
describe('participant-only observational movement results',()=>{
 it('uses only persisted session identity and an explicit own event cursor',async()=>{const f=await fixture(),r=await f.app.inject({url:path+'?eventOffset=256',headers:{cookie:f.browser.cookie}});expect(r.statusCode).toBe(200);expect(f.getResolution).toHaveBeenCalledExactlyOnceWith('match',f.browser.identityId,256);expect(r.headers['cache-control']).toBe('no-store');expect(r.headers['referrer-policy']).toBe('no-referrer')});
 it.each(['anonymous','revoked','onboarding'])('denies %s before result lookup',async(kind)=>{const f=await fixture();if(kind==='anonymous')f.browser.cookie='';if(kind==='revoked')await f.accounts.revokeAllSessions(f.browser.identityId);if(kind==='onboarding')f.browser=await f.login(null);expect((await f.request(f.browser,'GET',path)).statusCode).toBe(kind==='onboarding'?403:401);expect(f.getResolution).not.toHaveBeenCalled()});
 it.each(['eventOffset=-1','eventOffset=1.5','eventOffset=01','eventOffset=NaN','eventOffset=9007199254740992','playerId=enemy','schemaVersion=2','eventOffset=0&eventOffset=0'])('strictly rejects %s',async(query)=>{const f=await fixture();expect((await f.request(f.browser,'GET',path+'?'+query)).statusCode).toBe(400);expect(f.getResolution).not.toHaveBeenCalled()});
 it.each(['NOT_FOUND','INTERNAL_ERROR']as const)('sanitizes %s',async(code)=>{const f=await fixture();f.getResolution.mockRejectedValue(new TurnReadError(code));const r=await f.request(f.browser,'GET',path);expect(r.statusCode).toBe(code==='NOT_FOUND'?404:500);expect(r.json()).toEqual({schemaVersion:1,error:code})});
 it('rejects mutation and privileged execution endpoints',async()=>{const f=await fixture();for(const url of[path,path.replace('resolution','resolve'),path.replace('resolution','advance')])expect((await f.request(f.browser,'POST',url,{})).statusCode).toBe(404);expect(f.getResolution).not.toHaveBeenCalled()});
 it('retains rate limits',async()=>{const f=await fixture();let r=await f.request(f.browser,'GET',path);for(let n=0;n<65&&r.statusCode!==429;n++)r=await f.request(f.browser,'GET',path);expect(r.statusCode).toBe(429)});
 it('rejects accidental hidden fields from an adapter without logging them',async()=>{const f=await fixture();f.getResolution.mockResolvedValue({schemaVersion:1,matchId:'match',state:'WAITING',enemyOrder:'private-value'}as ResolutionView);const r=await f.request(f.browser,'GET',path);expect(r.statusCode).toBe(500);expect(r.body+f.logs.join()).not.toContain('private-value')});
});

describe('bounded shared lifecycle worker adapter',()=>{
 it('bounds and deduplicates persisted candidates, then closes before resolving',async()=>{
  const {movementLifecycleStore}=await import('../src/turns/deadline-worker.js'),calls:string[]=[];
  const store=movementLifecycleStore({dueMatches:vi.fn(async()=>['new','old','third']),closeDue:async()=>{calls.push('close');return true}},
   {dueMatches:vi.fn(async()=>['new']),resolveClosed:async()=>{calls.push('resolve');return true}});
  expect(await store.dueMatches(2)).toEqual(['new','old']);expect(await store.closeDue('new',5000)).toBe(true);expect(calls).toEqual(['close','resolve']);
 });
 it('does not resolve when closure/validation fails and leaves the candidate durable for later scan',async()=>{
  const {movementLifecycleStore}=await import('../src/turns/deadline-worker.js'),resolveClosed=vi.fn(async()=>true);
  const store=movementLifecycleStore({dueMatches:async()=>['a'],closeDue:async()=>{throw Error('injected')}},{dueMatches:async()=>[],resolveClosed});
  await expect(store.closeDue('a',5000)).rejects.toThrow('injected');expect(resolveClosed).not.toHaveBeenCalled();expect(await store.dueMatches(1)).toEqual(['a']);
 });
});
