import {expect,test,vi} from 'vitest';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {manualManifest} from '../overnight-manual.ts';
import {QueueAuthority,queueDeadline,parseManifest,signaturePayload,MANUAL_AGENT_WALL_SECONDS} from '../overnight-policy.ts';
import {control} from '../overnight-control.ts';
import {runQueueAgent} from '../overnight-agent.ts';
import {productionContext} from '../overnight-production.ts';
import {QueueSessionProvider} from '../overnight-provider.ts';
import {sha256} from '../codex-automation-policy.ts';
import {manifest,now,api,enrollment,signature,bytes,trigger,MemoryStore} from './overnight-fixture.ts';
import {productionFixture} from './overnight-production-fixture.ts';
import {QueueJournal} from '../overnight-ledger.ts';
const manual=()=>manualManifest(manifest(1),'a'.repeat(40));
test('manual approval removes calendar and coding allowances and signs the $50 Platform policy',()=>{
  const m=manual();expect(parseManifest(bytes(m))).toEqual(m);
  expect(m).toMatchObject({version:2,launchMode:'manual',softLimitUsd:50,spendPolicy:'platform-project-limit'});
  expect(m.tasks[0]!.codingSeconds).toBeNull();expect(m).not.toHaveProperty('startsAt');expect(m).not.toHaveProperty('endsAt');
  expect(signaturePayload(m)).toMatch(/^SOVEREIGN-OVERNIGHT-V2\n/);
  expect(m.tasks[0]!.allowedPaths).toEqual(manifest(1).tasks[0]!.allowedPaths);
});
test.each(['2026-11-17T01:00:00.000Z','2026-11-18T09:00:00.000Z','2027-03-14T07:30:00.000Z'])(
  'unused manual approval admits regardless of bedtime, date or DST: %s',async time=>{
    const m=manual(),a=new QueueAuthority(api(m),enrollment,bytes(m),signature(m),trigger);
    expect(await a.check(new Date(time),true)).toEqual(m);
    await expect(a.check(new Date(time),false)).rejects.toThrow('queue-runtime-exhausted');
  });
test('manual approval cannot be consumed by cron or a workflow rerun',async()=>{
  const m=manual();for(const e of [{...trigger,event:'schedule' as const},{...trigger,attempt:2}]){
    await expect(new QueueAuthority(api(m),enrollment,bytes(m),signature(m),e).check(now,true)).rejects.toThrow();
  }
});
test.each(['limit','policy','coding','tasks','extra','signature-version'])(
  'manual policy fails closed on %s drift',async kind=>{
    const m=manual();const changed=JSON.parse(JSON.stringify(m));
    if(kind==='limit')changed.softLimitUsd=100;
    if(kind==='policy')changed.spendPolicy='unlimited';
    if(kind==='coding')changed.tasks[0].codingSeconds=300;
    if(kind==='tasks')changed.tasks=manifest(2).tasks;
    if(kind==='extra')changed.ownerApproved=true;
    if(kind==='signature-version'){
      await expect(new QueueAuthority(api(m),enrollment,bytes(m),signature(manifest(1)),trigger).check(now,true)).rejects.toThrow('queue-owner-signature');
    }else expect(()=>parseManifest(bytes(changed))).toThrow();
  });
test('runtime origin is durable, does not roll forward at each stage, and duplicate approval cannot reset it',async()=>{
  const m=manual(),store=new MemoryStore(),j=new QueueJournal(store);
  await j.reserve(m,'123',now);
  expect(store.ledger.runs[0]!.startedAt).toBe(now.toISOString());
  const a=new QueueAuthority(api(m),enrollment,bytes(m),signature(m),trigger);
  expect(await a.check(new Date(now.getTime()+3600000),false,now.toISOString())).toEqual(m);
  await expect(a.check(new Date(now.getTime()-1),false,now.toISOString())).rejects.toThrow();
  await expect(a.check(new Date(queueDeadline(m,now.toISOString())),false,now.toISOString())).rejects.toThrow();
  await expect(j.reserve({...m,queueId:'other-id'},'124',new Date(now.getTime()+3600000))).rejects.toThrow('queue-already-claimed');
  expect(()=>queueDeadline(m)).toThrow('queue-runtime-origin');
});
test('owner preparation uses stable one-use IDs across repeated preparations',()=>{
  expect(manual()).toEqual(manual());
  expect(()=>manualManifest(manifest(2),'a'.repeat(40))).toThrow('manual-single-task');
});
test('manual task can finish after 300 seconds, seal termination, validate and publish exactly one draft',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  const f=productionFixture(1,m=>manualManifest(m,m.baselineSha)),out=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  let clock=now;const time=()=>clock;
  try{
    await control('intake',f.env,f.api,time,f.repo);
    await control('prepare',f.env,f.api,time,f.repo);
    f.env.EXPECTED_ARCHIVE_SHA256=sha256(readFileSync(join(f.runner,'sovereign-pilot','source.tar.gz')));
    f.env.GITHUB_JOB='agent';f.env.OPENAI_API_KEY='synthetic';
    await runQueueAgent(f.env,f.api,async(url,init)=>{
      if(url.endsWith('/sessions')){clock=new Date(now.getTime()+3600000);vi.setSystemTime(clock)}
      return f.providerFetch(url,init);
    },time);delete f.env.OPENAI_API_KEY;
    const state=readFileSync(join(f.runner,'sovereign-pilot','provider-state.json')),dir=join(f.runner,'sovereign-pilot','state');
    mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'provider-state.json'),state);f.env.EXPECTED_AGENT_STATE_SHA256=sha256(state);
    f.env.GITHUB_JOB='seal';await control('seal',f.env,f.api,time,f.repo);
    f.validation();f.env.GITHUB_JOB='publish';await control('publish',f.env,f.api,time,f.repo,f.githubFetch);
    expect(f.ledger().runs[0]!.status).toBe('completed');expect(f.pr()!.draft).toBe(true);
    expect(f.providerCalls.filter(c=>c.url.endsWith('/sessions'))).toHaveLength(1);
    expect(f.providerCalls.some(c=>c.method==='DELETE')).toBe(true);
    expect(f.calls.filter(c=>c.path==='/pulls'&&c.method==='POST')).toHaveLength(1);
    await expect(control('intake',f.env,f.api,time,f.repo)).rejects.toThrow('queue-already-claimed');
  }finally{out.mockRestore();f.cleanup();vi.useRealTimers()}
});
test('manual context rejects tampering with the durable runtime scope',async()=>{
  const f=productionFixture(1,m=>manualManifest(m,m.baselineSha));
  try{
    await control('intake',f.env,f.api,()=>now,f.repo);
    f.ledger().runs[0]!.startedAt=new Date(now.getTime()-1000).toISOString();
    await expect(productionContext(f.api,f.env,now)).rejects.toThrow('queue-durable-claim');
  }finally{f.cleanup()}
});
test('long provider watchdog is available only in explicit manual mode',()=>{
  expect(()=>new QueueSessionProvider('synthetic',MANUAL_AGENT_WALL_SECONDS,async()=>{},()=>{})).toThrow('queue-provider-budget');
  expect(()=>new QueueSessionProvider('synthetic',MANUAL_AGENT_WALL_SECONDS,async()=>{},()=>{},undefined,Infinity,true)).not.toThrow();
});
test('manual workflow has no recurring trigger and no short agent timeout',()=>{
  const queue=readFileSync(new URL('../../.github/workflows/sovereign-overnight-queue.yml',import.meta.url),'utf8');
  expect(queue).toContain('workflow_dispatch:');expect(queue).not.toMatch(/schedule:|cron:|SOVEREIGN_OVERNIGHT_SCHEDULE_ENABLED/);
  const task=readFileSync(new URL('../../.github/workflows/sovereign-overnight-task.yml',import.meta.url),'utf8');
  expect(task.split('\n  agent:')[1]!.split('\n  seal:')[0]).toContain('timeout-minutes: 360');
});
