import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {REPOSITORY,sha256,canonicalScope} from '../codex-automation-policy.ts';
import {canonical,taskScope} from '../overnight-policy.ts';
import {emptyLedger,type QueueLedger} from '../overnight-ledger.ts';
import {CONFIG_REF,QUEUE_WORKFLOW} from '../overnight-production.ts';
import {makeValidationReceipt,REQUIRED_CHECKS,type ValidationBundle} from '../codex-pilot-receipt.ts';
import {HOSTED_ARTIFACTS} from '../codex-hosted-agents.ts';
import type {GitHubTransport,GitHubReply} from '../codex-github-control.ts';
import {manifest,enrollment,signature,trigger,bytes} from './overnight-fixture.ts';
export function productionFixture(count=1){
  const root=mkdtempSync(join(tmpdir(),'queue-production-')),repo=join(root,'repo'),runner=join(root,'runner');mkdirSync(repo);mkdirSync(runner);
  const git=(...args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const m=manifest(count);mkdirSync(join(repo,'apps/server/src'),{recursive:true});mkdirSync(join(repo,'scripts'));
  writeFileSync(join(repo,'scripts/codex-hosted-packager.py'),readFileSync(new URL('../codex-hosted-packager.py',import.meta.url)));
  for(const t of m.tasks)writeFileSync(join(repo,t.allowedPaths[0]!),'export const fixture = 1;\n');
  git('add','.');git('commit','-qm','Fixture source');m.baselineSha=git('rev-parse','HEAD');
  const packets=m.tasks.map((t,i)=>{
    const path=t.allowedPaths[0]!,content='export const fixture = 2;\n';writeFileSync(join(repo,path),content);
    const patch=execFileSync('git',['diff','--binary','HEAD'],{cwd:repo});writeFileSync(join(repo,path),'export const fixture = 1;\n');
    const index=join(root,'index-'+i),env={...process.env,GIT_INDEX_FILE:index};
    execFileSync('git',['read-tree','HEAD'],{cwd:repo,env});execFileSync('git',['apply','--cached'],{cwd:repo,env,input:patch});
    const tree=execFileSync('git',['write-tree'],{cwd:repo,env,encoding:'utf8'}).trim();
    const scope=taskScope(m,t),scopeDigest=sha256(canonicalScope(scope));
    const bundle:ValidationBundle={scope:bytes({...scope,scopeDigest}),patch,summary:Buffer.from('Synthetic worker text\nCloses #999'),
      manifest:bytes({format:'sovereign-codex-proposal-v1',source_sha:m.baselineSha,scope_digest:scopeDigest,patch_sha256:sha256(patch),patch_bytes:patch.length,
        paths:[{path,sha256:sha256(content),bytes:Buffer.byteLength(content)}]}),
      replay:bytes({tree_sha:tree,source_sha:m.baselineSha,scope_digest:scopeDigest,patch_sha256:sha256(patch),paths:[path],result:'RECONSTRUCTED_NO_EXECUTION'})};
    return {bundle,tree};
  });
  const config={version:1,enabled:true,enrollment:{...enrollment,revoked:false},manifest:m,signature:signature(m).toString('base64')};
  const env:NodeJS.ProcessEnv={GITHUB_REPOSITORY:REPOSITORY,GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',GITHUB_SHA:m.baselineSha,
    GITHUB_ACTOR:trigger.actor,GITHUB_ACTOR_ID:String(trigger.actorId),GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_JOB:'prepare',RUNNER_TEMP:runner,GITHUB_OUTPUT:join(root,'outputs'),GITHUB_STEP_SUMMARY:join(root,'summary'),
    SOVEREIGN_OVERNIGHT_ENABLED:'true',SOVEREIGN_OWNER_KEY_SHA256:enrollment.fingerprint,SOVEREIGN_TASK_INDEX:'0',GITHUB_TOKEN:'synthetic-read-or-control-token'};
  let ledger=emptyLedger(),revision='d'.repeat(40),remoteRef:string|null=null,pr:Record<string,unknown>|null=null;
  const history=new Map([[revision,ledger]]),trees=new Map<string,QueueLedger>(),commits=new Map<string,{parent:string;ledger:QueueLedger}>();
  let counter=0;const calls:{method:string;path:string;body?:unknown}[]=[];
  const jobs=()=>m.tasks.flatMap((_,i)=>['Agent','Validate'].map((name,n)=>({id:1000+i*10+n,name:`Task ${i+1} / ${name}`,run_id:123,run_attempt:1,status:'completed',conclusion:'success',
    steps:(name==='Agent'?['Run bounded authorized session']:['Run actual isolated checks','Require host receipt']).map(name=>({name,status:'completed',conclusion:'success'}))})));
  const file=(value:unknown)=>{const b=bytes(value);return {status:200,data:{type:'file',encoding:'base64',size:b.length,content:b.toString('base64')}}};
  const api:GitHubTransport={async request(method,path,body):Promise<GitHubReply>{
    calls.push({method,path,...(body===undefined?{}:{body})});const b=body as Record<string,unknown>;
    if(path.includes('/permission'))return {status:200,data:{permission:'admin',user:{login:trigger.actor,id:trigger.actorId,type:'User'}}};
    if(path==='/git/ref/heads/main')return {status:200,data:{ref:'refs/heads/main',object:{sha:m.baselineSha}}};
    if(path===`/git/ref/heads/${CONFIG_REF}`)return {status:200,data:{ref:`refs/heads/${CONFIG_REF}`,object:{sha:'f'.repeat(40)}}};
    if(path.startsWith('/contents/.sovereign/queue.json'))return file(config);
    if(path.startsWith('/contents/.github/workflows/'))return {status:200,data:{encoding:'base64',content:Buffer.from('steps:\n  - name: Retired\n    run: exit 1 # Retired').toString('base64')}};
    if(path==='/git/ref/heads/sovereign-overnight-ledger-v1')return {status:200,data:{ref:'refs/heads/sovereign-overnight-ledger-v1',object:{sha:revision}}};
    if(path.startsWith('/contents/.sovereign/overnight-ledger.json'))return file(history.get(path.split('ref=')[1]!)!);
    if(path.startsWith('/issues/')){const t=m.tasks.find(t=>path===`/issues/${t.issue}`);return t?{status:200,data:{number:t.issue,state:'open',title:t.title,body:'Frozen issue body'}}:{status:404,data:{}}}
    if(path==='/actions/runs/123')return {status:200,data:{id:123,run_attempt:1,head_sha:m.baselineSha,path:QUEUE_WORKFLOW,event:'workflow_dispatch',repository:{full_name:REPOSITORY}}};
    if(path==='/actions/runs/123/attempts/1/jobs?per_page=100')return {status:200,data:{total_count:jobs().length,jobs:jobs()}};
    if(method==='POST'&&path==='/git/trees'){
      const entries=b.tree as {path:string;content:string}[];
      if(entries[0]?.path==='.sovereign/overnight-ledger.json'){const sha=sha256(String(++counter)).slice(0,40);trees.set(sha,JSON.parse(entries[0].content));return {status:201,data:{sha}}}
      return {status:201,data:{sha:packets.find((_,i)=>m.tasks[i]!.allowedPaths[0]===entries[0]!.path)!.tree}};
    }
    if(method==='POST'&&path==='/git/commits'){
      const sha=sha256(String(++counter)).slice(0,40),l=trees.get(String(b.tree));if(l)commits.set(sha,{parent:(b.parents as string[])[0]!,ledger:l});
      return {status:201,data:{sha}};
    }
    if(method==='PATCH'&&path==='/git/refs/heads/sovereign-overnight-ledger-v1'){
      const c=commits.get(String(b.sha))!;if(c.parent!==revision)return {status:422,data:{}};
      ledger=structuredClone(c.ledger);revision=String(b.sha);history.set(revision,ledger);return {status:200,data:{object:{sha:revision}}};
    }
    if(path.startsWith('/git/ref/heads/queue/'))return remoteRef?{status:200,data:{object:{sha:remoteRef}}}:{status:404,data:{}};
    if(path.startsWith('/pulls?'))return {status:200,data:pr?[pr]:[]};
    if(path==='/git/commits/'+m.baselineSha)return {status:200,data:{tree:{sha:git('rev-parse','HEAD^{tree}')}}};
    if(method==='POST'&&path==='/git/refs'){remoteRef=String(b.sha);return {status:201,data:{ref:b.ref,object:{sha:b.sha}}}}
    if(method==='POST'&&path==='/pulls'){
      pr={number:301,draft:true,state:'open',merged_at:null,body:b.body,head:{ref:b.head,sha:remoteRef,repo:{full_name:REPOSITORY}},base:{ref:'main'}};
      return {status:201,data:pr};
    }
    if(path==='/pulls/301'&&pr)return {status:200,data:pr};
    return {status:404,data:{}};
  }};
  const githubFetch:typeof fetch=async(url,init)=>{
    const path=String(url).replace(`https://api.github.com/repos/${REPOSITORY}`,'');const r=await api.request((init?.method??'GET') as 'GET'|'POST'|'PATCH',path,init?.body?JSON.parse(String(init.body)):undefined);return Response.json(r.data,{status:r.status});
  };
  const providerCalls:{url:string;method:string}[]=[];
  const providerFetch=async(url:string,init:RequestInit)=>{
    providerCalls.push({url,method:init.method??'GET'});const i=Number(env.SOVEREIGN_TASK_INDEX),p=packets[i]!,id='opaque-session-'+i;
    if(url.endsWith('/files'))return Response.json({object:'file',id:'file_fixture',purpose:'user_data',bytes:null});
    if(url.endsWith('/sessions'))return new Response('data: '+JSON.stringify({type:'agent.session.in_progress',session:{id}})+'\n\n'+'data: '+JSON.stringify({type:'agent.session.turn.completed',session_id:id,turn:{id:'opaque-turn',subagent_id:null}})+'\n\n');
    if(init.method==='DELETE')return Response.json({object:'agent.session.deleted',id,deleted:true});
    if(url.includes('/artifacts?'))return Response.json({object:'list',has_more:false,data:HOSTED_ARTIFACTS.map((path,i)=>({id:'artifact_'+i,path,turn_id:'opaque-turn',session_id:id}))});
    const n=Number(/artifact_(\d)/.exec(url)?.[1]);return new Response(new Uint8Array([p.bundle.patch,p.bundle.manifest,p.bundle.summary][n]!));
  };
  function validation(i=0){
    const dir=join(runner,'sovereign-pilot','validated');mkdirSync(dir,{recursive:true});const p=packets[i]!;
    const names={scope:'scope.json',manifest:'manifest.json',patch:'proposal.patch',summary:'summary.txt',replay:'validated-report.json'};
    for(const k of Object.keys(names) as (keyof typeof names)[])writeFileSync(join(dir,names[k]),p.bundle[k]);
    // Independent Git replay is real; isolated-command outcomes are simulated in
    // this transport fixture. Existing hosted PR90 smoke executes the real checks.
    const replay=execFileSync('python3',[new URL('../codex-proposal-replay.py',import.meta.url).pathname,join(dir,'scope.json'),join(dir,'manifest.json'),join(dir,'proposal.patch')],{cwd:repo});
    writeFileSync(join(dir,'validated-report.json'),replay);const bundle={...p.bundle,replay};
    const receipt=bytes(makeValidationReceipt(bundle,{runId:'123',sourceSha:m.baselineSha},'sha256:'+'c'.repeat(64),REQUIRED_CHECKS.map(command=>({command,status:'passed',exitCode:0}))));
    writeFileSync(join(dir,'validation-receipt.json'),receipt);env.EXPECTED_VALIDATION_SHA256=sha256(receipt);
    const state=readFileSync(join(runner,'sovereign-pilot','provider-state.json')),stateDir=join(runner,'sovereign-pilot','state');mkdirSync(stateDir,{recursive:true});writeFileSync(join(stateDir,'provider-state.json'),state);env.EXPECTED_AGENT_STATE_SHA256=sha256(state);
  }
  return {m,config,env,api,calls,providerCalls,providerFetch,githubFetch,repo,root,runner,validation,packets,
    ledger:()=>ledger,revision:()=>revision,pr:()=>pr,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
