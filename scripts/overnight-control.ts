/** Trusted control/publish/report jobs. No provider key and no generated-code execution. */
import {readFileSync,writeFileSync,mkdirSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {GitHubHttpsTransport,type GitHubTransport} from './codex-github-control.ts';
import {productionAuthority,productionContext,requireJob,assertScope,workflowIdentity,get,obj} from './overnight-production.ts';
import {GitHubQueueStore,QueueJournal} from './overnight-ledger.ts';
import {REPOSITORY,sha256} from './codex-automation-policy.ts';
import {requireControl} from './codex-run-control.ts';
import {PROVIDER_ID} from './codex-pilot-diagnostics.ts';
import {readValidationBundle} from './codex-pilot-validator.ts';
import {verifyValidationReceipt} from './codex-pilot-receipt.ts';
import {runPilotPublisher} from './codex-pilot-publish.ts';
import {morningReport} from './overnight-queue.ts';
import {controllerTransport} from './overnight-ledger-auth.ts';
const output=(env:NodeJS.ProcessEnv,key:string,value:string)=>{requireControl(typeof env.GITHUB_OUTPUT==='string'&&['admitted','task_count','archive_sha256','completed'].includes(key)&&!/[\r\n]/.test(value),'queue-control-output');appendFileSync(env.GITHUB_OUTPUT,`${key}=${value}\n`)};
export async function control(command:string,env:NodeJS.ProcessEnv,api:GitHubTransport,now:()=>Date=()=>new Date(),repo=process.cwd(),fetcher:typeof fetch=fetch){
  requireControl(env.OPENAI_API_KEY===undefined,'queue-control-provider-key-forbidden');
  workflowIdentity(env);
  if(command==='intake'){
    if(env.SOVEREIGN_OVERNIGHT_ENABLED!=='true'){output(env,'admitted','false');return}
    const {manifest:m}=await productionAuthority(api,env,now(),true);
    await new QueueJournal(new GitHubQueueStore(api)).reserve(m,env.GITHUB_RUN_ID!,now());
    output(env,'task_count',String(m.tasks.length));output(env,'admitted','true');return;
  }
  if(command==='report'){
    const journal=new QueueJournal(new GitHubQueueStore(api));let report:string;
    try{
      let l=await journal.snapshot();const r=l.runs.find(r=>r.runId===env.GITHUB_RUN_ID);
      if(r){
        if(r.status==='running'){
          const index=r.tasks.findIndex(t=>t.phase!=='draft_pr_created');
          if(index>=0){
            // Metadata from same-run agent artifacts is informational only; it
            // cannot prove termination, authorize publication or release a lock.
            const statePath=join(env.RUNNER_TEMP!,'queue-states',`queue-state-${index}`,'provider-state.json');
            if(r.tasks[index]!.phase==='agent_running'&&existsSync(statePath)){
              const bytes=readFileSync(statePath);requireControl(bytes.length<=4096,'queue-report-state-size');
              const s=obj(JSON.parse(bytes.toString('utf8')));
              if(typeof s.sessionId==='string'&&PROVIDER_ID.test(s.sessionId))await journal.observeSession(r.queueId,r.runId,index,s.sessionId);
            }
            await journal.fail(r.queueId,r.runId,index,now());l=await journal.snapshot();
          }
        }
        report=morningReport(l,r.queueId);
      }else report='Queue not admitted, or admission outcome unknown. No successful execution or zero cost is inferred. Inspect the durable ledger before reconciliation.\n';
    }catch{report='Queue report unavailable. Durable state may contain a live or uncertain reservation. Do not retry paid work or release the lock. Owner reconciliation required.\n'}
    requireControl(typeof env.RUNNER_TEMP==='string'&&typeof env.GITHUB_STEP_SUMMARY==='string','queue-report-environment');
    writeFileSync(join(env.RUNNER_TEMP,'overnight-report.md'),report);appendFileSync(env.GITHUB_STEP_SUMMARY,report);return;
  }
  const c=await productionContext(api,env,now());
  if(command==='prepare'){
    requireControl(c.record.phase==='pending','queue-task-already-started');
    await c.journal.step(c.manifest.queueId,c.runId,c.index,'pending','preparing',now());
    requireControl(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()===c.manifest.baselineSha,'queue-checkout-source');
    const dir=join(env.RUNNER_TEMP!,'sovereign-pilot');mkdirSync(dir,{recursive:true});
    execFileSync('python3',['scripts/codex-hosted-packager.py','--repo',repo,'--source',c.manifest.baselineSha,'--output',join(dir,'source.tar.gz')],{cwd:repo,timeout:60000,stdio:'pipe'});
    const hash=sha256(readFileSync(join(dir,'source.tar.gz')));
    await c.journal.step(c.manifest.queueId,c.runId,c.index,'preparing','agent_running',now());
    output(env,'archive_sha256',hash);return;
  }
  requireControl(command==='seal'||command==='publish','queue-control-command');
  requireControl(command==='seal'?env.GITHUB_JOB==='seal'&&c.record.phase==='agent_running':env.GITHUB_JOB==='publish'&&c.record.phase==='validating','queue-publish-state');
  await requireJob(api,c.runId,c.index,'Agent',env.EXPECTED_AGENT_STATE_SHA256??'');
  const stateBytes=readFileSync(join(env.RUNNER_TEMP!,'sovereign-pilot','state','provider-state.json'));
  requireControl(stateBytes.length<=4096&&sha256(stateBytes)===env.EXPECTED_AGENT_STATE_SHA256,'queue-agent-state-binding');
  const state=obj(JSON.parse(stateBytes.toString('utf8')));
  requireControl(state.version===1&&state.createAttempted===true&&state.coding==='completed'&&state.termination==='deleted_confirmed'&&
    typeof state.sessionId==='string'&&PROVIDER_ID.test(state.sessionId),'queue-agent-termination-not-confirmed');
  if(command==='seal'){
    await c.journal.observeSession(c.manifest.queueId,c.runId,c.index,state.sessionId);
    await c.journal.step(c.manifest.queueId,c.runId,c.index,'agent_running','validating',now(),{sessionId:state.sessionId,terminationReceipt:env.EXPECTED_AGENT_STATE_SHA256!});return;
  }
  requireControl(c.record.terminated&&c.record.terminationReceipt===env.EXPECTED_AGENT_STATE_SHA256,'queue-provider-receipt-not-sealed');
  await requireJob(api,c.runId,c.index,'Validate',env.EXPECTED_VALIDATION_SHA256??'');
  const dir=join(env.RUNNER_TEMP!,'sovereign-pilot','validated'),bundle=readValidationBundle(dir);
  assertScope(c,JSON.parse(Buffer.from(bundle.scope).toString('utf8')));
  const receipt=verifyValidationReceipt(readFileSync(join(dir,'validation-receipt.json')),env.EXPECTED_VALIDATION_SHA256,{runId:c.runId,sourceSha:c.manifest.baselineSha},bundle);
  await c.journal.step(c.manifest.queueId,c.runId,c.index,'validating','publishing',now(),{receipt:{digest:env.EXPECTED_VALIDATION_SHA256!,treeSha:receipt.treeSha,checks:receipt.checks}});
  const published=await runPilotPublisher(env,fetcher,repo,{issue:c.task.issue,branch:c.branch,async assertAuthorized(){
    const fresh=await productionContext(api,env,now());requireControl(fresh.record.phase==='publishing'&&fresh.record.receipt?.digest===env.EXPECTED_VALIDATION_SHA256,'queue-publication-reservation');
    assertScope(fresh,JSON.parse(Buffer.from(bundle.scope).toString('utf8')));
  }});
  const remote=await get(api,`/pulls/${published.number}`);
  requireControl(remote.state==='open'&&remote.draft===true&&remote.merged_at===null&&obj(remote.head).sha===published.headSha&&obj(remote.head).ref===c.branch&&
    obj(obj(remote.head).repo).full_name===REPOSITORY&&obj(remote.base).ref==='main','queue-final-pr-confirmation');
  await c.journal.step(c.manifest.queueId,c.runId,c.index,'publishing','draft_pr_created',now(),{pr:published});
  output(env,'completed','true');
}
if(process.argv[1]?.endsWith('overnight-control.ts')){
  void control(process.argv[2]??'',process.env,controllerTransport(process.env)).catch(()=>{
    process.stderr.write('Queue control denied or uncertain. No automatic retry; inspect durable state.\n');process.exitCode=1;
  });
}
