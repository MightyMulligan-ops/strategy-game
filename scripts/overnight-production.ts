/** Trusted GitHub control-plane intake. No provider calls or generated-code execution. */
import {QueueAuthority,parseManifest,manifestDigest,taskScope,canonical,OWNER_ID,queueDeadline,type QueueManifest,type QueueTask} from './overnight-policy.ts';
import {GitHubQueueStore,QueueJournal,type TaskRecord} from './overnight-ledger.ts';
import {REPOSITORY,OWNER,sha256,canonicalScope,SHA} from './codex-automation-policy.ts';
import {requireControl} from './codex-run-control.ts';
import type {GitHubTransport} from './codex-github-control.ts';
export const CONFIG_REF='sovereign-overnight-config-v1';
export const QUEUE_WORKFLOW='.github/workflows/sovereign-overnight-queue.yml';
export const obj=(v:unknown):Record<string,unknown>=>{requireControl(v!==null&&typeof v==='object'&&!Array.isArray(v),'queue-response');return v as Record<string,unknown>};
export async function get(api:GitHubTransport,path:string){const r=await api.request('GET',path);requireControl(r.status===200,'queue-read');return obj(r.data)}
export async function protectedJson(api:GitHubTransport,path:string){
  requireControl(/^\.sovereign\/[a-z-]+\.json$/.test(path),'queue-config-path');
  const ref=await get(api,`/git/ref/heads/${CONFIG_REF}`),revision=obj(ref.object).sha;
  requireControl(ref.ref===`refs/heads/${CONFIG_REF}`&&typeof revision==='string'&&SHA.test(revision),'queue-config-ref');
  const file=await get(api,`/contents/${path}?ref=${revision}`);
  requireControl(file.type==='file'&&file.encoding==='base64'&&typeof file.content==='string'&&file.content.length<=350000&&typeof file.size==='number'&&file.size>0&&file.size<=256*1024,'queue-config-file');
  const bytes=Buffer.from(file.content,'base64');requireControl(bytes.length===file.size,'queue-config-size');return obj(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes)));
}
export async function enrolledKey(api:GitHubTransport,env:NodeJS.ProcessEnv){
  requireControl(/^[a-f0-9]{64}$/.test(env.SOVEREIGN_OWNER_KEY_SHA256??''),'queue-key-pin-missing');
  const config=await protectedJson(api,'.sovereign/queue.json'),key=obj(config.enrollment);
  requireControl(config.version===1&&Object.keys(key).sort().join(',')==='fingerprint,publicKeyPem,revoked'&&key.revoked===false&&
    key.fingerprint===env.SOVEREIGN_OWNER_KEY_SHA256&&typeof key.publicKeyPem==='string'&&key.publicKeyPem.length<=4096,'queue-key-revoked-or-unenrolled');
  return {config,key};
}
export type ProductionContext={manifest:QueueManifest;task:QueueTask;index:number;journal:QueueJournal;record:TaskRecord;runId:string;branch:string;startedAt:string;deadlineAt:string};
export function workflowIdentity(env:NodeJS.ProcessEnv){
  requireControl(env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_RUN_ATTEMPT==='1'&&
    /^\d{1,20}$/.test(env.GITHUB_RUN_ID??'')&&SHA.test(env.GITHUB_SHA??'')&&
    (env.GITHUB_EVENT_NAME==='schedule'||env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_ACTOR===OWNER&&env.GITHUB_ACTOR_ID===String(OWNER_ID)), 'queue-workflow-identity');
}
/** This ref must be owner-protected before activation; enrollment fingerprint is
 * separately pinned in owner-controlled Actions configuration, never the artifact. */
export async function productionAuthority(api:GitHubTransport,env:NodeJS.ProcessEnv,now:Date,dispatch=false,startedAt?:string){
  workflowIdentity(env);
  requireControl(env.SOVEREIGN_OVERNIGHT_ENABLED==='true'&&/^[a-f0-9]{64}$/.test(env.SOVEREIGN_OWNER_KEY_SHA256??''),'queue-production-disabled');
  const {config,key}=await enrolledKey(api,env);
  requireControl(Object.keys(config).sort().join(',')==='enabled,enrollment,manifest,signature,version'&&config.version===1&&config.enabled===true,'queue-config-disabled');
  requireControl(Object.keys(key).sort().join(',')==='fingerprint,publicKeyPem,revoked'&&key.revoked===false&&key.fingerprint===env.SOVEREIGN_OWNER_KEY_SHA256&&
    typeof key.publicKeyPem==='string'&&key.publicKeyPem.length<=4096&&typeof config.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(config.signature),'queue-key-revoked-or-unenrolled');
  const manifestBytes=Buffer.from(JSON.stringify(config.manifest));
  const authority=new QueueAuthority(api,{publicKeyPem:key.publicKeyPem,fingerprint:env.SOVEREIGN_OWNER_KEY_SHA256!},manifestBytes,Buffer.from(config.signature,'base64'),{
    repository:REPOSITORY,actor:env.GITHUB_ACTOR!,actorId:Number(env.GITHUB_ACTOR_ID),ref:env.GITHUB_REF!,event:env.GITHUB_EVENT_NAME as 'schedule'|'workflow_dispatch',
    runId:env.GITHUB_RUN_ID!,attempt:1,sourceSha:env.GITHUB_SHA!});
  const m=await authority.check(now,dispatch,startedAt);requireControl(m.enabled,'queue-manifest-disabled');
  for(const path of ['sovereign-hosted-pilot.yml','automation-015-codex-smoke.yml']){
    const retired=await get(api,`/contents/.github/workflows/${path}?ref=${m.baselineSha}`);
    requireControl(retired.encoding==='base64'&&typeof retired.content==='string'&&retired.content.length<100000&&
      Buffer.from(retired.content,'base64').toString('utf8').includes('run: exit 1 # Retired'),'queue-legacy-entry-not-retired');
  }
  // Authenticate the workflow run itself, including reusable jobs' parent run.
  const run=await get(api,`/actions/runs/${env.GITHUB_RUN_ID}`);
  requireControl(run.id===Number(env.GITHUB_RUN_ID)&&run.run_attempt===1&&run.head_sha===m.baselineSha&&run.path===QUEUE_WORKFLOW&&run.event===env.GITHUB_EVENT_NAME&&
    obj(run.repository).full_name===REPOSITORY,'queue-run-provenance');
  return {manifest:m,authority};
}
export async function productionContext(api:GitHubTransport,env:NodeJS.ProcessEnv,now:Date):Promise<ProductionContext>{
  workflowIdentity(env);
  const journal=new QueueJournal(new GitHubQueueStore(api)),l=await journal.snapshot(),runId=env.GITHUB_RUN_ID!;
  const r=l.runs.find(r=>r.runId===runId);
  const {manifest:m}=await productionAuthority(api,env,now,false,r?.startedAt);
  const index=Number(env.SOVEREIGN_TASK_INDEX);requireControl(/^[012]$/.test(env.SOVEREIGN_TASK_INDEX??'')&&index<m.tasks.length,'queue-task-index');
  const t=r?.tasks[index];
  requireControl(l.active?.queueId===m.queueId&&l.active.runId===runId&&r?.status==='running'&&r.queueId===m.queueId&&r.manifestDigest===manifestDigest(m)&&
    r.baselineSha===m.baselineSha&&t?.approvalDigest===m.tasks[index]!.approvalDigest&&t.scopeDigest===sha256(canonicalScope(taskScope(m,m.tasks[index]!,r.startedAt)))&&
    r.tasks.slice(0,index).every(t=>t.phase==='draft_pr_created'),'queue-durable-claim');
  return {manifest:m,task:m.tasks[index]!,index,journal,record:t,runId,startedAt:r.startedAt,deadlineAt:queueDeadline(m,r.startedAt),branch:`queue/${m.queueId}/${m.tasks[index]!.issue}-${runId}`};
}
/** Read authenticated Actions metadata, never a job-name/digest inside an artifact. */
export async function requireJob(api:GitHubTransport,runId:string,index:number,name:'Agent'|'Validate',digest:string){
  requireControl(/^[a-f0-9]{64}$/.test(digest),'queue-job-output-missing');
  const data=await get(api,`/actions/runs/${runId}/attempts/1/jobs?per_page=100`);
  requireControl(Array.isArray(data.jobs)&&typeof data.total_count==='number'&&data.total_count===data.jobs.length&&data.jobs.length<100&&
    data.jobs.every(j=>Number.isSafeInteger(obj(j).id)&&Number(obj(j).id)>0)&&new Set(data.jobs.map(j=>obj(j).id)).size===data.jobs.length,'queue-job-inventory');
  const jobs=data.jobs.map(obj).filter(j=>j.name===`Task ${index+1} / ${name}`);
  requireControl(jobs.length===1&&jobs[0]!.run_id===Number(runId)&&jobs[0]!.run_attempt===1&&jobs[0]!.status==='completed'&&jobs[0]!.conclusion==='success','queue-job-not-successful');
  const steps=jobs[0]!.steps;
  const required=name==='Agent'?['Run bounded authorized session']:['Run actual isolated checks','Require host receipt'];
  requireControl(Array.isArray(steps)&&required.every(n=>steps.map(obj).filter(s=>s.name===n&&s.conclusion==='success'&&s.status==='completed').length===1),'queue-job-execution-missing');
}
export function assertScope(context:ProductionContext,value:unknown){
  const expected=taskScope(context.manifest,context.task,context.startedAt),scope=obj(value);
  requireControl(scope.scopeDigest===sha256(canonicalScope(expected))&&canonicalScope(scope as unknown as typeof expected)===canonicalScope(expected),'queue-signed-scope-mismatch');
}
export function disabledConfiguration(){return {version:1,enabled:false,enrollment:null,manifest:parseManifest(Buffer.from(JSON.stringify({version:1,repository:REPOSITORY,enabled:false,tasks:[]}))),signature:null}}
