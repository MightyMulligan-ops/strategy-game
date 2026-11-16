import {generateKeyPairSync,sign} from 'node:crypto';
import {REPOSITORY,OWNER,sha256,canonicalScope} from '../codex-automation-policy.ts';
import {canonical,easternStart,issueDigest,FORBIDDEN_PATHS,FORBIDDEN_OPERATIONS,OWNER_ID,taskScope,type QueueManifest,type QueueTask} from '../overnight-policy.ts';
import {emptyLedger,type QueueLedger,type QueueStore} from '../overnight-ledger.ts';
import {REQUIRED_CHECKS,makeValidationReceipt,type ValidationBundle} from '../codex-pilot-receipt.ts';
import type {OfflineQueueAdapters,BoundaryContext} from '../overnight-queue.ts';
import type {GitHubTransport} from '../codex-github-control.ts';
export const baseline='a'.repeat(40),now=new Date('2026-11-17T03:30:00.000Z');
export function manifest(count=3):{-readonly [K in keyof QueueManifest]:QueueManifest[K]}{
  const tasks=Array.from({length:count},(_,i)=>{
    const t={issue:101+i,title:`Approved issue ${i}`,issueDigest:issueDigest(`Approved issue ${i}`,'Frozen issue body'),scopeText:'Implement only the approved fixture scope.',
      approvalId:`approval-${i}`,allowedPaths:[`apps/server/src/fixture-${i}.ts`],codingSeconds:900,maxSessions:1 as const};
    return {...t,approvalDigest:sha256(canonical(t))};
  });
  return {version:1,repository:REPOSITORY,enabled:true,queueId:'night-one',authorizationId:'owner-night-one',baselineSha:baseline,
    baselinePolicy:'exact-main-independent-prs-v1',timezone:'America/New_York',localDate:'2026-11-16',startsAt:easternStart('2026-11-16'),
    endsAt:'2026-11-17T07:30:00.000Z',dispatchGraceSeconds:900,forbiddenPaths:FORBIDDEN_PATHS,forbiddenOperations:FORBIDDEN_OPERATIONS,tasks};
}
export function resignTask(t:QueueTask,changes:Partial<QueueTask>):QueueTask{
  const {approvalDigest:_,...rest}={...t,...changes};void _;return {...rest,approvalDigest:sha256(canonical(rest))};
}
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
export const enrollment={publicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString(),fingerprint:sha256(publicKey.export({type:'spki',format:'der'}))};
export const bytes=(m:unknown)=>Buffer.from(JSON.stringify(m));
export const signature=(m:QueueManifest)=>sign(null,Buffer.from('SOVEREIGN-OVERNIGHT-V1\n'+canonical(m)),privateKey);
export const signRecovery=(value:unknown)=>sign(null,Buffer.from('SOVEREIGN-RECONCILE-V1\n'+canonical(value)),privateKey).toString('base64');
export const trigger={repository:REPOSITORY,actor:OWNER,actorId:OWNER_ID,ref:'refs/heads/main',event:'workflow_dispatch' as const,runId:'123',attempt:1,sourceSha:baseline};
export function api(m:QueueManifest):GitHubTransport{
  return {async request(method,path){
    if(method!=='GET')throw Error('no writes in authority collector');
    if(path.includes('/permission'))return {status:200,data:{permission:'admin',user:{login:OWNER,id:OWNER_ID,type:'User'}}};
    if(path==='/git/ref/heads/main')return {status:200,data:{ref:'refs/heads/main',object:{sha:m.baselineSha}}};
    const t=m.tasks.find(t=>path===`/issues/${t.issue}`);
    return t?{status:200,data:{number:t.issue,state:'open',title:t.title,body:'Frozen issue body'}}:{status:404,data:{}};
  }};
}
export class MemoryStore implements QueueStore {
  revision=0;ledger:QueueLedger=emptyLedger();history:QueueLedger[]=[];
  async read(){return {revision:String(this.revision),ledger:structuredClone(this.ledger)}}
  async compareAndSwap(revision:string,value:QueueLedger){
    if(revision!==String(this.revision))return false;
    this.ledger=structuredClone(value);this.history.push(structuredClone(value));this.revision++;return true;
  }
}
export function proposal(m:QueueManifest,t:QueueTask,runId='123'){
  const scope=taskScope(m,t),digest=sha256(canonicalScope(scope)),patch=Buffer.from('synthetic patch bytes');
  const bundle:ValidationBundle={scope:bytes({...scope,scopeDigest:digest}),patch,summary:Buffer.from('Synthetic proposal'),
    manifest:bytes({format:'sovereign-codex-proposal-v1',source_sha:baseline,scope_digest:digest,patch_sha256:sha256(patch),patch_bytes:patch.length,
      paths:scope.approvedPaths.map(path=>({path,bytes:1,sha256:'c'.repeat(64)}))}),
    replay:bytes({tree_sha:'b'.repeat(40),source_sha:baseline,scope_digest:digest,patch_sha256:sha256(patch),paths:scope.approvedPaths,result:'RECONSTRUCTED_NO_EXECUTION'})};
  const receipt=makeValidationReceipt(bundle,{runId,sourceSha:baseline},'sha256:'+'c'.repeat(64),REQUIRED_CHECKS.map(command=>({command,status:'passed',exitCode:0})));
  const receiptBytes=bytes(receipt);
  return {bundle,validation:{bytes:receiptBytes,trustedJob:{runId,attempt:1 as const,sourceSha:baseline,conclusion:'success' as const,receiptDigest:sha256(receiptBytes)}}};
}
export function adapters(calls:string[]=[]):OfflineQueueAdapters{
  const mark=(stage:string,c:BoundaryContext)=>{calls.push(`${stage}:${c.task.issue}`)};
  return {
    async prepare(c){mark('prepare',c)},
    async agent(c){mark('agent',c);return {sessionId:`sess_${c.task.issue}`,terminationConfirmed:true,bundle:proposal(c.manifest,c.task,c.runId).bundle}},
    async validate(c){mark('validate',c);return proposal(c.manifest,c.task,c.runId).validation},
    async publish(c){mark('publish',c);const number=201+c.index;return {number,url:`https://github.com/${REPOSITORY}/pull/${number}`,headSha:'d'.repeat(40),treeSha:'b'.repeat(40),sourceSha:baseline,draft:true}},
  };
}
