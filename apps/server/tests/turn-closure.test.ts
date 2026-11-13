import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MovementDraftError } from "@strategy-game/database";
import { lobbyFixture } from "./lobby-fixture.js";
import { MemoryAuth } from "./memory-auth.js";
import { buildApp } from "../src/app.js";
import { deadlineWorker, deadlineWorkerConfig } from "../src/turns/deadline-worker.js";
const apps: FastifyInstance[]=[];
afterEach(async()=>{vi.useRealTimers();for(const app of apps.splice(0))await app.close()});
const path="/api/matches/match/turns/1/ready", body={schemaVersion:1,expectedRevision:0,ready:true};
async function fixture(){
 const accounts=new MemoryAuth(),setReady=vi.fn(async()=>({schemaVersion:1 as const,matchId:"match",state:"READY" as const,
 turn:{schemaVersion:1 as const,gameId:"match",turnNumber:1,status:"open" as const,openedAtMs:1000,deadlineAtMs:2000},
 own:{schemaVersion:1 as const,gameId:"match",turnNumber:1,revision:1,ready:true,orders:[]}}));
 const f=await lobbyFixture(accounts,{} as never,undefined,undefined,undefined,undefined,undefined,{setReady});apps.push(f.app);
 return {...f,browser:await f.login(),accounts,setReady};
}
describe("production closure HTTP boundary",()=>{
 it("derives the actor from the persisted signed session and returns only own fields",async()=>{
  const f=await fixture(),r=await f.request(f.browser,"POST",path,body);expect(r.statusCode).toBe(200);
  expect(f.setReady).toHaveBeenCalledExactlyOnceWith("match",1,f.browser.identityId,body);
  expect(r.headers).toMatchObject({"cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff"});
  expect(r.body).not.toMatch(/playerId|runtimeProfile|worldSeed|frozen|players/);
 });
 it.each(["anonymous","revoked","expired","onboarding"])("denies %s before persistence",async(kind)=>{
  const f=await fixture();if(kind==="anonymous")f.browser.cookie="";
  if(kind==="revoked")await f.accounts.revokeAllSessions(f.browser.identityId);
  if(kind==="expired")for(const [id,s]of f.accounts.sessions)f.accounts.sessions.set(id,{...s,expiresAt:new Date(0)});
  if(kind==="onboarding")f.browser=await f.login(null);
  expect((await f.request(f.browser,"POST",path,body)).statusCode).toBe(kind==="onboarding"?403:401);expect(f.setReady).not.toHaveBeenCalled();
 });
 it.each(["origin","csrf"])("requires exact %s",async(kind)=>{
  const f=await fixture(),r=await f.app.inject({method:"POST",url:path,payload:body,headers:{cookie:f.browser.cookie,origin:kind==="origin"?"https://foreign.invalid":"http://127.0.0.1:5173","x-csrf-token":kind==="csrf"?"forged":f.browser.csrf}});
  expect(r.statusCode).toBe(403);expect(f.setReady).not.toHaveBeenCalled();
 });
 it.each([{...body,ready:"true"},{...body,expectedRevision:-1},{...body,schemaVersion:2},{...body,identityId:"enemy"},{...body,orders:[]},{...body,now:1000}])("rejects strict input %j",async(input)=>{
  const f=await fixture();expect((await f.request(f.browser,"POST",path,input)).statusCode).toBe(400);expect(f.setReady).not.toHaveBeenCalled();
 });
 it.each(["01","0","NaN","1.5","9007199254740992"])("rejects invalid turn %s",async(n)=>{
  const f=await fixture();expect((await f.request(f.browser,"POST",path.replace("turns/1/",`turns/${n}/`),body)).statusCode).toBe(400);expect(f.setReady).not.toHaveBeenCalled();
 });
 it.each(["READY_LOCKED","READY_UNCHANGED","STALE_REVISION","TURN_CLOSED","UNSUPPORTED_RUNTIME","NOT_FOUND"] as const)("sanitizes %s",async(code)=>{
  const f=await fixture();f.setReady.mockRejectedValue(new MovementDraftError(code));const r=await f.request(f.browser,"POST",path,body);
  expect(r.statusCode).toBe(code==="NOT_FOUND"?404:409);expect(r.json()).toEqual({schemaVersion:1,error:code});
 });
 it("rejects query input and scrubs unexpected storage failures",async()=>{
  const f=await fixture();expect((await f.request(f.browser,"POST",path+"?now=1",body)).statusCode).toBe(400);
  f.setReady.mockRejectedValue(new Error("private-player-orders"));const r=await f.request(f.browser,"POST",path,body);expect(r.statusCode).toBe(500);expect(r.body+f.logs.join()).not.toContain("private-player-orders");
 });
 it("keeps existing rate limits and has no resolution/Turn2 route",async()=>{
  const f=await fixture();expect((await f.request(f.browser,"POST",path.replace("ready","resolve"),body)).statusCode).toBe(404);
  let r=await f.request(f.browser,"POST",path,body);for(let i=0;i<65&&r.statusCode!==429;i++)r=await f.request(f.browser,"POST",path,body);expect(r.statusCode).toBe(429);
 });
 it("does not register the endpoint without authentication",async()=>{
  const app=await buildApp({turnReady:{setReady:vi.fn()}});apps.push(app);expect((await app.inject({method:"POST",url:path,payload:body})).statusCode).toBe(404);
 });
});
describe("bounded in-process deadline worker",()=>{
 it("starts and stops through the production Fastify hook order without listening or a database",async()=>{
  vi.useFakeTimers();const app=await buildApp();const store={dueMatches:vi.fn(async()=>[]),closeDue:vi.fn(async()=>false)};
  const worker=deadlineWorker(store,deadlineWorkerConfig({}),vi.fn());app.addHook("onReady",async()=>worker.start());app.addHook("onClose",async()=>worker.stop());
  await app.ready();await vi.advanceTimersByTimeAsync(0);expect(store.dueMatches).toHaveBeenCalledOnce();await app.close();await vi.advanceTimersByTimeAsync(2000);expect(store.dueMatches).toHaveBeenCalledOnce();
 });
 it.each(["TURN_DEADLINE_INTERVAL_MS","TURN_DEADLINE_BATCH_SIZE","TURN_DEADLINE_TIMEOUT_MS"])("validates %s",(key)=>{
  for(const bad of ["0","NaN","1.5","100000000","-1",""])expect(()=>deadlineWorkerConfig({[key]:bad})).toThrow();
  expect(deadlineWorkerConfig({})).toEqual({intervalMs:1000,batchSize:20,timeoutMs:5000});
 });
 it("bounds batch, skips overlap, catches failures, waits for shutdown and catches up after restart",async()=>{
  vi.useFakeTimers();let finish:()=>void=()=>{};const store={dueMatches:vi.fn(async()=>["a","b","c"]),closeDue:vi.fn(()=>new Promise<boolean>(r=>{finish=()=>r(true)}))},warn=vi.fn();
  const worker=deadlineWorker(store,{intervalMs:100,batchSize:1,timeoutMs:500},warn);worker.start();worker.start();
  await vi.advanceTimersByTimeAsync(0);expect(store.dueMatches).toHaveBeenCalledExactlyOnceWith(1);expect(store.closeDue).toHaveBeenCalledWith("a",500);
  await vi.advanceTimersByTimeAsync(1000);expect(store.dueMatches).toHaveBeenCalledTimes(1);
  let done=false;const stopped=worker.stop().then(()=>{done=true});await Promise.resolve();expect(done).toBe(false);finish();await stopped;
  await vi.advanceTimersByTimeAsync(1000);expect(store.dueMatches).toHaveBeenCalledTimes(1);
  store.closeDue.mockImplementation(async()=>{throw Error("private")});worker.start();await vi.advanceTimersByTimeAsync(0);expect(warn).toHaveBeenCalledTimes(1);await worker.stop();
 });
});
