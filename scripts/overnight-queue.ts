/** OFFLINE coordinator seam. No provider client, credentials, workflow dispatch,
 * paid launcher or publisher is installed here. A future deployment MUST put
 * these adapters in distinct privilege domains, not one credentialed process. */
import {sha256,canonicalScope,REPOSITORY,SHA} from './codex-automation-policy.ts';
import {requireControl} from './codex-run-control.ts';
import {taskScope,queueDeadline,MANUAL_AGENT_WALL_SECONDS,manifestDigest,type QueueAuthority,type QueueManifest,type QueueTask} from './overnight-policy.ts';
import {QueueJournal,type QueueLedger} from './overnight-ledger.ts';
import {verifyBundle,verifyValidationReceipt,type ValidationBundle} from './codex-pilot-receipt.ts';
import {sanitizeDiagnostic} from './codex-pilot-diagnostics.ts';

export type BoundaryContext=Readonly<{manifest:QueueManifest;task:QueueTask;index:number;runId:string;branch:string;signal:AbortSignal;startedAt:string;
  recordSession:(authenticatedSessionId:string)=>Promise<void>}>;
export type AgentOutput=Readonly<{sessionId:string;terminationConfirmed:true;bundle:ValidationBundle}>;
export type ValidatedOutput=Readonly<{bytes:Uint8Array;trustedJob:{runId:string;attempt:1;sourceSha:string;conclusion:'success';receiptDigest:string}}>;
export type PublishedOutput=Readonly<{number:number;url:string;headSha:string;treeSha:string;sourceSha:string;draft:true}>;
export interface OfflineQueueAdapters {
  prepare(c:BoundaryContext):Promise<void>;
  /** Must reserve before POST, never retry it, enforce provider cancellation,
   * bound output and confirm deletion BEFORE returning. No GitHub write token. */
  agent(c:BoundaryContext):Promise<AgentOutput>;
  /** Separate key-free/write-token-free job using PR90 host tree verification
   * and all four actual isolated networkless checks. Never trust worker receipts. */
  validate(c:BoundaryContext,output:AgentOutput):Promise<ValidatedOutput>;
  /** Distinct API-key-free publisher: reconstruct exact validated tree, recheck
   * approval/source, claim once and create ONE draft; unknown responses stop. */
  publish(c:BoundaryContext,output:AgentOutput,validation:ValidatedOutput):Promise<PublishedOutput>;
}
async function bounded<T>(seconds:number,controller:AbortController,work:()=>Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(work),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(Error('queue-boundary-timeout'))},seconds*1000);
  })])}catch(error){controller.abort();throw error}finally{clearTimeout(timer)}
}
export async function runOfflineQueue(authority:Pick<QueueAuthority,'check'|'runId'>,journal:QueueJournal,runId:string,
  adapters:OfflineQueueAdapters,now:()=>Date=()=>new Date()):Promise<{status:'disabled'|'completed'|'failed';ledger:QueueLedger|null}>{
  const m=await authority.check(now(),true);
  if(!m.enabled)return {status:'disabled',ledger:null};
  requireControl(authority.runId===runId,'queue-run-binding');
  // Admission failure before reservation throws; it cannot clear someone else's
  // lock. A durable claim precedes ANY adapter or potentially billable call.
  const startedAt=now().toISOString();
  await journal.reserve(m,runId,new Date(startedAt));
  let index=0;
  const check=async()=>{
    const fresh=await authority.check(now(),false,startedAt);
    requireControl(fresh.enabled&&manifestDigest(fresh)===manifestDigest(m),'queue-authorization-changed');
  };
  const remaining=(limit:number)=>{
    const seconds=Math.min(limit,(Date.parse(queueDeadline(m,startedAt))-now().getTime())/1000);
    requireControl(Number.isFinite(seconds)&&seconds>0,'queue-window-exhausted');return seconds;
  };
  try{
    for(index=0;index<m.tasks.length;index++){
      const task=m.tasks[index]!,taskIndex=index,controller=new AbortController();
      const context:BoundaryContext={manifest:m,task,index,runId,startedAt,branch:`queue/${m.queueId}/${task.issue}-${runId}`,signal:controller.signal,
        async recordSession(id){await journal.observeSession(m.queueId,runId,taskIndex,id)}};
      await check();await journal.step(m.queueId,runId,index,'pending','preparing',now());
      await bounded(remaining(300),controller,()=>adapters.prepare(context));
      await check();await journal.step(m.queueId,runId,index,'preparing','agent_running',now());
      const started=now().getTime(),codingSeconds=remaining(task.codingSeconds??MANUAL_AGENT_WALL_SECONDS);
      const output=await bounded(codingSeconds,controller,()=>adapters.agent(context));
      const elapsed=now().getTime()-started;
      requireControl(elapsed>=0&&elapsed<codingSeconds*1000&&output.terminationConfirmed===true&&
        typeof output.sessionId==='string'&&/^sess_[A-Za-z0-9_-]{1,120}$/.test(output.sessionId),'queue-agent-incomplete');
      const {scope}=verifyBundle(output.bundle);
      requireControl(canonicalScope(scope)===canonicalScope(taskScope(m,task,startedAt)),'queue-proposal-scope');
      await check();await journal.step(m.queueId,runId,index,'agent_running','validating',now(),{sessionId:output.sessionId});
      const validation=await bounded(remaining(1200),controller,()=>adapters.validate(context,output));
      const job=validation.trustedJob;
      requireControl(job&&job.runId===runId&&job.attempt===1&&job.sourceSha===m.baselineSha&&job.conclusion==='success','queue-validation-job');
      const receipt=verifyValidationReceipt(validation.bytes,job.receiptDigest,{runId,sourceSha:m.baselineSha},output.bundle);
      await check();await journal.step(m.queueId,runId,index,'validating','publishing',now(),{
        receipt:{digest:sha256(validation.bytes),treeSha:receipt.treeSha,checks:receipt.checks}});
      const published=await bounded(remaining(300),controller,()=>adapters.publish(context,output,validation));
      requireControl(published.draft===true&&published.sourceSha===m.baselineSha&&published.treeSha===receipt.treeSha&&
        Number.isSafeInteger(published.number)&&published.number>0&&published.url===`https://github.com/${REPOSITORY}/pull/${published.number}`&&SHA.test(published.headSha),'queue-publication-mismatch');
      await journal.step(m.queueId,runId,index,'publishing','draft_pr_created',now(),{
        pr:{number:published.number,url:published.url,headSha:published.headSha}});
    }
    return {status:'completed',ledger:await journal.snapshot()};
  }catch{
    // No retries, raw errors or automatic lease release. If fail() itself loses
    // its response, the previous durable in-progress claim remains authoritative.
    await journal.fail(m.queueId,runId,index,now());
    return {status:'failed',ledger:await journal.snapshot()};
  }
}
const safe=(s:string)=>s.replace(/[\\`*_{}[\]()<>#!|]/g,'\\$&');
export function morningReport(ledger:QueueLedger,queueId:string):string{
  const r=ledger.runs.find(r=>r.queueId===queueId);requireControl(r,'queue-report-missing');
  const reserved=r.tasks.reduce((n,t)=>n+t.sessions,0),observed=r.tasks.filter(t=>t.sessionId!==null).length;
  const lines=[`# Overnight queue ${safe(r.queueId)}`,`Status: ${r.status}. Run ${r.runId}, attempt ${r.attempt}.`,
    `Start: ${r.startedAt}. End: ${r.endedAt??'UNKNOWN — reconciliation required'}.`,
    `Baseline: ${r.baselineSha}. Manifest digest: ${r.manifestDigest}.`,
    `Session starts reserved: ${reserved}; confirmed session identities: ${observed}. A reservation is not proof that a billable session began.`,
    'Provider usage/billing: UNKNOWN. No dollar estimate or spending guarantee is inferred.',
    'No PR was merged or deployed by this queue.'];
  for(const t of r.tasks){
    const completed=['validating','publishing','draft_pr_created'].includes(t.phase)&&t.terminated&&
      (t.terminationReceipt!==undefined||t.receipt!==null||t.pr!==null);
    const coding=t.sessions===0?'not started':t.phase==='failed'?'success not verified (task failed)':
      t.phase==='stopped'?'success not verified (task stopped or canceled)':completed?'completion verified':'in progress or UNKNOWN; success not verified';
    const id=sanitizeDiagnostic({version:1,stage:'session_stream',code:'session_observed',...(t.sessionId!==null?{sessionId:t.sessionId}:{})}).sessionId;
    const sessionId=id&&!/^gh[pousr]_/i.test(id)?id:t.sessionId===null?'UNKNOWN':'WITHHELD (unsafe identifier)';
    lines.push('',`## Issue #${t.issue}: ${safe(t.title)}`,`State: ${t.phase}. Execution: ${t.sessions?'start reserved; inspect provider reconciliation if identity is missing':'not started'}.`,
      `Session ID: ${sessionId}.`,
      `Coding: ${coding}.`,
      `Provider termination: ${t.terminated?'confirmed':t.sessions?'unconfirmed':'not applicable'}.`,
      `Validation: ${t.receipt?'passed; receipt '+t.receipt.digest:'no verified successful receipt'}.`,
      `Checks executed: ${t.receipt?t.receipt.checks.map(c=>c.command+': passed').join(', '):'UNKNOWN or not reached; no pass inferred'}. Test case counts: UNKNOWN (not supplied by receipt).`,
      `Draft PR: ${t.pr?t.pr.url:'none confirmed; publishing/failed states may require remote reconciliation'}.`,
      `Stop reason: ${t.reason??'none recorded'}.`);
  }
  return lines.join('\n')+'\n';
}
