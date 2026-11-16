/** Dedicated Git-ref CAS ledger, separate from application and cost ledgers.
 * No bootstrap/release CLI is installed. Lost writes, crashes and stale claims
 * require owner reconciliation; there is deliberately no expiring lease. */
import {randomUUID} from 'node:crypto';
import {requireControl} from './codex-run-control.ts';
import {SHA,DIGEST,REPOSITORY,sha256,canonicalScope} from './codex-automation-policy.ts';
import {canonical,manifestDigest,taskScope,type QueueManifest} from './overnight-policy.ts';
import type {GitHubTransport} from './codex-github-control.ts';
import {verifyChecks,type CheckSuccess} from './codex-pilot-receipt.ts';
import {PROVIDER_ID} from './codex-pilot-diagnostics.ts';

export const QUEUE_REF='sovereign-overnight-ledger-v1';
const PATH='.sovereign/overnight-ledger.json';
export const PHASES=['pending','preparing','agent_running','validating','publishing','draft_pr_created','failed','stopped'] as const;
export type Phase=typeof PHASES[number];
export type TaskRecord={issue:number;title:string;approvalId:string;approvalDigest:string;scopeDigest:string;issueDigest:string;
  phase:Phase;sessions:0|1;sessionId:string|null;terminated:boolean;startedAt:string|null;endedAt:string|null;
  reason:string|null;terminationReceipt?:string;receipt:{digest:string;treeSha:string;checks:readonly CheckSuccess[]}|null;
  pr:{number:number;url:string;headSha:string}|null};
export type QueueRecord={queueId:string;authorizationId:string;manifestDigest:string;baselineSha:string;runId:string;attempt:1;
  status:'running'|'completed'|'failed'|'stopped';startedAt:string;endedAt:string|null;reason:string|null;tasks:TaskRecord[]};
export type QueueLedger={version:1;repository:typeof REPOSITORY;active:{queueId:string;runId:string;kind:'queue'|'pilot'}|null;runs:QueueRecord[];
  reconciliations?:{approvalId:string;digest:string;queueId:string;runId:string;at:string;priorStatus:string;priorPhases:Phase[]}[]};
export type LedgerSnapshot={revision:string;ledger:QueueLedger};
export interface QueueStore {read():Promise<LedgerSnapshot>;compareAndSwap(revision:string,value:QueueLedger):Promise<boolean>}
const ID=/^[A-Za-z0-9_-]{1,80}$/;
const timestamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const reason=(v:unknown)=>v===null||typeof v==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(v);
export function emptyLedger():QueueLedger{return {version:1,repository:REPOSITORY,active:null,runs:[]}}
export function validateQueueLedger(v:QueueLedger):void{
  requireControl(v&&v.version===1&&v.repository===REPOSITORY&&Array.isArray(v.runs)&&v.runs.length<=128,'queue-ledger');
  const ids=new Set<string>(),authorizations=new Set<string>(),runIds=new Set<string>(),approvals=new Set<string>();
  for(const r of v.runs){
    requireControl(r&&ID.test(r.queueId)&&ID.test(r.authorizationId)&&DIGEST.test(r.manifestDigest)&&SHA.test(r.baselineSha)&&
      /^\d{1,20}$/.test(r.runId)&&r.attempt===1&&['running','completed','failed','stopped'].includes(r.status)&&
      timestamp(r.startedAt)&&(r.endedAt===null||timestamp(r.endedAt))&&reason(r.reason)&&
      Array.isArray(r.tasks)&&r.tasks.length>=1&&r.tasks.length<=3&&!ids.has(r.queueId)&&!authorizations.has(r.authorizationId)&&!runIds.has(r.runId),'queue-ledger-run');
    ids.add(r.queueId);authorizations.add(r.authorizationId);runIds.add(r.runId);
    const issues=new Set<number>();let incomplete=false;
    for(const t of r.tasks){
      requireControl(t&&Number.isSafeInteger(t.issue)&&t.issue>0&&t.issue!==76&&!issues.has(t.issue)&&typeof t.title==='string'&&t.title.length<=256&&
        ID.test(t.approvalId)&&!approvals.has(t.approvalId)&&DIGEST.test(t.approvalDigest)&&DIGEST.test(t.scopeDigest)&&DIGEST.test(t.issueDigest)&&
        PHASES.includes(t.phase)&&(t.sessions===0||t.sessions===1)&&typeof t.terminated==='boolean'&&
        (t.sessionId===null||PROVIDER_ID.test(t.sessionId))&&
        (t.startedAt===null||timestamp(t.startedAt))&&(t.endedAt===null||timestamp(t.endedAt))&&reason(t.reason),'queue-ledger-task');
      requireControl(t.sessions===1||t.sessionId===null&&!t.terminated,'queue-ledger-session');
      requireControl(t.terminationReceipt===undefined||t.terminated&&DIGEST.test(t.terminationReceipt),'queue-ledger-termination-receipt');
      requireControl(!['agent_running','validating','publishing','draft_pr_created'].includes(t.phase)||t.sessions===1,'queue-ledger-start');
      requireControl(!['validating','publishing','draft_pr_created'].includes(t.phase)||t.terminated&&t.sessionId!==null,'queue-ledger-termination');
      requireControl(!incomplete||['pending','stopped'].includes(t.phase),'queue-ledger-order');
      if(t.phase!=='draft_pr_created')incomplete=true;
      if(t.receipt!==null){requireControl(DIGEST.test(t.receipt.digest)&&SHA.test(t.receipt.treeSha),'queue-ledger-receipt');verifyChecks(t.receipt.checks)}
      if(t.pr!==null)requireControl(Number.isSafeInteger(t.pr.number)&&t.pr.number>0&&t.pr.url===`https://github.com/${REPOSITORY}/pull/${t.pr.number}`&&SHA.test(t.pr.headSha)&&t.receipt!==null&&t.phase==='draft_pr_created','queue-ledger-pr');
      requireControl(t.phase!=='draft_pr_created'||t.pr!==null,'queue-ledger-publication');
      issues.add(t.issue);approvals.add(t.approvalId);
    }
    requireControl(r.status!=='completed'||r.tasks.every(t=>t.phase==='draft_pr_created')&&r.endedAt!==null,'queue-ledger-completion');
  }
  if(v.active!==null){
    requireControl(v.active&&['queue','pilot'].includes(v.active.kind)&&v.runs.some(r=>r.queueId===v.active!.queueId&&r.runId===v.active!.runId),'queue-ledger-lock');
  }
  requireControl(!v.runs.some(r=>r.status==='running'&&(v.active?.queueId!==r.queueId||v.active.runId!==r.runId)),'queue-ledger-unlocked-running');
  if(v.reconciliations!==undefined)requireControl(Array.isArray(v.reconciliations)&&v.reconciliations.length<=128&&new Set(v.reconciliations.map(r=>r.approvalId)).size===v.reconciliations.length&&
    v.reconciliations.every(r=>ID.test(r.approvalId)&&DIGEST.test(r.digest)&&ID.test(r.queueId)&&/^\d{1,20}$/.test(r.runId)&&timestamp(r.at)&&
      ['running','failed','stopped'].includes(r.priorStatus)&&Array.isArray(r.priorPhases)&&r.priorPhases.every(p=>PHASES.includes(p))),'queue-reconciliation-history');
}
/** No retry loop: CAS contention or an unknown response stops this caller. */
export class QueueJournal {
  constructor(private readonly store:QueueStore){}
  private async change(fn:(l:QueueLedger)=>void){
    const {revision,ledger}=await this.store.read();validateQueueLedger(ledger);
    const next=structuredClone(ledger);fn(next);validateQueueLedger(next);
    requireControl(await this.store.compareAndSwap(revision,next),'queue-ledger-contention');return next;
  }
  async reserve(m:QueueManifest,runId:string,now:Date,kind:'queue'|'pilot'='queue'){
    return this.change(l=>{
      requireControl(l.active===null&&l.runs.length<128&&!l.runs.some(r=>r.queueId===m.queueId||r.authorizationId===m.authorizationId||r.runId===runId||
        r.tasks.some(t=>m.tasks.some(a=>t.approvalId===a.approvalId))),'queue-already-claimed');
      l.active={queueId:m.queueId,runId,kind};
      l.runs.push({queueId:m.queueId,authorizationId:m.authorizationId,manifestDigest:manifestDigest(m),baselineSha:m.baselineSha,
        runId,attempt:1,status:'running',startedAt:now.toISOString(),endedAt:null,reason:null,
        tasks:m.tasks.map(t=>({issue:t.issue,title:t.title,approvalId:t.approvalId,approvalDigest:t.approvalDigest,issueDigest:t.issueDigest,
          scopeDigest:sha256(canonicalScope(taskScope(m,t))),phase:'pending',sessions:0,sessionId:null,terminated:false,startedAt:null,endedAt:null,reason:null,receipt:null,pr:null}))});
    });
  }
  async step(queueId:string,runId:string,index:number,expected:Phase,next:Phase,now:Date,
    evidence:{sessionId?:string;terminationReceipt?:string;receipt?:NonNullable<TaskRecord['receipt']>;pr?:NonNullable<TaskRecord['pr']>}={}){
    return this.change(l=>{
      const r=l.runs.find(r=>r.queueId===queueId&&r.runId===runId),t=r?.tasks[index];
      requireControl(l.active?.queueId===queueId&&l.active.runId===runId&&r?.status==='running'&&t?.phase===expected&&
        r.tasks.slice(0,index).every(t=>t.phase==='draft_pr_created'),'queue-transition-owner');
      const edge=expected+'>'+next;
      requireControl(['pending>preparing','preparing>agent_running','agent_running>validating','validating>publishing','publishing>draft_pr_created'].includes(edge),'queue-transition');
      if(next==='preparing')t.startedAt=now.toISOString();
      if(next==='agent_running'){requireControl(t.sessions===0,'queue-session-replay');t.sessions=1}
      if(next==='validating'){requireControl(typeof evidence.sessionId==='string'&&(t.sessionId===null||t.sessionId===evidence.sessionId),'queue-session-termination');t.sessionId=evidence.sessionId;t.terminated=true;if(evidence.terminationReceipt)t.terminationReceipt=evidence.terminationReceipt}
      if(next==='publishing'){requireControl(evidence.receipt,'queue-validation-required');t.receipt=structuredClone(evidence.receipt)}
      if(next==='draft_pr_created'){requireControl(evidence.pr,'queue-publication-required');t.pr=structuredClone(evidence.pr);t.endedAt=now.toISOString()}
      t.phase=next;
      if(r.tasks.every(t=>t.phase==='draft_pr_created')){r.status='completed';r.endedAt=now.toISOString();l.active=null}
    });
  }
  async fail(queueId:string,runId:string,index:number,now:Date){
    return this.change(l=>{
      const r=l.runs.find(r=>r.queueId===queueId&&r.runId===runId);
      requireControl(r?.status==='running'&&l.active?.queueId===queueId&&l.active.runId===runId,'queue-stop-owner');
      r.status='failed';r.reason='boundary-failed-or-uncertain';r.endedAt=now.toISOString();
      r.tasks.forEach((t,i)=>{if(i>=index&&t.phase!=='draft_pr_created'){t.phase=i===index?'failed':'stopped';t.reason=i===index?'boundary-failed-or-uncertain':'blocked-by-earlier-failure';t.endedAt=now.toISOString()}});
      // Keep global exclusion even on apparent timeout/failure. A timer does not
      // prove server-side session termination. No stale-lock stealing exists.
    });
  }
  /** Trusted provider observation only; commit as soon as the authenticated ID
   * arrives. A crash before this write still retains the irrevocable claim. */
  async observeSession(queueId:string,runId:string,index:number,sessionId:string){
    return this.change(l=>{
      const r=l.runs.find(r=>r.queueId===queueId&&r.runId===runId),t=r?.tasks[index];
      requireControl(l.active?.queueId===queueId&&l.active.runId===runId&&r?.status==='running'&&t?.phase==='agent_running'&&
        PROVIDER_ID.test(sessionId)&&(t.sessionId===null||t.sessionId===sessionId),'queue-session-observation');
      t.sessionId=sessionId;
    });
  }
  async snapshot(){const s=await this.store.read();validateQueueLedger(s.ledger);return s.ledger}
  /** Caller must authenticate owner signature + separate provider-job receipt.
   * Stop only; never restore a consumed approval or resume the old queue. */
  async reconcileStop(revision:string,queueId:string,runId:string,approvalId:string,digest:string,terminatedIds:readonly string[],neverStarted:readonly number[],at:Date){
    const snapshot=await this.store.read();requireControl(snapshot.revision===revision,'queue-reconcile-state-changed');
    const l=structuredClone(snapshot.ledger);validateQueueLedger(l);
    const r=l.runs.find(r=>r.queueId===queueId&&r.runId===runId);
    requireControl(r&&r.status!=='completed'&&l.active?.queueId===queueId&&l.active.runId===runId&&
      !l.reconciliations?.some(x=>x.approvalId===approvalId),'queue-reconcile-owner');
    requireControl(new Set(terminatedIds).size===terminatedIds.length&&new Set(neverStarted).size===neverStarted.length&&
      canonical([...terminatedIds].sort())===canonical(r.tasks.flatMap(t=>t.sessions&&t.sessionId?[t.sessionId]:[]).sort())&&
      canonical([...neverStarted].sort())===canonical(r.tasks.flatMap((t,i)=>t.sessions&&!t.sessionId?[i]:[]).sort()),'queue-reconcile-unproven-session');
    l.reconciliations??=[];l.reconciliations.push({approvalId,digest,queueId,runId,at:at.toISOString(),priorStatus:r.status,priorPhases:r.tasks.map(t=>t.phase)});
    r.status='stopped';r.reason='owner-reconciled-stop';r.endedAt=at.toISOString();
    r.tasks.forEach(t=>{if(t.sessionId)t.terminated=true;if(t.phase!=='draft_pr_created'){t.phase='stopped';t.reason??='owner-reconciled-stop';t.endedAt??=at.toISOString()}});
    l.active=null;validateQueueLedger(l);requireControl(await this.store.compareAndSwap(revision,l),'queue-reconcile-contention');return l;
  }
}
function rec(v:unknown):Record<string,unknown>{requireControl(v!==null&&typeof v==='object'&&!Array.isArray(v),'queue-github-object');return v as Record<string,unknown>}
function gitSha(v:unknown):string{requireControl(typeof v==='string'&&SHA.test(v),'queue-github-sha');return v}
export class GitHubQueueStore implements QueueStore {
  constructor(private readonly api:GitHubTransport){}
  private async get(path:string){const r=await this.api.request('GET',path);requireControl(r.status===200,'queue-ledger-unavailable');return rec(r.data)}
  async read():Promise<LedgerSnapshot>{
    const ref=await this.get(`/git/ref/heads/${QUEUE_REF}`);
    requireControl(ref.ref===`refs/heads/${QUEUE_REF}`,'queue-ledger-ref');const revision=gitSha(rec(ref.object).sha);
    const f=await this.get(`/contents/${PATH}?ref=${revision}`);
    requireControl(f.type==='file'&&f.encoding==='base64'&&typeof f.content==='string'&&f.content.length<=350000&&
      typeof f.size==='number'&&f.size>0&&f.size<=256*1024,'queue-ledger-size');
    const bytes=Buffer.from(f.content,'base64');requireControl(bytes.length===f.size,'queue-ledger-size');
    const ledger=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes)) as QueueLedger;validateQueueLedger(ledger);return {revision,ledger};
  }
  private async commit(ledger:QueueLedger,parents:string[]){
    validateQueueLedger(ledger);const content=canonical(ledger);requireControl(Buffer.byteLength(content)<=256*1024,'queue-ledger-full');
    const tree=await this.api.request('POST','/git/trees',{tree:[{path:PATH,mode:'100644',type:'blob',content}]});
    requireControl(tree.status===201,'queue-ledger-tree');
    const commit=await this.api.request('POST','/git/commits',{tree:gitSha(rec(tree.data).sha),parents,message:'Sovereign queue ledger '+randomUUID()});
    requireControl(commit.status===201,'queue-ledger-commit');return gitSha(rec(commit.data).sha);
  }
  async compareAndSwap(revision:string,ledger:QueueLedger){
    const sha=await this.commit(ledger,[gitSha(revision)]);
    const r=await this.api.request('PATCH',`/git/refs/heads/${QUEUE_REF}`,{sha,force:false});
    if(r.status===409||r.status===422)return false;
    requireControl(r.status===200&&rec(rec(r.data).object).sha===sha,'queue-ledger-write-uncertain');return true;
  }
  /** Explicit operator operation; never invoked by queue execution or tests on GitHub. */
  async bootstrap(){
    const r=await this.api.request('GET',`/git/ref/heads/${QUEUE_REF}`);requireControl(r.status===404,'queue-ledger-exists-or-inaccessible');
    const sha=await this.commit(emptyLedger(),[]),created=await this.api.request('POST','/git/refs',{ref:`refs/heads/${QUEUE_REF}`,sha});
    requireControl(created.status===201&&rec(created.data).ref===`refs/heads/${QUEUE_REF}`&&rec(rec(created.data).object).sha===sha,'queue-ledger-bootstrap-uncertain');
  }
}
