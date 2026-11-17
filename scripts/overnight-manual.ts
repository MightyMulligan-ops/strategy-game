/** Owner-local signing/launch CLI. Never installed in a credentialed Actions job.
 * Private key is read only for explicit preparation; never sent to GitHub. */
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {canonical,parseManifest,signaturePayload,QueueAuthority,OWNER_ID,type QueueManifest,type ManualQueueManifest} from './overnight-policy.ts';
import {validateQueueLedger,type QueueLedger} from './overnight-ledger.ts';
import {REPOSITORY,OWNER,SHA,sha256} from './codex-automation-policy.ts';
import {requireControl} from './codex-run-control.ts';
import type {GitHubTransport} from './codex-github-control.ts';
const CONFIG_REF='sovereign-overnight-config-v1',CONFIG_PATH='.sovereign/queue.json';
const ROOT='repos/'+REPOSITORY;
export function manualManifest(previous:QueueManifest,baselineSha:string):ManualQueueManifest {
  requireControl(previous.version===1&&previous.tasks.length===1&&SHA.test(baselineSha),'manual-single-task');
  const t=previous.tasks[0]!,approvalId='manual-'+sha256(t.approvalId).slice(0,32);
  const {approvalDigest:_,...approved}={...t,approvalId,codingSeconds:null};void _;
  const task={...approved,approvalDigest:sha256(canonical(approved))};
  const id=sha256(previous.authorizationId+'\n'+approvalId).slice(0,32);
  const m:ManualQueueManifest={version:2,repository:REPOSITORY,enabled:true,queueId:'manual-'+id,authorizationId:'manual-auth-'+id,
    baselineSha,baselinePolicy:'exact-main-independent-prs-v1',launchMode:'manual',softLimitUsd:50,spendPolicy:'platform-project-limit',
    forbiddenPaths:previous.forbiddenPaths,forbiddenOperations:previous.forbiddenOperations,tasks:[task]};
  parseManifest(Buffer.from(JSON.stringify(m)));return m;
}
function readJson(path:string){
  const s=lstatSync(path);requireControl(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=256*1024,'manual-file');
  return JSON.parse(readFileSync(path,'utf8'));
}
export type ManualCommand=(parts:string[],input?:string)=>string;
export async function manualCli(args:readonly string[],repo=process.cwd(),command?:ManualCommand){
  const [mode,input,keyOrFlag,output,confirmation]=args;
  requireControl((mode==='prepare'&&args.length===5&&confirmation==='--platform-limit-50')||
    (mode==='start'&&args.length===3&&keyOrFlag==='--platform-limit-50'),'manual-usage');
  // This flag is an owner attestation, not an API verification. The existing
  // project key cannot inspect admin billing settings; never request an admin key.
  const gh=process.env.SOVEREIGN_GH??'gh';
  const call:ManualCommand=command??((parts:string[],input?:string)=>execFileSync(gh,parts,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
    ...(input===undefined?{}:{input}),stdio:['pipe','pipe','pipe']}));
  const get=(path:string)=>JSON.parse(call(['api',path]));
  const api:GitHubTransport={async request(method,path){requireControl(method==='GET','manual-readonly-preflight');return {status:200,data:get(ROOT+path)}}};
  const user=get('user');requireControl(user.login===OWNER&&user.id===OWNER_ID,'manual-owner');
  const local=readJson(input!);requireControl(local.branch===CONFIG_REF&&typeof local.content==='string','manual-request');
  const prior=JSON.parse(Buffer.from(local.content,'base64').toString('utf8'));
  const old=parseManifest(Buffer.from(JSON.stringify(prior.manifest)));requireControl(old.enabled,'manual-disabled');
  const remote=get(`${ROOT}/contents/${CONFIG_PATH}?ref=${CONFIG_REF}`);
  const current=JSON.parse(Buffer.from(remote.content,'base64').toString('utf8'));
  requireControl(current.version===1&&canonical(current.enrollment)===canonical(prior.enrollment)&&
    prior.enrollment.revoked===false,'manual-enrollment');
  const key=createPublicKey(prior.enrollment.publicKeyPem),pin=get(ROOT+'/actions/variables/SOVEREIGN_OWNER_KEY_SHA256').value;
  requireControl(key.asymmetricKeyType==='ed25519'&&sha256(key.export({type:'spki',format:'der'}))===pin&&pin===prior.enrollment.fingerprint&&
    verify(null,Buffer.from(signaturePayload(old)),key,Buffer.from(prior.signature,'base64')),'manual-signature-or-pin');
  const ledgerFile=get(ROOT+'/contents/.sovereign/overnight-ledger.json?ref=sovereign-overnight-ledger-v1');
  const ledger=JSON.parse(Buffer.from(ledgerFile.content,'base64').toString('utf8')) as QueueLedger;validateQueueLedger(ledger);
  requireControl(ledger.active===null,'manual-active-or-uncertain-run');
  const main=get(ROOT+'/git/ref/heads/main').object.sha;
  requireControl(SHA.test(main),'manual-main');
  const installed=get(ROOT+'/contents/scripts/overnight-manual.ts?ref='+main);
  requireControl(typeof installed.content==='string'&&sha256(Buffer.from(installed.content,'base64'))===
    sha256(readFileSync(new URL(import.meta.url))),'manual-script-not-merged');
  if(mode==='prepare'){
    requireControl(canonical(current)===canonical(prior)||current.enabled===false&&current.signature===null&&
      current.manifest.enabled===false&&current.manifest.tasks.length===0,'manual-other-config');
    // Require the reviewed merged script, not a feature-branch entry point.
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();requireControl(head===main,'manual-update-checkout-to-main');
    const m=manualManifest(old,main);
    const ids=[...old.tasks,...m.tasks].map(t=>t.approvalId);
    requireControl(!ledger.runs.some(r=>r.tasks.some(t=>ids.includes(t.approvalId))),'manual-approval-consumed');
    const privateKey=createPrivateKey(readFileSync(keyOrFlag!));
    requireControl(sha256(createPublicKey(privateKey).export({type:'spki',format:'der'}))===pin,'manual-wrong-private-key');
    const signature=sign(null,Buffer.from(signaturePayload(m)),privateKey);
    await new QueueAuthority(api,prior.enrollment,Buffer.from(JSON.stringify(m)),signature,
      {repository:REPOSITORY,actor:OWNER,actorId:OWNER_ID,ref:'refs/heads/main',event:'workflow_dispatch',runId:'1',attempt:1,sourceSha:main}).check(new Date(),true);
    const config={version:1,enabled:true,enrollment:prior.enrollment,manifest:m,signature:signature.toString('base64')};
    writeFileSync(output!,JSON.stringify({message:'Authorize one manual task with $50 Platform soft spending target',branch:CONFIG_REF,sha:remote.sha,
      content:Buffer.from(JSON.stringify(config)).toString('base64')},null,2)+'\n',{flag:'wx',mode:0o600});
    console.log('PREPARED: one signed manual task; no short coding timer. Nothing published or dispatched.');return;
  }
  requireControl(old.version===2&&old.baselineSha===main&&remote.sha===local.sha,'manual-config-or-main-changed');
  requireControl(!ledger.runs.some(r=>r.queueId===old.queueId||r.authorizationId===old.authorizationId||r.tasks.some(t=>old.tasks.some(a=>a.approvalId===t.approvalId))),'manual-approval-consumed');
  await new QueueAuthority(api,prior.enrollment,Buffer.from(JSON.stringify(old)),Buffer.from(prior.signature,'base64'),
    {repository:REPOSITORY,actor:OWNER,actorId:OWNER_ID,ref:'refs/heads/main',event:'workflow_dispatch',runId:'1',attempt:1,sourceSha:main}).check(new Date(),true);
  // A local attempt marker precedes every mutation. Lost publication or dispatch
  // responses cannot be retried by rerunning this command. Inspect Actions/ledger.
  writeFileSync(input!+'.attempted',new Date().toISOString()+'\n',{flag:'wx',mode:0o600});
  call(['variable','set','SOVEREIGN_OVERNIGHT_ENABLED','--body','false','--repo',REPOSITORY]);
  call(['variable','set','SOVEREIGN_OVERNIGHT_SCHEDULE_ENABLED','--body','false','--repo',REPOSITORY]);
  call(['api','--method','PUT',ROOT+'/contents/'+CONFIG_PATH,'--input','-'],JSON.stringify(local));
  const published=get(`${ROOT}/contents/${CONFIG_PATH}?ref=${CONFIG_REF}`);
  requireControl(published.content.replace(/\s/g,'')===local.content.replace(/\s/g,''),'manual-publication-mismatch');
  call(['variable','set','SOVEREIGN_OVERNIGHT_ENABLED','--body','true','--repo',REPOSITORY]);
  call(['workflow','run','sovereign-overnight-queue.yml','--repo',REPOSITORY,'--ref','main','--field','mode=execute']);
  console.log('DISPATCH ACCEPTED: your PC may be turned off. Execution/payment/completion still require Actions and ledger verification. Do not dispatch again.');
}
if(process.argv[1]?.endsWith('overnight-manual.ts')){
  void manualCli(process.argv.slice(2)).catch(()=>{console.error('Manual preparation/start failed or is uncertain. No automatic retry. Inspect Actions, protected config and durable ledger before any further launch.');process.exitCode=1});
}
