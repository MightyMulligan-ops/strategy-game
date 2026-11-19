/** Owner-local only. Adapted from PR96 for the merged manual-cost-v1 protocol.
 * Never run in Actions or give this process a provider key. */
import {readFileSync,writeFileSync,lstatSync,existsSync} from 'node:fs';
import {createPrivateKey,createPublicKey,sign,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {canonical,parseManifest,QueueAuthority,OWNER_ID,issueDigest,MANUAL_FORBIDDEN_PATHS,MANUAL_FORBIDDEN_OPERATIONS,MANUAL_WATCHDOG_SECONDS,type QueueManifest} from './overnight-policy.ts';
import {validateQueueLedger,type QueueLedger} from './overnight-ledger.ts';
import {REPOSITORY,OWNER,SHA,sha256} from './codex-automation-policy.ts';
import {HOSTED_MODEL} from './codex-hosted-agents.ts';
import {ControlDenied,requireControl} from './codex-run-control.ts';
import type {GitHubTransport} from './codex-github-control.ts';
const CONFIG_REF='sovereign-overnight-config-v1',CONFIG_PATH='.sovereign/queue.json',ROOT='repos/'+REPOSITORY;
export type ManualCommand=(parts:string[],input?:string)=>string;
export type ManualOptions={repo?:string;command?:ManualCommand;head?:()=>string;now?:()=>Date;nonce?:()=>string};
function readJson(path:string){
 const info=lstatSync(path);requireControl(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size>0&&info.size<=256*1024,'manual-file');
 return JSON.parse(readFileSync(path,'utf8'));
}
const decode=(file:Record<string,unknown>)=>{
 requireControl(typeof file.content==='string'&&typeof file.sha==='string'&&SHA.test(file.sha),'manual-remote-file');
 const bytes=Buffer.from(file.content,'base64');requireControl(bytes.length>0&&bytes.length<=256*1024,'manual-remote-size');
 return JSON.parse(bytes.toString('utf8'));
};
export async function manualCli(args:readonly string[],options:ManualOptions={}){
 requireControl(process.env.OPENAI_API_KEY===undefined,'manual-provider-key-forbidden');
 const [mode,input,keyPath,output,confirmation]=args;
 requireControl(mode==='prepare'&&args.length===5&&confirmation==='--soft-limit-50'||
   mode==='start'&&args.length===3&&keyPath==='--soft-limit-50','manual-usage');
 if(mode==='start')requireControl(!existsSync(input!+'.attempted'),'manual-attempt-already-recorded');
 const call=options.command??((parts:string[],body?:string)=>execFileSync('gh',parts,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
  ...(body===undefined?{}:{input:body}),stdio:['pipe','pipe','pipe']}));
 const get=(path:string)=>JSON.parse(call(['api',path]));
 const api:GitHubTransport={async request(method,path){requireControl(method==='GET','manual-readonly-check');return {status:200,data:get(ROOT+path)}}};
 const now=options.now??(()=>new Date());
 const user=get('user');requireControl(user.login===OWNER&&user.id===OWNER_ID,'manual-owner');
 const main=get(ROOT+'/git/ref/heads/main').object.sha;requireControl(typeof main==='string'&&SHA.test(main),'manual-main');
 const head=options.head??(()=>execFileSync('git',['-c','core.hooksPath=/dev/null','rev-parse','HEAD'],{cwd:options.repo??process.cwd(),encoding:'utf8',stdio:'pipe'}).trim());
 requireControl(head()===main,'manual-update-checkout-to-main');
 const installed=get(ROOT+'/contents/scripts/overnight-manual.ts?ref='+main);
 requireControl(typeof installed.content==='string'&&sha256(Buffer.from(installed.content,'base64'))===sha256(readFileSync(new URL(import.meta.url))),'manual-script-not-merged');
 const remote=get(ROOT+'/contents/'+CONFIG_PATH+'?ref='+CONFIG_REF),current=decode(remote);
 const enrollment=current.enrollment;
 requireControl(current.version===1&&enrollment?.revoked===false&&typeof enrollment.publicKeyPem==='string','manual-enrollment');
 const publicKey=createPublicKey(enrollment.publicKeyPem),pin=get(ROOT+'/actions/variables/SOVEREIGN_OWNER_KEY_SHA256').value;
 requireControl(publicKey.asymmetricKeyType==='ed25519'&&typeof pin==='string'&&pin===enrollment.fingerprint&&
  sha256(publicKey.export({type:'spki',format:'der'}))===pin,'manual-key-pin');
 const ledgerFile=get(ROOT+'/contents/.sovereign/overnight-ledger.json?ref=sovereign-overnight-ledger-v1');
 const ledger=decode(ledgerFile) as QueueLedger;validateQueueLedger(ledger);requireControl(ledger.active===null,'manual-active-or-uncertain-run');
 const local=readJson(input!);
 let manifest:QueueManifest,signature:Buffer,prepared:Record<string,unknown>;
 const authority=(m:QueueManifest,s:Buffer)=>new QueueAuthority(api,enrollment,Buffer.from(JSON.stringify(m)),s,{
  repository:REPOSITORY,actor:OWNER,actorId:OWNER_ID,ref:'refs/heads/main',event:'workflow_dispatch',runId:'1',attempt:1,sourceSha:main});
 if(mode==='prepare'){
  requireControl(Object.keys(local).sort().join(',')==='allowedPaths,issue,issueDigest,scopeText,sourceSha,title'&&local.sourceSha===main,'manual-frozen-input');
  const id=(options.nonce??randomUUID)();requireControl(/^[A-Za-z0-9_-]{1,60}$/.test(id),'manual-id');
  const approved={issue:local.issue,title:local.title,issueDigest:local.issueDigest,scopeText:local.scopeText,approvalId:'task-'+id,
   allowedPaths:local.allowedPaths,codingSeconds:MANUAL_WATCHDOG_SECONDS,maxSessions:1 as const};
  const start=now();requireControl(Number.isFinite(start.getTime()),'manual-clock');
  manifest={version:1,repository:REPOSITORY,enabled:true,execution:{mode:'manual-cost-v1',model:HOSTED_MODEL,softLimitMicroUsd:50000000},
   queueId:'manual-'+id,authorizationId:'owner-'+id,baselineSha:main,baselinePolicy:'exact-main-independent-prs-v1',
   timezone:'America/New_York',localDate:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(start),
   startsAt:start.toISOString(),endsAt:new Date(start.getTime()+6*3600000).toISOString(),dispatchGraceSeconds:900,
   forbiddenPaths:MANUAL_FORBIDDEN_PATHS,forbiddenOperations:MANUAL_FORBIDDEN_OPERATIONS,tasks:[{...approved,approvalDigest:sha256(canonical(approved))}]};
  parseManifest(Buffer.from(JSON.stringify(manifest)));
  const issue=get(ROOT+'/issues/'+local.issue);
  requireControl(issue.title===local.title&&typeof issue.body==='string'&&issue.body===local.scopeText&&issueDigest(issue.title,issue.body)===local.issueDigest,'manual-issue-drift');
  const info=lstatSync(keyPath!);requireControl(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size>0&&info.size<=16384,'manual-private-key-file');
  const privateKey=createPrivateKey(readFileSync(keyPath!));
  requireControl(privateKey.asymmetricKeyType==='ed25519'&&sha256(createPublicKey(privateKey).export({type:'spki',format:'der'}))===pin,'manual-wrong-private-key');
  signature=sign(null,Buffer.from('SOVEREIGN-OVERNIGHT-V1\n'+canonical(manifest)),privateKey);
  await authority(manifest,signature).check(now(),true);
  const config={version:1,enabled:true,enrollment,manifest,signature:signature.toString('base64')};
  prepared={message:'Authorize one manual city task with a $50 estimated soft limit',branch:CONFIG_REF,sha:remote.sha,
   content:Buffer.from(JSON.stringify(config)).toString('base64')};
  writeFileSync(output!,JSON.stringify(prepared,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('PREPARED: one signed task. Nothing published, dispatched or paid.');return;
 }
 requireControl(Object.keys(local).sort().join(',')==='branch,content,message,sha'&&local.branch===CONFIG_REF&&local.sha===remote.sha,'manual-config-changed');
 const config=decode(local);
 requireControl(config.version===1&&config.enabled===true&&canonical(config.enrollment)===canonical(enrollment)&&typeof config.signature==='string','manual-prepared-config');
 const parsed=parseManifest(Buffer.from(JSON.stringify(config.manifest)));requireControl(parsed.enabled&&!!parsed.execution,'manual-manifest-required');
 manifest=parsed;signature=Buffer.from(config.signature,'base64');
 requireControl(manifest.baselineSha===main&&!ledger.runs.some(r=>r.queueId===manifest.queueId||r.authorizationId===manifest.authorizationId||
  r.tasks.some(t=>manifest.tasks.some(a=>a.approvalId===t.approvalId))),'manual-approval-consumed');
 await authority(manifest,signature).check(now(),true);
 // Marker precedes every mutation. A lost response NEVER permits a retry.
 writeFileSync(input!+'.attempted',now().toISOString()+'\n',{flag:'wx',mode:0o600});
 call(['variable','set','SOVEREIGN_OVERNIGHT_ENABLED','--body','false','--repo',REPOSITORY]);
 call(['variable','set','SOVEREIGN_OVERNIGHT_SCHEDULE_ENABLED','--body','false','--repo',REPOSITORY]);
 call(['api','--method','PUT',ROOT+'/contents/'+CONFIG_PATH,'--input','-'],JSON.stringify(local));
 const published=get(ROOT+'/contents/'+CONFIG_PATH+'?ref='+CONFIG_REF);
 requireControl(typeof published.content==='string'&&published.content.replace(/\s/g,'')===String(local.content).replace(/\s/g,''),'manual-publication-mismatch');
 await authority(manifest,signature).check(now(),true);
 const latest=decode(get(ROOT+'/contents/.sovereign/overnight-ledger.json?ref=sovereign-overnight-ledger-v1')) as QueueLedger;
 validateQueueLedger(latest);requireControl(latest.active===null&&!latest.runs.some(r=>r.queueId===manifest.queueId),'manual-launch-raced');
 call(['variable','set','SOVEREIGN_OVERNIGHT_ENABLED','--body','true','--repo',REPOSITORY]);
 call(['workflow','run','sovereign-overnight-queue.yml','--repo',REPOSITORY,'--ref','main','--field','mode=execute']);
 console.log('DISPATCH ACCEPTED: verify Actions and durable session state; do not dispatch again.');
}
if(process.argv[1]?.endsWith('overnight-manual.ts')){
 void manualCli(process.argv.slice(2)).catch(error=>{
  const code=error instanceof ControlDenied?error.code:'unavailable-or-uncertain';
  console.error('Manual launch stopped ('+code+'). No automatic retry; inspect Actions/config/ledger.');process.exitCode=1;
 });
}
