import { test, expect } from 'vitest';
import { canonicalScope, sha256, REPOSITORY, type TaskScope } from '../codex-automation-policy.ts';
import { RunController, BoundedResponsesGate, ControlDenied, validateLedger, reserveCost, boundedRequest,
  type RunLedger, type LedgerStore, type PriceCard, type LaunchEvidence } from '../codex-run-control.ts';

export const scope: TaskScope = {repository:REPOSITORY,issue:76,sourceSha:'a'.repeat(40),baseSha:'a'.repeat(40),
  approvedPaths:['packages/game-engine/src/combat.ts'],acceptanceDigest:'b'.repeat(64),expiresAt:'2026-11-15T00:00:00Z'};
export const project = 'proj_fixture';
export const initial = (): RunLedger => ({version:1,project,months:[{month:'2026-11',baselineMicroUsd:1_000_000,safetyMarginMicroUsd:1_000_000}],runs:[]});
class MemoryStore implements LedgerStore {
  ledger = initial(); revision = 0; failWrites = false;
  async read() { return {revision:String(this.revision),ledger:structuredClone(this.ledger)}; }
  async compareAndSwap(revision: string,ledger: RunLedger) {
    if (this.failWrites) throw new ControlDenied('fixture-storage-failed');
    if (revision !== String(this.revision)) return false;
    this.ledger = structuredClone(ledger); this.revision++; return true;
  }
}
const card: PriceCard = {model:'fixture-model',verifiedAt:'2026-11-14T00:00:00Z',expiresAt:'2026-11-15T00:00:00Z',
  inputMicroUsdPerMillion:2_000_000,outputMicroUsdPerMillion:10_000_000,maxInputTokens:100_000,maxOutputTokens:100};
export const evidence = (): LaunchEvidence => ({project,runId:'run-1',grantDigest:sha256(canonicalScope(scope)),
  now:'2026-11-14T20:00:00Z',exclusiveProjectRouting:true,keyProjectBindingVerified:true,isolatedWorkerVerified:true,immutableToolchainVerified:true,runtimeObservedAt:'2026-11-14T20:00:00Z',runMaxMicroUsd:1000000});
const request = JSON.stringify({model:card.model,input:'fixture',max_output_tokens:999999,store:true,service_tier:'priority'});
async function setup() {
  const store = new MemoryStore(); const ledger = new RunController(store,project);
  await ledger.claim(scope,'run-1','2026-11',1_000_000);
  let inferenceCalls = 0; let counted = 0; let current = evidence(); let failInference = false;
  const gate = new BoundedResponsesGate(scope,'run-1',project,card,ledger,{check:async()=>current},
    {countInputTokens:async()=>{counted++;return 10;},infer:async body=>{inferenceCalls++;if(failInference) throw Error('ambiguous fixture timeout');return body;}});
  return {store,ledger,gate,calls:()=>({inferenceCalls,counted}),setEvidence:(e:LaunchEvidence)=>{current=e;},fail:()=>{failInference=true;}};
}
test('whole run is durably reserved before per-request inference, with no refund',async()=>{
  const x=await setup();const result=await x.gate.request(request) as Record<string,unknown>;
  expect(result.max_output_tokens).toBe(100);expect(result.store).toBe(false);expect(result.service_tier).toBe('default');
  expect(x.store.ledger.runs[0]!.maxMicroUsd).toBe(1_000_000);
  expect(x.store.ledger.runs[0]!.requests[0]!).toEqual({id:'req-1',maxMicroUsd:1020,state:'settled'});
  await x.ledger.stop('run-1','finished');expect(x.store.ledger.runs[0]!.maxMicroUsd).toBe(1_000_000);
});
test('ambiguous inference failure retains full reservation and never automatically retries',async()=>{
  const x=await setup();x.fail();await expect(x.gate.request(request)).rejects.toThrow();
  expect(x.calls().inferenceCalls).toBe(1);expect(x.store.ledger.runs[0]!.requests[0]!.state).toBe('reserved');
});
test('failed durable write prevents any inference',async()=>{
  const x=await setup();x.store.failWrites=true;await expect(x.gate.request(request)).rejects.toThrow();expect(x.calls().inferenceCalls).toBe(0);
});
test('concurrent claims have one winner across independent controllers',async()=>{
  const store=new MemoryStore();const controllers=[new RunController(store,project),new RunController(store,project)];
  const results=await Promise.allSettled(controllers.map((c,i)=>c.claim(scope,`run-${i}`,'2026-11',100000)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(store.ledger.runs).toHaveLength(1);
});
test('duplicate source/scope run stays consumed after completion and across month rollover',async()=>{
  const x=await setup();await x.ledger.stop('run-1','finished');
  await expect(x.ledger.claim(scope,'run-2','2026-11',1)).rejects.toThrow('duplicate-run');
  await expect(x.ledger.claim({...scope,issue:77},'run-2','2026-12',1)).rejects.toThrow('uninitialized-month');
});
test('monthly cutoff includes baseline, margin and all full run reservations',async()=>{
  const store=new MemoryStore();store.ledger.months[0]!.baselineMicroUsd=43_000_000;
  await expect(new RunController(store,project).claim(scope,'one','2026-11',1_000_000)).rejects.toThrow('ledger-month-budget');
  expect(store.ledger.runs).toHaveLength(0);
});
test('cross-month and concurrent requests cannot exceed a run allowance',async()=>{
  const x=await setup();await expect(x.ledger.reserve('run-1','wrong-month','2026-12',1,sha256(canonicalScope(scope)),1000000)).rejects.toThrow();
  const results=await Promise.allSettled([x.ledger.reserve('run-1','a','2026-11',600000,sha256(canonicalScope(scope)),1000000),x.ledger.reserve('run-1','b','2026-11',600000,sha256(canonicalScope(scope)),1000000)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
test('replayed request identity cannot spend again after controller reconstruction',async()=>{
  const x=await setup();await x.gate.request(request);
  await expect(new RunController(x.store,project).reserve('run-1','req-1','2026-11',1,sha256(canonicalScope(scope)),1000000)).rejects.toThrow('duplicate-or-excess-request');
});
test('unknown key binding, isolation, exclusivity or toolchain proof blocks token count and inference',async()=>{
  for(const key of ['exclusiveProjectRouting','keyProjectBindingVerified','isolatedWorkerVerified','immutableToolchainVerified'] as const) {
    const x=await setup();x.setEvidence({...evidence(),[key]:undefined} as unknown as LaunchEvidence);
    await expect(x.gate.request(request)).rejects.toThrow('unverified-launch-boundary');expect(x.calls()).toEqual({inferenceCalls:0,counted:0});
  }
});
test('revocation after token count prevents a paid request',async()=>{
  const store=new MemoryStore();const ledger=new RunController(store,project);await ledger.claim(scope,'run-1','2026-11',100000);
  let count=0,paid=0;
  const gate=new BoundedResponsesGate(scope,'run-1',project,card,ledger,{check:async()=>{if(count)throw Error('revoked');return evidence();}},
    {countInputTokens:async()=>{count++;return 10;},infer:async()=>{paid++;}});
  await expect(gate.request(request)).rejects.toThrow('revoked');expect(paid).toBe(0);
});
test('expired prices, zero, fractional or excessive token counts are denied',async()=>{
  const x=await setup();x.setEvidence({...evidence(),now:'2026-11-16T00:00:00Z',runtimeObservedAt:'2026-11-16T00:00:00Z'});
  await expect(x.gate.request(request)).rejects.toThrow('expired-grant-or-price');
  for(const tokens of [0,-1,0.5,Infinity,100001]) expect(()=>reserveCost(tokens,card)).toThrow();
});
test('hosted tools, external content and hidden continuation state are denied',()=>{
  for(const body of [{model:card.model,input:[],previous_response_id:'old'},
    {model:card.model,input:[{type:'input_image',image_url:'https://fixture.invalid'}]},
    {model:card.model,input:'x',tools:[{type:'web_search'}]},
    {model:card.model,input:'x',tools:[{type:'namespace',tools:[]}]},
    {model:'different-model',input:'x'}]) expect(()=>boundedRequest(JSON.stringify(body),card)).toThrow();
  expect(()=>boundedRequest('null',card)).toThrow();expect(()=>boundedRequest('x'.repeat(2_000_001),card)).toThrow();
});
test('local function/custom tools are counted and retained without allowing provider-hosted tools',()=>{
  const body={model:card.model,input:'x',tools:[{type:'function',name:'fixture',parameters:{type:'object'}},{type:'custom',name:'fixture_patch'}]};
  expect(boundedRequest(JSON.stringify(body),card).tools).toEqual(body.tools);
});
test('malformed, corrupted and overspent ledger data fails closed',()=>{
  for(const mutate of [(l:RunLedger)=>{l.version=2 as 1;},(l:RunLedger)=>{l.months[0]!.baselineMicroUsd=NaN;},
    (l:RunLedger)=>{l.months[0]!.safetyMarginMicroUsd=0;},(l:RunLedger)=>{l.months=[];}]) {
    const l=initial();mutate(l);expect(()=>validateLedger(l)).toThrow();
  }
});
test('publisher claim is durable, one-shot, and requires a finished run',async()=>{
  const x=await setup();const digest='d'.repeat(64);
  await expect(x.ledger.claimPublication('run-1',digest,sha256(canonicalScope(scope)))).rejects.toThrow();await x.ledger.stop('run-1','finished');
  const outcomes=await Promise.allSettled([x.ledger.claimPublication('run-1',digest,sha256(canonicalScope(scope))),x.ledger.claimPublication('run-1',digest,sha256(canonicalScope(scope)))]);
  expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  await x.ledger.published('run-1',digest);await expect(x.ledger.claimPublication('run-1',digest,sha256(canonicalScope(scope)))).rejects.toThrow();
});

test('stale runtime observations and a grant budget mismatching the durable claim block paid inference',async()=>{
  const x=await setup();x.setEvidence({...evidence(),runtimeObservedAt:'2026-11-14T19:59:00Z'});
  await expect(x.gate.request(request)).rejects.toThrow('stale-runtime-proof');expect(x.calls().inferenceCalls).toBe(0);
  const y=await setup();y.setEvidence({...evidence(),runMaxMicroUsd:2000000});
  await expect(y.gate.request(request)).rejects.toThrow('run-inactive-or-month-changed');expect(y.calls().inferenceCalls).toBe(0);
  await expect(y.ledger.reserve('run-1','scope-mismatch','2026-11',1,'f'.repeat(64),1000000)).rejects.toThrow();
});
