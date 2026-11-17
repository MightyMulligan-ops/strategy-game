/** Offline policy only. A signature is authority only after out-of-band owner
 * key enrollment and a fresh authenticated GitHub owner-permission lookup.
 * No issue/comment/label or worker-provided boolean can enroll a key. */
import {createPublicKey, verify} from 'node:crypto';
import {canonicalScope, sha256, validPath, REPOSITORY, OWNER, SHA, DIGEST, type TaskScope} from './codex-automation-policy.ts';
import {requireControl} from './codex-run-control.ts';
import type {GitHubTransport} from './codex-github-control.ts';

export const OWNER_ID = 353505747;
export const MAX_CODING_SECONDS = 900; // Preserve the pilot's 15-minute ceiling.
export const FORBIDDEN_OPERATIONS = ['dependencies','workflows','permissions','secrets','databases','migrations','merge','deploy','recursive-dispatch'] as const;
export const FORBIDDEN_PATHS = ['.github/','.git/','database/','scripts/','docs/','AGENTS.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml'] as const;
export type QueueTask = Readonly<{
  issue:number; title:string; issueDigest:string; scopeText:string; approvalId:string;
  approvalDigest:string; allowedPaths:readonly string[]; codingSeconds:number|null; maxSessions:1;
}>;
export type ScheduledQueueManifest = Readonly<{
  version:1; repository:typeof REPOSITORY; enabled:true; queueId:string; authorizationId:string;
  baselineSha:string; baselinePolicy:'exact-main-independent-prs-v1'; timezone:'America/New_York';
  localDate:string; startsAt:string; endsAt:string; dispatchGraceSeconds:900;
  forbiddenPaths:readonly string[]; forbiddenOperations:readonly string[]; tasks:readonly QueueTask[];
}>;
/** Manual authorization has no calendar admission window. Its one-use durable
 * reservation starts its infrastructure scope lifetime; cron cannot consume it. */
export type ManualQueueManifest = Readonly<Omit<ScheduledQueueManifest,
  'version'|'timezone'|'localDate'|'startsAt'|'endsAt'|'dispatchGraceSeconds'> & {
  version:2; launchMode:'manual'; softLimitUsd:50; spendPolicy:'platform-project-limit';
}>;
export type QueueManifest = ScheduledQueueManifest | ManualQueueManifest;
// Infrastructure watchdog only, not an owner-selected coding allowance. Stop the
// controller before the six-hour Actions Agent job limit so cleanup can run.
export const MANUAL_AGENT_WALL_SECONDS=6*60*60-120;
const MANUAL_RUN_WALL_SECONDS=24*60*60; // scope lifetime across separate queued jobs
export const signaturePayload=(m:QueueManifest)=>
  `SOVEREIGN-OVERNIGHT-V${m.version}\n`+canonical(m);
export function queueDeadline(m:QueueManifest,startedAt?:string):string {
  if(m.version===1)return m.endsAt;
  requireControl(typeof startedAt==='string'&&Number.isFinite(Date.parse(startedAt))&&
    new Date(startedAt).toISOString()===startedAt,'queue-runtime-origin');
  return new Date(Date.parse(startedAt)+MANUAL_RUN_WALL_SECONDS*1000).toISOString();
}
export type DisabledManifest = {version:1;repository:typeof REPOSITORY;enabled:false;tasks:[]};
const ID=/^[A-Za-z0-9_-]{1,80}$/;
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
  requireControl(v!==null&&typeof v==='object'&&!Array.isArray(v),'queue-shape');
  const r=v as Record<string,unknown>;
  requireControl(Object.keys(r).length===keys.length&&keys.every(k=>Object.hasOwn(r,k)),'queue-fields');return r;
}
function text(v:unknown,max:number):asserts v is string {
  requireControl(typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=max&&!/[\u0000-\u001f\u007f]/.test(v),'queue-text');
}
export function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  const v=JSON.stringify(value);requireControl(v!==undefined,'queue-json');return v;
}
/** Parse JSON, not arbitrary live objects with serialization hooks. */
export function parseManifest(bytes:Uint8Array):QueueManifest|DisabledManifest {
  requireControl(bytes.length>0&&bytes.length<=128*1024,'queue-size');
  const raw:unknown=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
  requireControl(raw!==null&&typeof raw==='object'&&!Array.isArray(raw),'queue-shape');
  if((raw as Record<string,unknown>).enabled===false){
    const d=object(raw,['version','repository','enabled','tasks']);
    requireControl(d.version===1&&d.repository===REPOSITORY&&Array.isArray(d.tasks)&&d.tasks.length===0,'queue-disabled-config');
    return raw as DisabledManifest;
  }
  const manual=(raw as Record<string,unknown>).version===2;
  const m=object(raw,['version','repository','enabled','queueId','authorizationId','baselineSha','baselinePolicy',
    ...(manual?['launchMode','softLimitUsd','spendPolicy']:['timezone','localDate','startsAt','endsAt','dispatchGraceSeconds']),
    'forbiddenPaths','forbiddenOperations','tasks']);
  requireControl((m.version===1||m.version===2)&&m.repository===REPOSITORY&&m.enabled===true&&
    typeof m.queueId==='string'&&ID.test(m.queueId)&&typeof m.authorizationId==='string'&&ID.test(m.authorizationId)&&
    typeof m.baselineSha==='string'&&SHA.test(m.baselineSha)&&m.baselinePolicy==='exact-main-independent-prs-v1'&&
    canonical(m.forbiddenPaths)===canonical(FORBIDDEN_PATHS)&&canonical(m.forbiddenOperations)===canonical(FORBIDDEN_OPERATIONS),'queue-policy');
  if(manual){
    requireControl(m.launchMode==='manual'&&m.softLimitUsd===50&&m.spendPolicy==='platform-project-limit','queue-spend-policy');
  }else{
    requireControl(m.timezone==='America/New_York'&&m.dispatchGraceSeconds===900&&typeof m.localDate==='string'&&typeof m.startsAt==='string'&&typeof m.endsAt==='string'&&
    m.startsAt===easternStart(m.localDate)&&new Date(m.endsAt).toISOString()===m.endsAt&&
    Date.parse(m.endsAt)>Date.parse(m.startsAt)&&Date.parse(m.endsAt)-Date.parse(m.startsAt)<=4*60*60*1000,'queue-window');
  }
  requireControl(Array.isArray(m.tasks)&&m.tasks.length>=1&&m.tasks.length<=(manual?1:3),'queue-task-count');
  const issues=new Set<number>(),approvals=new Set<string>();
  for(const rawTask of m.tasks){
    const t=object(rawTask,['issue','title','issueDigest','scopeText','approvalId','approvalDigest','allowedPaths','codingSeconds','maxSessions']);
    requireControl(typeof t.issue==='number'&&Number.isSafeInteger(t.issue)&&t.issue>0&&t.issue!==76&&!issues.has(t.issue),'queue-issue');
    text(t.title,256);requireControl(typeof t.scopeText==='string'&&t.scopeText.trim().length>0&&Buffer.byteLength(t.scopeText)<=32*1024,'queue-scope');
    requireControl(typeof t.issueDigest==='string'&&DIGEST.test(t.issueDigest)&&typeof t.approvalId==='string'&&ID.test(t.approvalId)&&!approvals.has(t.approvalId),'queue-approval-id');
    requireControl(Array.isArray(t.allowedPaths)&&t.allowedPaths.length>=1&&t.allowedPaths.length<=25&&new Set(t.allowedPaths).size===t.allowedPaths.length&&
      t.allowedPaths.every(p=>typeof p==='string'&&validPath(p)&&!FORBIDDEN_PATHS.some(f=>p===f||p.startsWith(f))),'queue-paths');
    requireControl((manual?t.codingSeconds===null:typeof t.codingSeconds==='number'&&Number.isSafeInteger(t.codingSeconds)&&t.codingSeconds>=1&&t.codingSeconds<=MAX_CODING_SECONDS)&&t.maxSessions===1,'queue-session-limit');
    const {approvalDigest,...approved}=t;
    requireControl(typeof approvalDigest==='string'&&approvalDigest===sha256(canonical(approved)),'queue-task-digest');
    issues.add(t.issue);approvals.add(t.approvalId);
  }
  return raw as QueueManifest;
}
/** 22:30 is never an ambiguous/missing Eastern DST hour. Construct candidate UTC
 * instants and verify the complete local date/time using IANA zone data. */
export function easternStart(date:string):string {
  requireControl(/^\d{4}-\d{2}-\d{2}$/.test(date),'queue-local-date');
  const noon=new Date(date+'T12:00:00.000Z');
  requireControl(Number.isFinite(noon.getTime())&&noon.toISOString().slice(0,10)===date,'queue-local-date');
  const f=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const candidates=[4,5].map(offset=>new Date(Date.parse(date+'T22:30:00.000Z')+offset*3600000));
  const matches=candidates.filter(d=>{const p=Object.fromEntries(f.formatToParts(d).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`===date&&p.hour==='22'&&p.minute==='30'});
  requireControl(matches.length===1,'queue-ambiguous-window');return matches[0]!.toISOString();
}
export function taskScope(m:QueueManifest,t:QueueTask,startedAt?:string):TaskScope {
  const s={repository:REPOSITORY,issue:t.issue,sourceSha:m.baselineSha,baseSha:m.baselineSha,
    approvedPaths:t.allowedPaths,acceptanceDigest:sha256(t.scopeText),expiresAt:queueDeadline(m,startedAt)};
  canonicalScope(s);return s;
}
export const manifestDigest=(m:QueueManifest)=>sha256(canonical(m));
export const issueDigest=(title:string,body:string)=>sha256(canonical({title,body}));
export type Enrollment=Readonly<{publicKeyPem:string;fingerprint:string}>;
export type Trigger=Readonly<{repository:string;actor:string;actorId:number;ref:string;event:'workflow_dispatch'|'schedule';runId:string;attempt:number;sourceSha:string}>;
/** Re-fetch on EVERY protected boundary. No authentication result is persisted
 * as a reusable permission. A signed manifest is not a provider billing limit. */
export class QueueAuthority {
  constructor(private readonly api:GitHubTransport,private readonly enrollment:Enrollment,
    private readonly bytes:Uint8Array,private readonly signature:Uint8Array,private readonly trigger:Trigger){}
  get runId():string{return this.trigger.runId}
  async check(now:Date,dispatch=false,startedAt?:string):Promise<QueueManifest|DisabledManifest>{
    const m=parseManifest(this.bytes);if(!m.enabled)return m;
    const e=this.trigger;
    requireControl(e.repository===REPOSITORY&&e.ref==='refs/heads/main'&&e.sourceSha===m.baselineSha&&e.attempt===1&&/^\d{1,20}$/.test(e.runId)&&
      (e.event==='workflow_dispatch'?e.actor===OWNER&&e.actorId===OWNER_ID:e.event==='schedule'),'queue-trigger');
    const key=createPublicKey(this.enrollment.publicKeyPem);
    requireControl(key.asymmetricKeyType==='ed25519'&&sha256(key.export({type:'spki',format:'der'}))===this.enrollment.fingerprint&&
      this.signature.length===64&&verify(null,Buffer.from(signaturePayload(m)),key,this.signature),'queue-owner-signature');
    const ms=now.getTime();
    if(m.version===2){
      requireControl(e.event==='workflow_dispatch','queue-manual-trigger');
      requireControl(Number.isFinite(ms),'queue-runtime-clock');
      if(!dispatch)requireControl(typeof startedAt==='string'&&ms>=Date.parse(startedAt)&&
        ms<Date.parse(queueDeadline(m,startedAt)),'queue-runtime-exhausted');
    }else{
      const start=Date.parse(m.startsAt),end=Date.parse(m.endsAt);
      requireControl(Number.isFinite(ms)&&ms>=start&&ms<end&&(!dispatch||ms<start+m.dispatchGraceSeconds*1000),'queue-expired-or-late');
    }
    const get=async(path:string)=>{
      const r=await this.api.request('GET',path);requireControl(r.status===200&&r.data!==null&&typeof r.data==='object'&&!Array.isArray(r.data),'queue-authority-unavailable');
      return r.data as Record<string,unknown>;
    };
    const permission=await get(`/collaborators/${OWNER}/permission`),user=permission.user as Record<string,unknown>|undefined;
    requireControl(permission.permission==='admin'&&user?.login===OWNER&&user.id===OWNER_ID&&user.type==='User','queue-non-owner');
    const main=await get('/git/ref/heads/main');
    requireControl(main.ref==='refs/heads/main'&&(main.object as Record<string,unknown>)?.sha===m.baselineSha,'queue-main-drift');
    for(const t of m.tasks){
      const issue=await get(`/issues/${t.issue}`);
      requireControl(issue.number===t.issue&&issue.state==='open'&&!Object.hasOwn(issue,'pull_request')&&issue.title===t.title&&typeof issue.body==='string'&&
        issueDigest(t.title,issue.body)===t.issueDigest,'queue-issue-drift');
    }
    return m;
  }
}
