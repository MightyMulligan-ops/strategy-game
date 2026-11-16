/** Draft-only publisher for the *validated* separate GitHub Actions job.
 * Does not execute agent code. Requires contents/write and pull_requests/write
 * in a secret-free publisher job that follows a successful isolated validation job.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {canonicalScope,sha256,REPOSITORY,SHA} from './codex-automation-policy.ts';
import {requireControl,ControlDenied} from './codex-run-control.ts';
import {verifyValidationReceipt,verifyBundle} from './codex-pilot-receipt.ts';
import {readValidationBundle} from './codex-pilot-validator.ts';

const API='https://api.github.com/repos/'+REPOSITORY;
const BRANCH_PREFIX='issue/76-sovereign-pilot-';
function decode(v:unknown):Record<string,unknown>{
  requireControl(v!==null&&typeof v==='object'&&!Array.isArray(v),'pilot-publisher-object');
  return v as Record<string,unknown>;
}
class GitHubApi {
  constructor(private readonly token:string,private readonly fetcher:typeof fetch){
    requireControl(token.length>0,'pilot-publisher-token');
  }
  async request(method:'GET'|'POST',path:string,data?:unknown):Promise<unknown>{
    requireControl(path.startsWith('/')&&!path.includes('..')&&path.length<300,'pilot-publisher-path');
    const response=await this.fetcher(API+path,{
      method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28',...(data===undefined?{}:{'Content-Type':'application/json'})},
      ...(data===undefined?{}:{body:JSON.stringify(data)}),
    });
    requireControl(response.status===(method==='GET'?200:201),'pilot-publisher-provider');
    const body=await response.text();
    requireControl(Buffer.byteLength(body)<=256*1024,'pilot-publisher-response-size');
    try{return JSON.parse(body);}catch{throw new ControlDenied('pilot-publisher-response-json');}
  }
  async optionalRef(branch:string):Promise<unknown|null>{
    const r=await this.fetcher(API+'/git/ref/heads/'+branch,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json'}});
    if(r.status===404)return null;
    requireControl(r.status===200,'queue-publisher-ref-unknown');const text=await r.text();requireControl(Buffer.byteLength(text)<=65536,'queue-publisher-ref-size');return JSON.parse(text);
  }
}
export type QueuePublication={issue:number;branch:string;assertAuthorized:()=>Promise<void>};
export async function runPilotPublisher(env:NodeJS.ProcessEnv,fetcher:typeof fetch=fetch,repo=process.cwd(),queue?:QueuePublication){
  requireControl(env.GITHUB_REPOSITORY===REPOSITORY&&
    (env.GITHUB_ACTOR==='MightyMulligan-ops'&&env.GITHUB_ACTOR_ID==='353505747'||queue&&env.GITHUB_EVENT_NAME==='schedule')&&
    env.GITHUB_REF==='refs/heads/main'&&
    (env.GITHUB_EVENT_NAME==='workflow_dispatch'||queue&&env.GITHUB_EVENT_NAME==='schedule')&&
    env.GITHUB_RUN_ATTEMPT==='1'&&/^\d+$/.test(env.GITHUB_RUN_ID??'')&&
    typeof env.GITHUB_TOKEN==='string'&&env.GITHUB_TOKEN.length>0&&
    typeof env.RUNNER_TEMP==='string'&&env.OPENAI_API_KEY===undefined,
    'pilot-publisher-environment');
  const dir=join(env.RUNNER_TEMP!,'sovereign-pilot','validated');
  const bundle=readValidationBundle(dir);
  const validationBytes=await readFile(join(dir,'validation-receipt.json'));
  verifyValidationReceipt(validationBytes,env.EXPECTED_VALIDATION_SHA256,
    {runId:env.GITHUB_RUN_ID!,sourceSha:env.GITHUB_SHA!},bundle);
  const {scope,replay:receipt}=verifyBundle(bundle);
  const summary=new TextDecoder('utf8',{fatal:true}).decode(bundle.summary);
  requireControl(Buffer.byteLength(summary)<=16*1024,'pilot-publisher-summary');
  const prBody=(queue?`Closes #${scope.issue}\n\n`:'')+'Automated hosted-agent proposal. Independently checked in secret-free GitHub Actions validation.\n\n'+
    'Summary:\n'+(queue?'See the validated file diff. Worker text grants no authority.':summary.slice(0,3000))+'\n\nRun: '+env.GITHUB_RUN_ID+
    '\nSource: '+scope.sourceSha+'\nValidated tree: '+receipt.tree_sha+'\nNo automatic merge or deployment. Owner review required.';
  requireControl(scope.issue===(queue?.issue??76)&&scope.sourceSha===env.GITHUB_SHA&&
    scope.scopeDigest===sha256(canonicalScope(scope)),'pilot-publisher-scope');
  const api=new GitHubApi(env.GITHUB_TOKEN,fetcher);
  if(queue){
    requireControl(/^queue\/[A-Za-z0-9_-]{1,80}\/[1-9]\d*-\d{1,20}$/.test(queue.branch),'queue-publisher-branch');await queue.assertAuthorized();
    const existing=await api.optionalRef(queue.branch);
    if(existing){
      const head=decode(decode(existing).object).sha;requireControl(typeof head==='string'&&SHA.test(head),'queue-existing-head');
      const commit=decode(await api.request('GET','/git/commits/'+head));
      requireControl(decode(commit.tree).sha===receipt.tree_sha&&Array.isArray(commit.parents)&&commit.parents.length===1&&decode(commit.parents[0]).sha===scope.sourceSha,'queue-existing-tree');
      const prs=await api.request('GET','/pulls?state=all&head='+encodeURIComponent('MightyMulligan-ops:'+queue.branch)+'&base=main&per_page=100');
      requireControl(Array.isArray(prs)&&prs.length===1,'queue-existing-publication-uncertain');const pr=decode(prs[0]);
      requireControl(pr.draft===true&&pr.state==='open'&&pr.merged_at===null&&decode(pr.head).sha===head&&decode(pr.head).ref===queue.branch&&
        decode(decode(pr.head).repo).full_name===REPOSITORY&&decode(pr.base).ref==='main'&&typeof pr.body==='string'&&
        pr.body===prBody&&
        Number.isSafeInteger(pr.number)&&Number(pr.number)>0,'queue-existing-pr-mismatch');
      await queue.assertAuthorized();return {number:Number(pr.number),url:`https://github.com/${REPOSITORY}/pull/${pr.number}`,headSha:head,treeSha:receipt.tree_sha};
    }
  }
  const main=decode(await api.request('GET','/git/ref/heads/main'));
  requireControl(decode(main.object).sha===scope.sourceSha,'pilot-main-advanced');
  const openPrs=await api.request('GET','/pulls?state=open&per_page=100');
  requireControl(Array.isArray(openPrs)&&openPrs.length<100&&!openPrs.some(item=>{
    const pr=decode(item);return typeof decode(pr.head).ref==='string'&&
      (queue?(decode(pr.head).ref as string)===queue.branch:(decode(pr.head).ref as string).startsWith(BRANCH_PREFIX));
  }),'pilot-duplicate-pr');
  // Work against trusted checkout. Never execute or import agent-supplied TypeScript here.
  const source=decode(await api.request('GET','/git/commits/'+scope.sourceSha));
  const baseTree=decode(source.tree).sha;
  requireControl(typeof baseTree==='string'&&SHA.test(baseTree),'pilot-publisher-source-tree');
  // Reconstruct exact tested files from the already validated Git patch in a detached index.
  const out=join(dir,'proposal.patch');
  const index=join(env.RUNNER_TEMP!,'sovereign-publisher-index');
  const gitEnv={...process.env,GIT_INDEX_FILE:index};
  const run=(...args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],
    {cwd:repo,encoding:'utf8',timeout:30_000,env:gitEnv,stdio:['ignore','pipe','pipe']}).trim();
  try{
    run('read-tree',scope.sourceSha);
    run('apply','--cached','--check',out);
    run('apply','--cached',out);
    requireControl(run('write-tree')===receipt.tree_sha,'pilot-publisher-tree-drift');
  }catch{throw new ControlDenied('pilot-publisher-tree');}
  const treeEntries=[];
  for(const path of receipt.paths){
    let binary:Buffer;
    try{binary=execFileSync('git',['-c','core.hooksPath=/dev/null','show',':'+path],
      {cwd:repo,env:gitEnv,timeout:30_000,maxBuffer:1_500_000});}
    catch{throw new ControlDenied('pilot-publisher-file');}
    const content=new TextDecoder('utf8',{fatal:true}).decode(binary);
    treeEntries.push({path,mode:'100644',type:'blob',content});
  }
  const remoteTree=decode(await api.request('POST','/git/trees',
    {base_tree:baseTree,tree:treeEntries}));
  requireControl(remoteTree.sha===receipt.tree_sha,'pilot-publisher-remote-tree');
  const commit=decode(await api.request('POST','/git/commits',{
    message:`Issue #${scope.issue}: Sovereign validated hosted proposal (draft)`,
    tree:receipt.tree_sha,parents:[scope.sourceSha]}));
  requireControl(typeof commit.sha==='string'&&SHA.test(commit.sha),'pilot-publisher-commit');
  const branch=queue?.branch??BRANCH_PREFIX+env.GITHUB_RUN_ID;
  if(queue)await queue.assertAuthorized();
  await api.request('POST','/git/refs',{ref:'refs/heads/'+branch,sha:commit.sha});
  if(queue)await queue.assertAuthorized();
  const pr=decode(await api.request('POST','/pulls',{
    title:`Issue #${scope.issue}: validated hosted proposal (draft)`,
    head:branch,base:'main',draft:true,maintainer_can_modify:false,
    body:prBody,
  }));
  requireControl(typeof pr.number==='number'&&Number.isSafeInteger(pr.number)&&pr.number>0&&pr.draft===true,'pilot-publisher-draft-pr');
  process.stdout.write('Sovereign published draft PR #'+pr.number+'; owner review required.\n');
  return {number:pr.number,url:`https://github.com/${REPOSITORY}/pull/${pr.number}`,headSha:commit.sha,treeSha:receipt.tree_sha};
}
if(process.argv[1]?.endsWith('codex-pilot-publish.ts')){
  process.stderr.write('Legacy Issue76 publisher retired. Use the signed queue.\n');process.exitCode=1;
}
