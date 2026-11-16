import {expect,test,vi} from 'vitest';
import {QueueAuthority} from '../overnight-policy.ts';
import {QueueJournal,GitHubQueueStore,QUEUE_REF,emptyLedger,validateQueueLedger} from '../overnight-ledger.ts';
import {runOfflineQueue,morningReport,type OfflineQueueAdapters} from '../overnight-queue.ts';
import {sha256,REPOSITORY} from '../codex-automation-policy.ts';
import {manifest,MemoryStore,now,api,enrollment,signature,bytes,trigger,adapters,proposal} from './overnight-fixture.ts';
import type {GitHubTransport} from '../codex-github-control.ts';
const setup=(count=3)=>{
  const m=manifest(count),store=new MemoryStore(),journal=new QueueJournal(store),calls:string[]=[],a=adapters(calls);
  const authority=new QueueAuthority(api(m),enrollment,bytes(m),signature(m),trigger);
  const run=(custom:OfflineQueueAdapters=a)=>runOfflineQueue(authority,journal,'123',custom,()=>now);
  return {m,store,journal,calls,a,authority,run};
};
test('disabled queue touches neither ledger nor execution adapters',async()=>{
  const store=new MemoryStore(),journal=new QueueJournal(store),a=adapters();const agent=vi.spyOn(a,'agent');
  const result=await runOfflineQueue({runId:'123',async check(){return {version:1,repository:REPOSITORY,enabled:false,tasks:[]}}},journal,'123',a);
  expect(result.status).toBe('disabled');expect(store.revision).toBe(0);expect(agent).not.toHaveBeenCalled();
});
test('three tasks execute strictly sequentially with a durable reservation before each boundary',async()=>{
  const f=setup();let active=0,maxActive=0;
  const original=f.a.agent;
  f.a.agent=async c=>{expect(f.store.ledger.runs[0]!.tasks[c.index]!.phase).toBe('agent_running');expect(f.store.ledger.active).not.toBeNull();active++;maxActive=Math.max(maxActive,active);const v=await original(c);active--;return v};
  const r=await f.run();expect(r.status).toBe('completed');expect(maxActive).toBe(1);
  expect(f.calls).toEqual([101,102,103].flatMap(id=>['prepare','agent','validate','publish'].map(s=>s+':'+id)));
  expect(f.store.ledger.active).toBeNull();expect(f.store.ledger.runs[0]!.tasks.every(t=>t.pr!==null&&t.receipt?.checks.length===4&&t.terminated)).toBe(true);
  expect(f.store.history.flatMap(h=>h.runs.flatMap(r=>r.tasks)).every(t=>t.sessions<=1)).toBe(true);
  expect(f.store.ledger.runs[0]!.tasks.map(t=>t.sessions)).toEqual([1,1,1]);
});
test.each(['prepare','agent','validate','publish'] as const)('failure in %s blocks every later task without retry',async(stage)=>{
  const f=setup();
  f.a[stage]=async()=>{throw Error('unsafe diagnostic must not escape')};
  const result=await f.run();expect(result.status).toBe('failed');expect(f.store.ledger.runs[0]!.tasks.map(t=>t.phase)).toEqual(['failed','stopped','stopped']);
  expect(f.calls.every(c=>c.endsWith(':101'))).toBe(true);expect(f.store.ledger.active).not.toBeNull();
  expect(JSON.stringify(f.store.ledger)).not.toContain('unsafe diagnostic');
});
test('second task failure preserves first draft and blocks third',async()=>{
  const f=setup(),agent=f.a.agent;f.a.agent=async c=>{if(c.index===1)throw Error('failed');return agent(c)};
  expect((await f.run()).status).toBe('failed');expect(f.store.ledger.runs[0]!.tasks.map(t=>t.phase)).toEqual(['draft_pr_created','failed','stopped']);
  expect(f.calls).not.toContain('prepare:103');expect(f.store.ledger.runs[0]!.tasks[0]!.pr?.number).toBe(201);
});
test('a timeout aborts the adapter, retains exclusion and never starts a replacement',async()=>{
  vi.useFakeTimers();try{
    const f=setup();let signal:AbortSignal|undefined;
    f.a.agent=async c=>{signal=c.signal;return new Promise(()=>{})};
    const running=f.run();await vi.advanceTimersByTimeAsync(900001);
    expect((await running).status).toBe('failed');expect(signal?.aborted).toBe(true);
    expect(f.store.ledger.active).not.toBeNull();expect(f.store.ledger.runs[0]!.tasks.map(t=>t.sessions)).toEqual([1,0,0]);
  }finally{vi.useRealTimers()}
});
test('the one-night end bounds a session even when its per-task allowance is longer',async()=>{
  vi.useFakeTimers();try{
    const f=setup();let clock=now,signal:AbortSignal|undefined;
    f.a.prepare=async()=>{clock=new Date(Date.parse(f.m.endsAt)-5000)};
    f.a.agent=async c=>{signal=c.signal;return new Promise(()=>{})};
    const running=runOfflineQueue(f.authority,f.journal,'123',f.a,()=>clock);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await running).status).toBe('failed');expect(signal?.aborted).toBe(true);
    expect(f.store.ledger.runs[0]!.tasks.map(t=>t.sessions)).toEqual([1,0,0]);
    expect(f.store.ledger.active).not.toBeNull();
  }finally{vi.useRealTimers()}
});
test.each(['receipt-forged','reconstruction-only','checks-missing','check-failed','digest-missing','job-failed','wrong-run','wrong-tree'])(
  '%s cannot reach publication',async(kind)=>{
    const f=setup(),publish=vi.spyOn(f.a,'publish');
    f.a.validate=async c=>{
      const v=proposal(c.manifest,c.task).validation;
      if(kind==='digest-missing')return {...v,trustedJob:{...v.trustedJob,receiptDigest:''}};
      if(kind==='job-failed')return {...v,trustedJob:{...v.trustedJob,conclusion:'failure' as 'success'}};
      if(kind==='wrong-run')return {...v,trustedJob:{...v.trustedJob,runId:'999'}};
      const receipt=JSON.parse(Buffer.from(v.bytes).toString()) as Record<string,unknown>;
      if(kind==='reconstruction-only')return {...v,bytes:Buffer.from(JSON.stringify({result:'RECONSTRUCTED_NO_EXECUTION'}))};
      if(kind==='checks-missing')receipt.checks=[];
      if(kind==='check-failed')receipt.checks=[{command:'build',status:'failed',exitCode:1}];
      if(kind==='wrong-tree')receipt.treeSha='e'.repeat(40);
      const changed=Buffer.from(JSON.stringify(receipt)+' ');
      return {bytes:changed,trustedJob:{...v.trustedJob,receiptDigest:kind==='receipt-forged'?v.trustedJob.receiptDigest:sha256(changed)}};
    };
    expect((await f.run()).status).toBe('failed');expect(publish).not.toHaveBeenCalled();
  });
test.each(['draft','tree','source','url'])(
  'publisher %s mismatch stops continuation and never repeats publication',async(kind)=>{
    const f=setup(),original=f.a.publish,calls:string[]=[];
    f.a.publish=async(...args)=>{calls.push('publish');const p=await original(...args);
      return {...p,...(kind==='draft'?{draft:false as true}:{}),...(kind==='tree'?{treeSha:'f'.repeat(40)}:{}),...(kind==='source'?{sourceSha:'f'.repeat(40)}:{}),...(kind==='url'?{url:'https://attacker.invalid/pull/1'}:{})};
    };
    expect((await f.run()).status).toBe('failed');expect(calls).toEqual(['publish']);expect(f.calls).not.toContain('prepare:102');
  });
test('missing confirmed termination prevents validation and keeps the global lock',async()=>{
  const f=setup(),agent=f.a.agent,validate=vi.spyOn(f.a,'validate');
  f.a.agent=async c=>({...await agent(c),terminationConfirmed:false as true});
  expect((await f.run()).status).toBe('failed');expect(validate).not.toHaveBeenCalled();expect(f.store.ledger.active).not.toBeNull();
});
test('live main/scope approval is checked again after prepare, before reserving a session',async()=>{
  const f=setup();let checks=0;const check=f.authority.check.bind(f.authority);
  f.authority.check=async(...args)=>{if(++checks===3)throw Error('revoked');return check(...args)};
  expect((await f.run()).status).toBe('failed');expect(f.calls).toEqual(['prepare:101']);expect(f.store.ledger.runs[0]!.tasks[0]!.sessions).toBe(0);
});
test('duplicate simultaneous dispatch reserves once; no provider work in CAS retries',async()=>{
  const f=setup(),outcomes=await Promise.allSettled([f.run(),f.run()]);
  expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.calls.filter(c=>c==='agent:101')).toHaveLength(1);
});
test.each(['queue','pilot'] as const)('global %s claim excludes every other queue/pilot and never expires',async(kind)=>{
  const f=setup();await f.journal.reserve(f.m,'123',now,kind);
  const other={...f.m,queueId:'other-night',authorizationId:'other-auth'};
  await expect(f.journal.reserve(other,'124',new Date(now.getTime()+86400000),kind==='pilot'?'queue':'pilot')).rejects.toThrow('queue-already-claimed');
  expect(f.store.ledger.active?.runId).toBe('123');
});
test('runner crash after irrevocable start cannot resume or rerun a paid task',async()=>{
  const f=setup();await f.journal.reserve(f.m,'123',now);
  await f.journal.step(f.m.queueId,'123',0,'pending','preparing',now);
  await f.journal.step(f.m.queueId,'123',0,'preparing','agent_running',now);
  const restarted=new QueueJournal(f.store);
  await expect(restarted.reserve(f.m,'124',now)).rejects.toThrow();
  await expect(restarted.step(f.m.queueId,'123',0,'preparing','agent_running',now)).rejects.toThrow();
  expect(morningReport(await restarted.snapshot(),f.m.queueId)).toContain('UNKNOWN');
});
test('completed authorization and task approvals cannot be recycled under a new run or queue ID',async()=>{
  const f=setup(1);expect((await f.run()).status).toBe('completed');
  await expect(f.journal.reserve({...f.m,queueId:'new-night',authorizationId:'new-auth'},'999',now)).rejects.toThrow();
});
test('authenticated session ID is durable before completion and cannot switch',async()=>{
  const f=setup();await f.journal.reserve(f.m,'123',now);
  await f.journal.step(f.m.queueId,'123',0,'pending','preparing',now);
  await f.journal.step(f.m.queueId,'123',0,'preparing','agent_running',now);
  await f.journal.observeSession(f.m.queueId,'123',0,'sess_observed');
  expect((await new QueueJournal(f.store).snapshot()).runs[0]!.tasks[0]!.sessionId).toBe('sess_observed');
  await expect(f.journal.observeSession(f.m.queueId,'123',0,'sess_changed')).rejects.toThrow();
  await expect(f.journal.step(f.m.queueId,'123',0,'agent_running','validating',now,{sessionId:'sess_changed'})).rejects.toThrow();
});
test('controller run cannot substitute a different identity for authenticated trigger',async()=>{
  const f=setup();await expect(runOfflineQueue(f.authority,f.journal,'999',f.a,()=>now)).rejects.toThrow('queue-run-binding');expect(f.calls).toEqual([]);
});
test('ledger loss is not empty state and blocks all adapters',async()=>{
  const f=setup();f.store.read=async()=>{throw Error('unavailable')};await expect(f.run()).rejects.toThrow('unavailable');expect(f.calls).toEqual([]);
});
test('uncertain persistence after publication leaves one remote attempt and an owner-reconciliation lock',async()=>{
  const f=setup(),cas=f.store.compareAndSwap.bind(f.store);let writes=0;
  f.store.compareAndSwap=async(...args)=>{if(++writes>=6)throw Error('lost response');return cas(...args)};
  await expect(f.run()).rejects.toThrow();expect(f.calls.filter(c=>c==='publish:101')).toHaveLength(1);
  expect(f.store.ledger.active).not.toBeNull();expect(f.store.ledger.runs[0]!.tasks[0]!.phase).toBe('publishing');
});
test('report distinguishes completion, failure, blocked work and unknown costs/counts',async()=>{
  const f=setup(),agent=f.a.agent;f.a.agent=async c=>{if(c.index===1)throw Error('bad');return agent(c)};await f.run();
  const report=morningReport(f.store.ledger,f.m.queueId);
  expect(report).toContain('/pull/201');expect(report).toContain('State: failed');expect(report).toContain('State: stopped');expect(report).toContain('not started');
  expect(report).toContain('build: passed, typecheck: passed, test: passed, lint: passed');expect(report).toContain('Test case counts: UNKNOWN');
  expect(report).toContain('Provider usage/billing: UNKNOWN');expect(report).toContain('No PR was merged or deployed');
});
test('GitHub ledger uses immutable reads and nonce-bearing non-forced CAS commits',async()=>{
  const requests:{method:string;path:string;body?:unknown}[]=[],l=emptyLedger(),parents=new Map<string,string[]>();let sha='a'.repeat(40),commits=0;
  const api:GitHubTransport={async request(method,path,body){
    requests.push({method,path,...(body===undefined?{}:{body})});
    if(method==='GET'&&path.startsWith('/git/ref/'))return {status:200,data:{ref:`refs/heads/${QUEUE_REF}`,object:{sha}}};
    if(method==='GET'&&path.includes('/contents/'))return {status:200,data:{type:'file',encoding:'base64',size:bytes(l).length,content:bytes(l).toString('base64')}};
    if(path==='/git/trees')return {status:201,data:{sha:'b'.repeat(40)}};
    if(path==='/git/commits'){commits++;const id=String(commits).repeat(40);parents.set(id,(body as {parents:string[]}).parents);return {status:201,data:{sha:id}}}
    if(method==='PATCH'){const next=(body as {sha:string}).sha;if(parents.get(next)?.[0]!==sha)return {status:422,data:{}};sha=next;return {status:200,data:{object:{sha:next}}}}
    return {status:500,data:{}};
  }};
  const s=new GitHubQueueStore(api),read=await s.read();expect(read.revision).toBe('a'.repeat(40));
  expect(await s.compareAndSwap(read.revision,l)).toBe(true);expect(await s.compareAndSwap(read.revision,l)).toBe(false);
  const writes=requests.filter(r=>r.path==='/git/commits').map(r=>r.body as {message:string;parents:string[]});
  expect(writes[0]!.message).not.toBe(writes[1]!.message);expect(writes.every(w=>w.parents[0]===read.revision)).toBe(true);
  expect(requests.filter(r=>r.method==='PATCH').every(r=>(r.body as {force:boolean}).force===false)).toBe(true);
  expect(requests.some(r=>r.path.includes('ref='+read.revision))).toBe(true);
});
test.each([409,422,500])('GitHub CAS response %i never triggers an automatic write retry',async(status)=>{
  let updates=0;
  const s=new GitHubQueueStore({async request(method,path){
    if(path==='/git/trees'||path==='/git/commits')return {status:201,data:{sha:'b'.repeat(40)}};
    if(method==='PATCH'){updates++;return {status,data:{}}}return {status:404,data:{}};
  }});
  if(status===500)await expect(s.compareAndSwap('a'.repeat(40),emptyLedger())).rejects.toThrow();
  else expect(await s.compareAndSwap('a'.repeat(40),emptyLedger())).toBe(false);
  expect(updates).toBe(1);
});
test('GitHub missing ledger refuses read; explicit bootstrap refuses an existing ref',async()=>{
  await expect(new GitHubQueueStore({async request(){return {status:404,data:{}}}}).read()).rejects.toThrow();
  await expect(new GitHubQueueStore({async request(){return {status:200,data:{}}}}).bootstrap()).rejects.toThrow();
});
test('ledger validator rejects unsafe transitions, malformed receipts and missing PRs',async()=>{
  const f=setup(1);await f.run();
  const bad=structuredClone(f.store.ledger);bad.runs[0]!.tasks[0]!.pr=null;expect(()=>validateQueueLedger(bad)).toThrow();
  const broken=structuredClone(f.store.ledger);broken.runs[0]!.tasks[0]!.receipt!.checks=[];expect(()=>validateQueueLedger(broken)).toThrow();
});
test('offline happy path makes no actual HTTP/provider request',async()=>{
  const network=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{throw Error('live network forbidden')});
  try{const f=setup();expect((await f.run()).status).toBe('completed');expect(network).not.toHaveBeenCalled()}finally{network.mockRestore()}
});
test('local inspection CLI reports disabled state and offers no launch command',async()=>{
  const {inspect}=await import('../overnight-inspect.ts');
  expect(inspect(['manifest',new URL('../../config/overnight-queue.disabled.json',import.meta.url).pathname])).toContain('Queue DISABLED');
  expect(()=>inspect(['launch','anything'])).toThrow();
});

test('OVERNIGHT-REPORT-001 reports successful coding separately from confirmed termination',async()=>{
  const f=setup(1);await f.run();const before=structuredClone(f.store.ledger);
  const report=morningReport(f.store.ledger,f.m.queueId);
  expect(report).toContain('Coding: completion verified.');expect(report).toContain('Provider termination: confirmed.');
  expect(report).toContain('Session ID: sess_101.');expect(report).toContain('Draft PR: https://github.com/'+REPOSITORY+'/pull/201');
  expect(f.store.ledger).toEqual(before);
});
test.each(['failed','stopped'] as const)('OVERNIGHT-REPORT-001 never promotes %s tasks even with prior completion evidence',async(phase)=>{
  const f=setup(1);await f.run();const ledger=structuredClone(f.store.ledger),r=ledger.runs[0]!,t=r.tasks[0]!;
  r.status=phase;t.phase=phase;t.pr=null;t.reason=phase==='stopped'?'canceled':'boundary-failed-or-uncertain';
  t.terminationReceipt='a'.repeat(64);validateQueueLedger(ledger);
  const report=morningReport(ledger,f.m.queueId);
  expect(report).toContain(phase==='failed'?'Coding: success not verified (task failed).':'Coding: success not verified (task stopped or canceled).');
  expect(report).toContain('Provider termination: confirmed.');expect(report).toContain('Session ID: sess_101.');
  expect(report).not.toMatch(/Coding: (?:completed|completion verified)/);
});
test('OVERNIGHT-REPORT-001 owner-reconciled uncertain coding stays stopped and never becomes successful',async()=>{
  const f=setup(1);await f.journal.reserve(f.m,'123',now);
  await f.journal.step(f.m.queueId,'123',0,'pending','preparing',now);await f.journal.step(f.m.queueId,'123',0,'preparing','agent_running',now);
  await f.journal.observeSession(f.m.queueId,'123',0,'opaque-failed-session');await f.journal.fail(f.m.queueId,'123',0,now);
  const revision=(await f.store.read()).revision;
  await f.journal.reconcileStop(revision,f.m.queueId,'123','owner-report-regression','a'.repeat(64),['opaque-failed-session'],[],now);
  const before=structuredClone(f.store.ledger),report=morningReport(f.store.ledger,f.m.queueId);
  expect(report).toContain('Status: stopped.');expect(report).toContain('Coding: success not verified (task stopped or canceled).');
  expect(report).toContain('Session ID: opaque-failed-session.');expect(report).toContain('Provider termination: confirmed.');
  expect(report).toContain('Validation: no verified successful receipt.');expect(report).not.toMatch(/Coding: (?:completed|completion verified)/);
  expect(f.store.ledger).toEqual(before);
});
test.each([false,true])('OVERNIGHT-REPORT-001 active uncertain coding stays unverified with termination=%s',async(terminated)=>{
  const f=setup(1);await f.journal.reserve(f.m,'123',now);
  await f.journal.step(f.m.queueId,'123',0,'pending','preparing',now);await f.journal.step(f.m.queueId,'123',0,'preparing','agent_running',now);
  const ledger=structuredClone(f.store.ledger);ledger.runs[0]!.tasks[0]!.terminated=terminated;validateQueueLedger(ledger);
  const report=morningReport(ledger,f.m.queueId);
  expect(report).toContain('Coding: in progress or UNKNOWN; success not verified.');expect(report).toContain('Session ID: UNKNOWN.');
  expect(report).not.toMatch(/Coding: (?:completed|completion verified)/);
});
test('OVERNIGHT-REPORT-001 sealed successful coding remains distinct from pending publication',async()=>{
  const f=setup(1);await f.journal.reserve(f.m,'123',now);
  await f.journal.step(f.m.queueId,'123',0,'pending','preparing',now);await f.journal.step(f.m.queueId,'123',0,'preparing','agent_running',now);
  await f.journal.step(f.m.queueId,'123',0,'agent_running','validating',now,{sessionId:'opaque-sealed-session',terminationReceipt:'a'.repeat(64)});
  const report=morningReport(await f.journal.snapshot(),f.m.queueId);
  expect(report).toContain('Coding: completion verified.');expect(report).toContain('Validation: no verified successful receipt.');
  expect(report).toContain('Draft PR: none confirmed;');expect(report).toContain('Session ID: opaque-sealed-session.');
});
test.each(['sk-proj-synthetic-secret','github_pat_synthetic_secret','ghp_synthetic_secret','Bearer_synthetic_secret','unsafe\nidentifier','x'.repeat(257)])(
  'OVERNIGHT-REPORT-001 withholds unsafe/credential-shaped session identifier %s',async(id)=>{
    const f=setup(1);await f.journal.reserve(f.m,'123',now);
    const ledger=structuredClone(f.store.ledger);ledger.runs[0]!.tasks[0]!.sessionId=id;
    const before=structuredClone(ledger),report=morningReport(ledger,f.m.queueId);
    expect(report).toContain('Session ID: WITHHELD (unsafe identifier).');expect(report).not.toContain(id);expect(ledger).toEqual(before);
  });
