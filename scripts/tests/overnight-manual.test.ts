import {expect,test,vi} from 'vitest';
import {parseManifest,QueueAuthority,taskScope,MANUAL_WATCHDOG_SECONDS,MANUAL_FORBIDDEN_PATHS,MANUAL_FORBIDDEN_OPERATIONS,type QueueManifest} from '../overnight-policy.ts';
import {manifest,signature,enrollment,trigger,api,bytes,resignTask} from './overnight-fixture.ts';
import {validPath,validScopePath,canonicalScope,sha256} from '../codex-automation-policy.ts';
import {HOSTED_MODEL,buildHostedSessionRequest,type HostedSessionRequest} from '../codex-hosted-agents.ts';
import {estimateSessionCost,verifyModelAccess,observeSessionCost} from '../overnight-cost.ts';
import {QueueSessionProvider} from '../overnight-provider.ts';
const manual=()=>{
  const m=manifest(1);m.forbiddenPaths=MANUAL_FORBIDDEN_PATHS;m.forbiddenOperations=MANUAL_FORBIDDEN_OPERATIONS;m.execution={mode:'manual-cost-v1',model:HOSTED_MODEL,softLimitMicroUsd:50000000};
  m.startsAt='2026-11-19T00:00:00.000Z';m.endsAt='2026-11-19T06:00:00.000Z';m.localDate='2026-11-18';
  m.tasks=[resignTask(m.tasks[0]!,{codingSeconds:MANUAL_WATCHDOG_SECONDS,allowedPaths:['database/prisma/schema.prisma','database/prisma/migrations/20261119_city/migration.sql','apps/web/src/city.css','docs/CITY_RECRUITMENT.md']})];
  return m;
};
const check=(m:QueueManifest,time='2026-11-19T02:00:00.000Z',event: 'workflow_dispatch'|'schedule'='workflow_dispatch')=>
  new QueueAuthority(api(m),enrollment,bytes(m),signature(m),{...trigger,event}).check(new Date(time),true);
test('manual signature permits an arbitrary start and later manual dispatch, frozen model/cost/scope',async()=>{
  const m=manual();expect(await check(m)).toEqual(m);
  expect(taskScope(m,m.tasks[0]!)).toMatchObject({profile:'city-feature-v1'});
});
test.each(['2026-11-18T23:59:59.999Z','2026-11-19T06:00:00.000Z'])( 'manual validity still rejects %s',async time=>expect(check(manual(),time)).rejects.toThrow());
test('manual policy cannot run from schedule',async()=>expect(check(manual(),undefined,'schedule')).rejects.toThrow('queue-manual-only'));
test.each(['model','limit','watchdog','multiple','window','mode'])( 'manual policy rejects %s drift',kind=>{
  const m=manual();
  if(kind==='model')Object.assign(m.execution!,{model:'gpt-6-astra'});
  if(kind==='limit')Object.assign(m.execution!,{softLimitMicroUsd:51000000});
  if(kind==='mode')Object.assign(m.execution!,{mode:'anything'});
  if(kind==='watchdog')m.tasks=[resignTask(m.tasks[0]!,{codingSeconds:MANUAL_WATCHDOG_SECONDS+1})];
  if(kind==='multiple')m.tasks=[...m.tasks,resignTask(m.tasks[0]!,{issue:500,approvalId:'other'})];
  if(kind==='window')m.endsAt='2026-11-19T06:00:00.001Z';
  expect(()=>parseManifest(bytes(m))).toThrow();
});
test('adding manual policy without owner re-signing fails signature verification',async()=>{
  const m=manifest(1),sig=signature(m);Object.assign(m,manual());
  await expect(new QueueAuthority(api(m),enrollment,bytes(m),sig,trigger).check(new Date('2026-11-19T02:00:00.000Z'),true)).rejects.toThrow('queue-owner-signature');
});
test.each(['scripts/controller.ts','.github/workflows/a.yml','AGENTS.md','database/AGENTS.md','apps/web/package.json','database/prisma/migrations/../migration.sql','docs/../README.md','apps/web/src/.env','apps/web/src/secrets/key.ts','apps/web/src/a\\b.ts','pnpm-lock.yaml'])( 'manual feature paths reject %s',p=>expect(validScopePath(p,'city-feature-v1')).toBe(false));
test.each(['database/prisma/schema.prisma','database/src/cities.ts','database/tests/cities.test.ts','database/prisma/migrations/20261119_city/migration.sql','docs/CITIES.md','apps/web/src/city.css'])( 'feature paths are explicitly gated: %s',p=>{
  expect(validPath(p)).toBe(false);expect(validScopePath(p,'city-feature-v1')).toBe(true);
});
test('feature profile is included in canonical scope digest',()=>{
  const m=manual(),s=taskScope(m,m.tasks[0]!);expect(JSON.parse(canonicalScope(s)).profile).toBe('city-feature-v1');
  const ordinary={...s,approvedPaths:['apps/web/src/city.ts']};const {profile:_,...legacy}=ordinary;void _;
  expect(sha256(canonicalScope(ordinary))).not.toBe(sha256(canonicalScope(legacy)));
});
test('cost estimate includes input, reasoning-inclusive output and started container intervals',()=>{
  expect(estimateSessionCost({input_tokens:1000000,output_tokens:100000},1,3)).toEqual({inputTokens:1000000,outputTokens:100000,estimatedMicroUsd:43920000,observedAt:3});
  expect(estimateSessionCost({input_tokens:0,output_tokens:0},1200001,3).estimatedMicroUsd).toBe(3840000);
});
test.each([null,{}, {input_tokens:-1,output_tokens:0},{input_tokens:0,output_tokens:Infinity},{input_tokens:1.5,output_tokens:0}])('unknown/invalid usage is never zero: %j',u=>expect(()=>estimateSessionCost(u,0,0)).toThrow());
test('model preflight uses exact id, with no billable POST or fallback',async()=>{
  const f=vi.fn(async(_url:string,_init:RequestInit)=>Response.json({id:HOSTED_MODEL}));await verifyModelAccess('synthetic',f);
  expect(f).toHaveBeenCalledTimes(1);expect(f.mock.calls[0]![0]).toBe('https://api.openai.com/v1/models/gpt-6.2-astra');
  await expect(verifyModelAccess('synthetic',async()=>Response.json({id:'gpt-6-astra'}))).rejects.toThrow('queue-model-mismatch');
});
test('cost observation binds session and model and never echoes response contents',async()=>{
  const f=async()=>Response.json({id:'sess_test',agent:{model:HOSTED_MODEL},usage:{input_tokens:2,output_tokens:3}});
  expect((await observeSessionCost('synthetic','sess_test',0,f,42)).observedAt).toBe(42);
  await expect(observeSessionCost('synthetic','sess_other',0,f)).rejects.toThrow('queue-usage-identity');
});
const request=():HostedSessionRequest=>{
  const m=manifest(1),scope=taskScope(m,m.tasks[0]!);
  return buildHostedSessionRequest({scope,scopeDigest:sha256(canonicalScope(scope)),issueBody:m.tasks[0]!.scopeText,
    sourceArchiveFileId:'file_fixture',sourceArchiveSha256:'a'.repeat(64),sourceArchiveBytes:1,sourceArchiveVerifiedFromGitTree:true,
    currentOwnerGrantVerified:true,durableRunClaimVerified:true,projectKeyBindingVerified:true,exclusiveProjectRoutingVerified:true,
    hostedSandboxPolicyReviewed:true,sessionTerminationVerified:true});
};
test('request pins 6.2 Astra, standard tier, high reasoning and disables subagents',()=>{
  expect(request().agent).toMatchObject({model:'gpt-6.2-astra',service_tier:'default',reasoning:{effort:'high'},multi_agent:{enabled:false}});
});
test('manual guard stops a stalled stream at soft limit, confirms DELETE and refuses another create',async()=>{
  const calls:string[]=[],states:unknown[]=[];
  const f=async(url:string,init:RequestInit)=>{
    calls.push(init.method+' '+url);
    if(init.method==='DELETE')return Response.json({id:'sess_test',object:'agent.session.deleted',deleted:true});
    if(init.method==='GET')return Response.json({id:'sess_test',agent:{model:HOSTED_MODEL},usage:{input_tokens:2000000,output_tokens:0}});
    return new Response(new ReadableStream({start(c){
      c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'agent.session.created',session_id:'sess_test'})+'\n\n'));
      init.signal?.addEventListener('abort',()=>c.error(Error('aborted')),{once:true});
    }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  const p=new QueueSessionProvider('synthetic',3600,async()=>{},s=>states.push(s),f,Infinity,true);
  await expect((async()=>{for await(const packet of p.createSession(request()))void packet})()).rejects.toThrow();
  expect(p.state).toMatchObject({stopReason:'soft-limit',termination:'deleted_confirmed',usage:{inputTokens:2000000}});
  expect(calls.filter(c=>c.startsWith('POST'))).toHaveLength(1);expect(calls.filter(c=>c.startsWith('DELETE'))).toHaveLength(1);
  await expect(p.createSession(request()).next()).rejects.toThrow('queue-provider-repeat');expect(states.length).toBeGreaterThan(0);
});

test('missing usage stops after accounting grace without retrying paid creation',async()=>{
  vi.useFakeTimers();
  try{
    let reads=0,creates=0;
    const f=async(url:string,init:RequestInit)=>{
      if(init.method==='DELETE')return Response.json({id:'sess_test',object:'agent.session.deleted',deleted:true});
      if(init.method==='GET'){reads++;return Response.json({id:'sess_test',agent:{model:HOSTED_MODEL},usage:null})}
      creates++;
      return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'agent.session.created',session_id:'sess_test'})+'\n\n'));init.signal?.addEventListener('abort',()=>c.error(Error('aborted')),{once:true})}}));
    };
    const p=new QueueSessionProvider('synthetic',3600,async()=>{},()=>{},f,Infinity,true);
    const done=(async()=>{try{for await(const packet of p.createSession(request()))void packet;return 'completed'}catch{return 'stopped'}})();
    await vi.advanceTimersByTimeAsync(135001);
    expect(await done).toBe('stopped');expect(creates).toBe(1);expect(reads).toBeGreaterThan(1);
    expect(p.state).toMatchObject({stopReason:'usage-unavailable',usage:null,termination:'deleted_confirmed'});
  }finally{vi.useRealTimers()}
});
test('unknown deletion retains uncertain termination after a cost stop',async()=>{
  const f=async(_url:string,init:RequestInit)=>{
    if(init.method==='DELETE')return Response.json({id:'sess_test',deleted:false});
    if(init.method==='GET')return Response.json({id:'sess_test',agent:{model:HOSTED_MODEL},usage:{input_tokens:2000000,output_tokens:0}});
    return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'agent.session.created',session_id:'sess_test'})+'\n\n'));init.signal?.addEventListener('abort',()=>c.error(Error('aborted')),{once:true})}}));
  };
  const p=new QueueSessionProvider('synthetic',3600,async()=>{},()=>{},f,Infinity,true);
  await expect((async()=>{for await(const packet of p.createSession(request()))void packet})()).rejects.toThrow();
  expect(p.state).toMatchObject({stopReason:'soft-limit',termination:'unknown'});
});

test('missing session identity times out without guessing a cleanup id or retrying create',async()=>{
  vi.useFakeTimers();try{
    let creates=0,deletes=0;
    const f=async(_url:string,init:RequestInit)=>{if(init.method==='DELETE'){deletes++;throw Error('unexpected delete')}creates++;
      return new Response(new ReadableStream({start(c){init.signal?.addEventListener('abort',()=>c.error(Error('aborted')),{once:true})}}));};
    const p=new QueueSessionProvider('synthetic',3600,async()=>{},()=>{},f,Infinity,true);
    const done=(async()=>{try{for await(const packet of p.createSession(request()))void packet;return 'completed'}catch{return 'stopped'}})();
    await vi.advanceTimersByTimeAsync(120001);expect(await done).toBe('stopped');
    expect(creates).toBe(1);expect(deletes).toBe(0);expect(p.state).toMatchObject({sessionId:null,termination:'unknown',stopReason:'usage-unavailable'});
  }finally{vi.useRealTimers()}
});
test('short successful manual session records final usage before delivering completion',async()=>{
  const f=async(_url:string,init:RequestInit)=>{
    if(init.method==='GET')return Response.json({id:'sess_test',agent:{model:HOSTED_MODEL},usage:{input_tokens:10,output_tokens:20}});
    return new Response('data: '+JSON.stringify({type:'agent.session.turn.completed',session_id:'sess_test',turn:{id:'turn_test',subagent_id:null}})+'\n\n');
  };
  const p=new QueueSessionProvider('synthetic',3600,async()=>{},()=>{},f,Infinity,true),packets=[];
  for await(const packet of p.createSession(request()))packets.push(packet);
  expect(packets).toHaveLength(1);expect(p.state).toMatchObject({coding:'completed',usage:{inputTokens:10,outputTokens:20}});
});
