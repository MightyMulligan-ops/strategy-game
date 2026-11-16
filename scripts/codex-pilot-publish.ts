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
      method,redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28',...(data===undefined?{}:{'Content-Type':'application/json'})},
      ...(data===undefined?{}:{body:JSON.stringify(data)}),
    });
    requireControl(response.status===(method==='GET'?200:201),'pilot-publisher-provider');
    const body=await response.text();
    requireControl(Buffer.byteLength(body)<=256*1024,'pilot-publisher-response-size');
    try{return JSON.parse(body);}catch{throw new ControlDenied('pilot-publisher-response-json');}
  }
}
export async function runPilotPublisher(env:NodeJS.ProcessEnv,fetcher:typeof fetch=fetch,repo=process.cwd()):Promise<void>{
  requireControl(env.GITHUB_REPOSITORY===REPOSITORY&&
    env.GITHUB_ACTOR==='MightyMulligan-ops'&&env.GITHUB_ACTOR_ID==='353505747'&&
    env.GITHUB_REF==='refs/heads/main'&&
    env.GITHUB_EVENT_NAME==='workflow_dispatch'&&
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
  requireControl(scope.issue===76&&scope.sourceSha===env.GITHUB_SHA&&
    scope.scopeDigest===sha256(canonicalScope(scope)),'pilot-publisher-scope');
  const api=new GitHubApi(env.GITHUB_TOKEN,fetcher);
  const main=decode(await api.request('GET','/git/ref/heads/main'));
  requireControl(decode(main.object).sha===scope.sourceSha,'pilot-main-advanced');
  const openPrs=await api.request('GET','/pulls?state=open&per_page=100');
  requireControl(Array.isArray(openPrs)&&!openPrs.some(item=>{
    const pr=decode(item);return typeof decode(pr.head).ref==='string'&&
      (decode(pr.head).ref as string).startsWith(BRANCH_PREFIX);
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
    message:'Issue #76: Sovereign validated hosted-agent combat prototype (draft)',
    tree:receipt.tree_sha,parents:[scope.sourceSha]}));
  requireControl(typeof commit.sha==='string'&&SHA.test(commit.sha),'pilot-publisher-commit');
  const branch=BRANCH_PREFIX+env.GITHUB_RUN_ID;
  await api.request('POST','/git/refs',{ref:'refs/heads/'+branch,sha:commit.sha});
  const pr=decode(await api.request('POST','/pulls',{
    title:'Issue #76: autonomous combat prototype (draft)',
    head:branch,base:'main',draft:true,maintainer_can_modify:false,
    body:'Automated hosted-agent proposal. Independently checked in secret-free GitHub Actions validation.\n\n'+
      'Summary:\n'+summary.slice(0,3000)+'\n\nRun: '+env.GITHUB_RUN_ID+
      '\nSource: '+scope.sourceSha+'\nValidated tree: '+receipt.tree_sha+
      '\nNo automatic merge or deployment. Owner review required.',
  }));
  requireControl(typeof pr.number==='number'&&pr.draft===true,'pilot-publisher-draft-pr');
  process.stdout.write('Sovereign published draft PR #'+pr.number+'; owner review required.\n');
}
if(process.argv[1]?.endsWith('codex-pilot-publish.ts')){
  void runPilotPublisher(process.env).catch(()=>{process.stderr.write('Sovereign draft publisher denied. No automatic retry.\n');process.exitCode=1;});
}
