/** Owner-only stop/release recovery. No session creation or draft publication. */
import {createPublicKey,verify} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {GitHubHttpsTransport,type GitHubTransport} from './codex-github-control.ts';
import {enrolledKey,protectedJson,get,obj,workflowIdentity} from './overnight-production.ts';
import {QueueJournal,GitHubQueueStore} from './overnight-ledger.ts';
import {canonical,OWNER_ID} from './overnight-policy.ts';
import {OWNER,sha256,SHA} from './codex-automation-policy.ts';
import {requireControl} from './codex-run-control.ts';
import {reconcileProvider} from './overnight-provider.ts';
import type {PilotFetcher} from './codex-pilot-diagnostics.ts';
import {controllerTransport} from './overnight-ledger-auth.ts';
export async function reconciliationRequest(api:GitHubTransport,env:NodeJS.ProcessEnv,now:Date){
  workflowIdentity(env);requireControl(env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_ACTOR===OWNER&&env.GITHUB_ACTOR_ID===String(OWNER_ID),'queue-reconcile-owner-trigger');
  const {key}=await enrolledKey(api,env),raw=await protectedJson(api,'.sovereign/reconcile.json'),r=obj(raw.request);
  requireControl(Object.keys(r).sort().join(',')==='action,approvalId,expiresAt,ledgerRevision,neverStarted,previousRunId,queueId,sessionIds,version'&&
    r.version===1&&r.action==='stop-and-release'&&typeof r.approvalId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(r.approvalId)&&
    typeof r.queueId==='string'&&typeof r.previousRunId==='string'&&/^\d{1,20}$/.test(r.previousRunId)&&typeof r.ledgerRevision==='string'&&SHA.test(r.ledgerRevision)&&
    typeof r.expiresAt==='string'&&now.getTime()<Date.parse(r.expiresAt)&&Date.parse(r.expiresAt)-now.getTime()<=3600000&&
    Array.isArray(r.sessionIds)&&r.sessionIds.length<=3&&Array.isArray(r.neverStarted)&&r.neverStarted.length<=3&&typeof raw.signature==='string','queue-reconcile-request');
  const publicKey=createPublicKey(String(key.publicKeyPem));
  requireControl(publicKey.asymmetricKeyType==='ed25519'&&sha256(publicKey.export({format:'der',type:'spki'}))===env.SOVEREIGN_OWNER_KEY_SHA256&&
    verify(null,Buffer.from('SOVEREIGN-RECONCILE-V1\n'+canonical(r)),publicKey,Buffer.from(raw.signature,'base64')),'queue-reconcile-signature');
  const owner=await get(api,`/collaborators/${OWNER}/permission`);requireControl(owner.permission==='admin'&&obj(owner.user).id===OWNER_ID&&obj(owner.user).login===OWNER,'queue-reconcile-not-owner');
  const current=await get(api,`/actions/runs/${env.GITHUB_RUN_ID}`);
  requireControl(current.path==='.github/workflows/sovereign-overnight-reconcile.yml'&&current.run_attempt===1&&current.head_sha===env.GITHUB_SHA,'queue-reconcile-workflow');
  const original=await get(api,`/actions/runs/${r.previousRunId}`);
  requireControl(original.status==='completed'&&original.run_attempt===1&&original.path==='.github/workflows/sovereign-overnight-queue.yml','queue-original-still-running');
  const store=new GitHubQueueStore(api),snapshot=await store.read(),run=snapshot.ledger.runs.find(x=>x.queueId===r.queueId&&x.runId===r.previousRunId);
  requireControl(snapshot.revision===r.ledgerRevision&&run&&snapshot.ledger.active?.queueId===r.queueId&&snapshot.ledger.active.runId===r.previousRunId,'queue-reconcile-revision');
  requireControl(original.head_sha===run.baselineSha,'queue-original-source');
  const ids=run.tasks.flatMap(t=>t.sessions&&t.sessionId?[t.sessionId]:[]),missing=run.tasks.flatMap((t,i)=>t.sessions&&!t.sessionId?[i]:[]);
  requireControl(canonical([...ids].sort())===canonical([...r.sessionIds].sort())&&canonical(missing)===canonical(r.neverStarted),'queue-unknown-session-cannot-release');
  if(missing.length){
    const jobs=await get(api,`/actions/runs/${r.previousRunId}/attempts/1/jobs?per_page=100`);
    requireControl(Array.isArray(jobs.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.jobs.length<100,'queue-original-jobs');
    for(const i of missing){
      const matches=jobs.jobs.map(obj).filter(j=>j.name===`Task ${i+1} / Agent`);
      requireControl(matches.length===1&&matches[0]!.status==='completed'&&
        (matches[0]!.conclusion==='skipped'||Array.isArray(matches[0]!.steps)&&matches[0]!.steps.map(obj).some(s=>s.name==='Run bounded authorized session'&&s.conclusion==='skipped')),'queue-create-attempt-unprovable');
    }
  }
  const preconfirmed=run.tasks.flatMap(t=>t.sessionId&&t.terminated&&t.terminationReceipt?[t.sessionId]:[]);
  return {r,ids,missing,preconfirmed,digest:sha256(canonical(r)),journal:new QueueJournal(store)};
}
export async function runReconciliation(command:string,env:NodeJS.ProcessEnv,api:GitHubTransport,fetcher:PilotFetcher=fetch,now:()=>Date=()=>new Date()){
  const c=await reconciliationRequest(api,env,now());
  if(command==='inspect')return {queueId:c.r.queueId,known:c.ids.length,unstarted:c.missing.length,action:'No provider or ledger mutation'};
  requireControl(typeof env.RUNNER_TEMP==='string'&&typeof env.GITHUB_OUTPUT==='string','queue-reconcile-environment');
  if(command==='terminate'){
    requireControl(env.GITHUB_JOB==='provider'&&typeof env.OPENAI_API_KEY==='string'&&env.OPENAI_API_KEY.length>0,'queue-reconcile-provider-context');
    for(const id of c.ids)if(!c.preconfirmed.includes(id))await reconcileProvider(env.OPENAI_API_KEY,id,true,fetcher);
    const bytes=Buffer.from(JSON.stringify({version:1,requestDigest:c.digest,runId:env.GITHUB_RUN_ID,terminatedIds:c.ids,neverStarted:c.missing}));
    writeFileSync(join(env.RUNNER_TEMP,'reconciliation.json'),bytes,{mode:0o600});appendFileSync(env.GITHUB_OUTPUT,`reconciliation_sha256=${sha256(bytes)}\n`);return;
  }
  requireControl(command==='commit'&&env.OPENAI_API_KEY===undefined&&env.GITHUB_JOB==='commit','queue-reconcile-commit-context');
  const jobs=await get(api,`/actions/runs/${env.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`);
  requireControl(Array.isArray(jobs.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.jobs.length<100,'queue-reconcile-jobs');
  const provider=jobs.jobs.map(obj).filter(j=>j.name==='Reconcile provider');
  requireControl(provider.length===1&&provider[0]!.status==='completed'&&provider[0]!.conclusion==='success'&&Array.isArray(provider[0]!.steps)&&
    provider[0]!.steps.map(obj).some(s=>s.name==='Terminate only approved known sessions'&&s.status==='completed'&&s.conclusion==='success'),'queue-reconcile-job-proof');
  const bytes=readFileSync(join(env.RUNNER_TEMP,'reconciliation.json'));requireControl(bytes.length<=4096&&sha256(bytes)===env.EXPECTED_RECONCILIATION_SHA256,'queue-reconcile-receipt');
  const receipt=obj(JSON.parse(bytes.toString('utf8')));
  requireControl(receipt.version===1&&receipt.requestDigest===c.digest&&receipt.runId===env.GITHUB_RUN_ID&&canonical(receipt.terminatedIds)===canonical(c.ids)&&canonical(receipt.neverStarted)===canonical(c.missing),'queue-reconcile-evidence');
  await c.journal.reconcileStop(String(c.r.ledgerRevision),String(c.r.queueId),String(c.r.previousRunId),String(c.r.approvalId),c.digest,c.ids,c.missing,now());
}
if(process.argv[1]?.endsWith('overnight-reconcile.ts')){
  void runReconciliation(process.argv[2]??'inspect',process.env,controllerTransport(process.env)).then(v=>{if(v)process.stdout.write(JSON.stringify(v)+'\n')}).catch(()=>{
    process.stderr.write('Reconciliation denied or uncertain. Reservation remains held; never retry creation.\n');process.exitCode=1;
  });
}
