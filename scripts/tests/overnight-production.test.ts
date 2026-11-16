import {expect,test,vi} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {control} from '../overnight-control.ts';
import {runQueueAgent} from '../overnight-agent.ts';
import {productionAuthority,productionContext,requireJob} from '../overnight-production.ts';
import {QueueSessionProvider,reconcileProvider} from '../overnight-provider.ts';
import {buildHostedSessionRequest} from '../codex-hosted-agents.ts';
import {reconciliationRequest,runReconciliation} from '../overnight-reconcile.ts';
import {sha256,canonicalScope,REPOSITORY} from '../codex-automation-policy.ts';
import {taskScope,canonical} from '../overnight-policy.ts';
import {productionFixture} from './overnight-production-fixture.ts';
import {now,signRecovery} from './overnight-fixture.ts';
import type {GitHubTransport} from '../codex-github-control.ts';
const time=()=>now;
async function reserve(f:ReturnType<typeof productionFixture>){await control('intake',f.env,f.api,time,f.repo);await control('prepare',f.env,f.api,time,f.repo);f.env.EXPECTED_ARCHIVE_SHA256=sha256(readFileSync(join(f.runner,'sovereign-pilot','source.tar.gz')))}
async function agent(f:ReturnType<typeof productionFixture>){f.env.GITHUB_JOB='agent';f.env.OPENAI_API_KEY='synthetic-provider-key';await runQueueAgent(f.env,f.api,f.providerFetch,time);delete f.env.OPENAI_API_KEY}
async function seal(f:ReturnType<typeof productionFixture>){
  const state=readFileSync(join(f.runner,'sovereign-pilot','provider-state.json')),dir=join(f.runner,'sovereign-pilot','state');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'provider-state.json'),state);
  f.env.EXPECTED_AGENT_STATE_SHA256=sha256(state);f.env.GITHUB_JOB='seal';await control('seal',f.env,f.api,time,f.repo);
}
test('production interfaces perform real Git preparation/replay and exact-tree publication with durable completion',async()=>{
  const f=productionFixture(2);const out=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  try{
    await reserve(f);expect(f.ledger().runs[0]!.tasks.map(t=>t.phase)).toEqual(['agent_running','pending']);
    await agent(f);expect(f.providerCalls.filter(c=>c.url.endsWith('/sessions'))).toHaveLength(1);expect(f.providerCalls.some(c=>c.method==='DELETE')).toBe(true);
    await seal(f);f.validation();f.env.GITHUB_JOB='publish';await control('publish',f.env,f.api,time,f.repo,f.githubFetch);
    expect(f.ledger().runs[0]!.tasks[0]!.phase).toBe('draft_pr_created');expect(f.ledger().runs[0]!.tasks[0]!.pr?.number).toBe(301);
    expect(f.pr()!.body).toContain('Closes #101');expect(f.pr()!.body).not.toContain('Closes #999');expect(f.pr()!.draft).toBe(true);
    expect(f.calls.filter(c=>c.method==='POST'&&c.path==='/pulls')).toHaveLength(1);
    f.env.SOVEREIGN_TASK_INDEX='1';f.env.GITHUB_JOB='prepare';await control('prepare',f.env,f.api,time,f.repo);
    expect(f.ledger().runs[0]!.tasks[1]!.phase).toBe('agent_running');
  }finally{out.mockRestore();f.cleanup()}
});
test('global GitHub-ref admission admits only one simultaneous dispatch',async()=>{
  const f=productionFixture();try{const r=await Promise.allSettled([control('intake',f.env,f.api,time,f.repo),control('intake',f.env,f.api,time,f.repo)]);
    expect(r.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.ledger().runs).toHaveLength(1);expect(f.providerCalls).toEqual([]);
  }finally{f.cleanup()}
});
test.each(['revoked','pin','signature','scope','baseline','legacy','run','permission'])(
  'production intake rejects %s independently authenticated drift',async(kind)=>{
    const f=productionFixture();try{
      if(kind==='revoked')f.config.enrollment.revoked=true;
      if(kind==='pin')f.env.SOVEREIGN_OWNER_KEY_SHA256='0'.repeat(64);
      if(kind==='signature')f.config.signature=Buffer.alloc(64).toString('base64');
      const api:GitHubTransport={async request(method,path,body){
        const r=await f.api.request(method,path,body);
        if(kind==='legacy'&&path.includes('/contents/.github/'))return {status:200,data:{encoding:'base64',content:Buffer.from('active workflow').toString('base64')}};
        if(kind==='scope'&&path==='/issues/101')return {status:200,data:{number:101,state:'open',title:f.m.tasks[0]!.title,body:'changed'}};
        if(kind==='baseline'&&path==='/git/ref/heads/main')return {status:200,data:{ref:'refs/heads/main',object:{sha:'0'.repeat(40)}}};
        if(kind==='run'&&path==='/actions/runs/123')return {status:200,data:{...r.data as object,path:'untrusted.yml'}};
        if(kind==='permission'&&path.includes('/permission'))return {status:200,data:{permission:'write',user:{id:1}}};return r;
      }};
      await expect(control('intake',f.env,api,time,f.repo)).rejects.toThrow();expect(f.ledger().runs).toHaveLength(0);expect(f.providerCalls).toEqual([]);
    }finally{f.cleanup()}
  });
test('disabled production intake performs no HTTP and no durable claim',async()=>{
  const f=productionFixture();try{f.env.SOVEREIGN_OVERNIGHT_ENABLED='false';const request=vi.fn();await control('intake',f.env,{request},time,f.repo);expect(request).not.toHaveBeenCalled()}finally{f.cleanup()}
});
test('runner loss before create leaves consumed reservation; repeated prepare/re-run denied',async()=>{
  const f=productionFixture();try{await reserve(f);await expect(control('prepare',f.env,f.api,time,f.repo)).rejects.toThrow();f.env.GITHUB_RUN_ATTEMPT='2';await expect(agent(f)).rejects.toThrow();expect(f.providerCalls).toEqual([]);expect(f.ledger().active).not.toBeNull()}finally{f.cleanup()}
});
test('lost create response cannot be retried or inferred terminated',async()=>{
  const f=productionFixture();try{
    await reserve(f);f.env.GITHUB_JOB='agent';f.env.OPENAI_API_KEY='synthetic';let posts=0;
    await expect(runQueueAgent(f.env,f.api,async(url,init)=>{if(url.endsWith('/sessions')){posts++;throw Error('lost response')}return f.providerFetch(url,init)},time)).rejects.toThrow();
    expect(posts).toBe(1);const state=JSON.parse(readFileSync(join(f.runner,'sovereign-pilot','provider-state.json'),'utf8'));
    expect(state).toMatchObject({createAttempted:true,sessionId:null,coding:'unknown',termination:'unknown'});
    await expect(runQueueAgent(f.env,f.api,f.providerFetch,time)).rejects.toThrow();expect(f.ledger().active).not.toBeNull();
  }finally{f.cleanup()}
});
test('provider deletion uncertainty prevents output/publication and preserves exclusion',async()=>{
  const f=productionFixture();try{await reserve(f);f.env.GITHUB_JOB='agent';f.env.OPENAI_API_KEY='synthetic';
    await expect(runQueueAgent(f.env,f.api,async(url,init)=>init.method==='DELETE'?Response.json({deleted:false,id:'opaque-session-0',object:'agent.session.deleted'}):f.providerFetch(url,init),time)).rejects.toThrow();
    const s=JSON.parse(readFileSync(join(f.runner,'sovereign-pilot','provider-state.json'),'utf8'));expect(s.termination).toBe('unknown');expect(s.sessionId).toBe('opaque-session-0');expect(f.ledger().active).not.toBeNull();
  }finally{f.cleanup()}
});
test.each(['missing','job-failure','job-skipped-step','wrong-digest','wrong-scope','wrong-tree'])(
  'publication rejects %s evidence before GitHub writes',async(kind)=>{
    const f=productionFixture();try{await reserve(f);await agent(f);await seal(f);f.validation();f.env.GITHUB_JOB='publish';
      if(kind==='missing')f.env.EXPECTED_VALIDATION_SHA256='';if(kind==='wrong-digest')f.env.EXPECTED_VALIDATION_SHA256='0'.repeat(64);
      const receiptPath=join(f.runner,'sovereign-pilot','validated','validation-receipt.json');
      if(kind==='wrong-tree'){const r=JSON.parse(readFileSync(receiptPath,'utf8'));r.treeSha='0'.repeat(40);writeFileSync(receiptPath,JSON.stringify(r));f.env.EXPECTED_VALIDATION_SHA256=sha256(readFileSync(receiptPath))}
      if(kind==='wrong-scope'){const p=join(f.runner,'sovereign-pilot','validated','scope.json'),s=JSON.parse(readFileSync(p,'utf8'));s.issue=999;writeFileSync(p,JSON.stringify(s))}
      const api:GitHubTransport={async request(method,path,body){const r=await f.api.request(method,path,body);
        if(path.includes('/jobs?')&&(kind==='job-failure'||kind==='job-skipped-step')){const data=r.data as {jobs:{name:string;conclusion:string;steps:{conclusion:string}[]}[]};const j=data.jobs.find(j=>j.name.endsWith('/ Validate'))!;
          if(kind==='job-failure')j.conclusion='failure';else j.steps[0]!.conclusion='skipped'}return r;
      }};
      const n=f.calls.length;await expect(control('publish',f.env,api,time,f.repo,f.githubFetch)).rejects.toThrow();
      expect(f.calls.slice(n).filter(c=>c.method!=='GET')).toEqual([]);expect(f.ledger().active).not.toBeNull();
    }finally{f.cleanup()}
  });
test('publisher lost response stops queue; repeating production entry cannot make a duplicate PR',async()=>{
  const f=productionFixture(2),out=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  try{await reserve(f);await agent(f);await seal(f);f.validation();f.env.GITHUB_JOB='publish';
    const fetcher:typeof fetch=async(url,init)=>{const r=await f.githubFetch(url,init);if(String(url).endsWith('/pulls')&&init?.method==='POST')throw Error('response lost');return r};
    await expect(control('publish',f.env,f.api,time,f.repo,fetcher)).rejects.toThrow();expect(f.ledger().runs[0]!.tasks[0]!.phase).toBe('publishing');
    await expect(control('publish',f.env,f.api,time,f.repo,f.githubFetch)).rejects.toThrow();
    expect(f.calls.filter(c=>c.path==='/pulls'&&c.method==='POST')).toHaveLength(1);f.env.SOVEREIGN_TASK_INDEX='1';await expect(productionContext(f.api,f.env,now)).rejects.toThrow();
  }finally{out.mockRestore();f.cleanup()}
});
test('report durably stops later tasks and survives provider uncertainty without leaking diagnostics',async()=>{
  const f=productionFixture(3);try{await reserve(f);await control('report',f.env,f.api,time,f.repo);
    expect(f.ledger().runs[0]!.tasks.map(t=>t.phase)).toEqual(['failed','stopped','stopped']);expect(f.ledger().active).not.toBeNull();
    const s=readFileSync(join(f.runner,'overnight-report.md'),'utf8');expect(s).toContain('UNKNOWN');expect(s).toContain('not started');expect(s).toContain('No PR was merged');
  }finally{f.cleanup()}
});
test('GET active/404/unknown status never proves provider termination',async()=>{
  const calls:string[]=[];const transport=async(url:string,init:RequestInit)=>{calls.push(init.method??'GET');return Response.json({id:'session-known',status:'in_progress'})};
  expect((await reconcileProvider('synthetic','session-known',false,transport)).state).toBe('in_progress');expect(calls).toEqual(['GET']);
  expect((await reconcileProvider('synthetic','session-known',false,async()=>Response.json({}, {status:404}))).state).toBe('unknown');
  await expect(reconcileProvider('synthetic','session-known',true,async()=>Response.json({}, {status:404}))).rejects.toThrow();
});
test('signed recovery cannot release an unknown create by supplying an invented session or skipped-step claim',async()=>{
  const f=productionFixture();try{
    await reserve(f);const c=await productionContext(f.api,f.env,now);await c.journal.fail(f.m.queueId,'123',0,now);
    const request={version:1,action:'stop-and-release',approvalId:'recovery-unknown',queueId:f.m.queueId,previousRunId:'123',ledgerRevision:f.revision(),
      expiresAt:new Date(now.getTime()+1800000).toISOString(),sessionIds:[],neverStarted:[0]};
    const api:GitHubTransport={async request(method,path,body){
      if(path.includes('/contents/.sovereign/reconcile.json')){const b=Buffer.from(JSON.stringify({request,signature:signRecovery(request)}));return {status:200,data:{type:'file',encoding:'base64',size:b.length,content:b.toString('base64')}}}
      if(path==='/actions/runs/456')return {status:200,data:{path:'.github/workflows/sovereign-overnight-reconcile.yml',run_attempt:1,head_sha:f.m.baselineSha}};
      if(path==='/actions/runs/123')return {status:200,data:{status:'completed',run_attempt:1,path:'.github/workflows/sovereign-overnight-queue.yml',head_sha:f.m.baselineSha}};
      return f.api.request(method,path,body);
    }};
    f.env.GITHUB_RUN_ID='456';await expect(reconciliationRequest(api,f.env,now)).rejects.toThrow('queue-create-attempt-unprovable');
    expect(f.ledger().active).not.toBeNull();expect(f.providerCalls).toEqual([]);
  }finally{f.cleanup()}
});
test('local timeout with a still-active known session cannot release or recreate it',async()=>{
  vi.useFakeTimers();const f=productionFixture();try{
    const scope=taskScope(f.m,f.m.tasks[0]!),request=buildHostedSessionRequest({scope,scopeDigest:sha256(canonicalScope(scope)),issueBody:f.m.tasks[0]!.scopeText,
      sourceArchiveFileId:'file_fixture',sourceArchiveSha256:'a'.repeat(64),sourceArchiveBytes:1,sourceArchiveVerifiedFromGitTree:true,currentOwnerGrantVerified:true,durableRunClaimVerified:true,
      projectKeyBindingVerified:true,exclusiveProjectRoutingVerified:true,hostedSandboxPolicyReviewed:true,sessionTerminationVerified:true});
    let posts=0;const p=new QueueSessionProvider('synthetic',1,async()=>{},()=>{},async(url,init)=>{
      if(init.method==='DELETE')return Response.json({id:'known-session',deleted:false,object:'agent.session.deleted'});
      posts++;return new Response(new ReadableStream({start(controller){
        controller.enqueue(Buffer.from('data: '+JSON.stringify({type:'agent.session.in_progress',session:{id:'known-session'}})+'\n\n'));
        init.signal?.addEventListener('abort',()=>controller.error(Error('aborted')));
      }}));
    });
    const it=p.createSession(request);await it.next();const next=it.next();const failed=expect(next).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1001);await failed;
    expect(p.state).toMatchObject({sessionId:'known-session',coding:'unknown',termination:'unknown'});expect(posts).toBe(1);
    await expect(p.createSession(request).next()).rejects.toThrow('queue-provider-repeat');
  }finally{vi.useRealTimers();f.cleanup()}
});
test('workflow boundaries retain pinned real validation and no provider/publication credentials together',()=>{
  const read=(file:string)=>readFileSync(new URL('../../.github/workflows/'+file,import.meta.url),'utf8');
  const task=read('sovereign-overnight-task.yml'),agent=task.split('\n  agent:')[1]!.split('\n  seal:')[0]!,validate=task.split('\n  validate:')[1]!.split('\n  publish:')[0]!,publish=task.split('\n  publish:')[1]!;
  expect(agent).toContain('contents: read');expect(agent).not.toMatch(/contents: write|pull-requests: write/);
  expect(agent).not.toContain('SOVEREIGN_LEDGER_APP_PRIVATE_KEY');
  expect(validate).not.toMatch(/OPENAI_API_KEY|GITHUB_TOKEN|contents: write|pull-requests: write/);expect(publish).not.toContain('OPENAI_API_KEY');
  expect(validate).toContain('scripts/codex-pilot-validator.ts');expect(validate).toContain('set -euo pipefail');expect(publish).toContain('needs.validate.outputs.validation_sha256');
  expect(validate.indexOf('scripts/codex-proposal-replay.py')).toBeLessThan(validate.indexOf('pnpm install --frozen-lockfile'));
  expect(read('sovereign-overnight-queue.yml')).toContain("vars.SOVEREIGN_OVERNIGHT_ENABLED == 'true'");
  expect(read('sovereign-hosted-pilot.yml').indexOf('run: exit 1 # Retired')).toBeLessThan(read('sovereign-hosted-pilot.yml').indexOf('uses: actions/checkout'));
  expect(read('automation-015-codex-smoke.yml')).not.toMatch(/OPENAI_API_KEY|codex-action/);
});
test('owner reconciliation requires authentic deletion job receipt and preserves consumed approvals',async()=>{
  const f=productionFixture();try{
    await reserve(f);const c=await productionContext(f.api,f.env,now);await c.journal.observeSession(f.m.queueId,'123',0,'opaque-session-0');await c.journal.fail(f.m.queueId,'123',0,now);
    const r={version:1,action:'stop-and-release',approvalId:'owner-recovery-1',queueId:f.m.queueId,previousRunId:'123',ledgerRevision:f.revision(),expiresAt:new Date(now.getTime()+1800000).toISOString(),sessionIds:['opaque-session-0'],neverStarted:[]};
    const api:GitHubTransport={async request(method,path,body){
      if(path.includes('/contents/.sovereign/reconcile.json')){const bytes=Buffer.from(JSON.stringify({request:r,signature:signRecovery(r)}));return {status:200,data:{type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')}}}
      if(path==='/actions/runs/456')return {status:200,data:{path:'.github/workflows/sovereign-overnight-reconcile.yml',run_attempt:1,head_sha:f.m.baselineSha}};
      if(path==='/actions/runs/123')return {status:200,data:{status:'completed',run_attempt:1,path:'.github/workflows/sovereign-overnight-queue.yml',head_sha:f.m.baselineSha}};
      if(path.includes('/actions/runs/456/attempts/1/jobs'))return {status:200,data:{total_count:1,jobs:[{name:'Reconcile provider',status:'completed',conclusion:'success',steps:[{name:'Terminate only approved known sessions',status:'completed',conclusion:'success'}]}]}};
      return f.api.request(method,path,body);
    }};
    f.env.GITHUB_RUN_ID='456';f.env.GITHUB_JOB='provider';f.env.OPENAI_API_KEY='synthetic';
    expect((await reconciliationRequest(api,f.env,now)).ids).toEqual(['opaque-session-0']);
    await runReconciliation('terminate',f.env,api,async(_url,init)=>{expect(init.method).toBe('DELETE');return Response.json({id:'opaque-session-0',object:'agent.session.deleted',deleted:true})},time);
    delete f.env.OPENAI_API_KEY;f.env.GITHUB_JOB='commit';const p=join(f.runner,'reconciliation.json');f.env.EXPECTED_RECONCILIATION_SHA256=sha256(readFileSync(p));
    await runReconciliation('commit',f.env,api,undefined,time);
    expect(f.ledger().active).toBeNull();expect(f.ledger().runs[0]!.status).toBe('stopped');expect(f.ledger().reconciliations).toHaveLength(1);
    expect(f.ledger().runs[0]!.tasks[0]!.approvalDigest).toBe(f.m.tasks[0]!.approvalDigest);
    await expect(c.journal.reserve({...f.m,queueId:'new-queue'},'789',now)).rejects.toThrow();
  }finally{f.cleanup()}
});
