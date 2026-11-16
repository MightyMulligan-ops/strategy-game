/** Draft-only publisher for the *validated* separate GitHub Actions job.
 * Does not execute agent code. Requires contents/write and pull_requests/write
 * in a secret-free publisher job that follows a successful isolated validation job.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {canonicalScope,sha256,REPOSITORY,validPath,SHA,type TaskScope} from './codex-automation-policy.ts';
import {requireControl,ControlDenied} from './codex-run-control.ts';

const API='https://api.github.com/repos/'+REPOSITORY;
const BRANCH_PREFIX='issue/76-sovereign-pilot-';
function git(...args:string[]):string{
  try{return execFileSync('git',['-c','core.hooksPath=/dev/null',
      '-c','diff.external=',...args],{encoding:'utf8',timeout:30_000,
      env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();}
  catch{throw new ControlDenied('pilot-publisher-git');}
}
function decode(v:unknown):Record<string,unknown>{
  requireControl(v!==null&&typeof v==='object'&&!Array.isArray(v),'pilot-publisher-object');
  return v as Record<string,unknown>;
}
export type PilotReceipt=Readonly<{
  tree_sha:string;source_sha:string;scope_digest:string;patch_sha256:string;
  paths:readonly string[];result:'RECONSTRUCTED_NO_EXECUTION';
}>;
export function verifyPilotReceipt(receipt:PilotReceipt,scope:TaskScope,patch:Uint8Array){
  requireControl(receipt&&SHA.test(receipt.source_sha)&&SHA.test(receipt.tree_sha)&&
    receipt.source_sha===scope.sourceSha&&
    receipt.scope_digest===sha256(canonicalScope(scope))&&
    receipt.patch_sha256===sha256(patch)&&
    receipt.result==='RECONSTRUCTED_NO_EXECUTION'&&
    Array.isArray(receipt.paths)&&receipt.paths.length>=1&&receipt.paths.length<=25&&
    receipt.paths.every(p=>validPath(p)&&scope.approvedPaths.includes(p))&&
    new Set(receipt.paths).size===receipt.paths.length,'pilot-publisher-receipt');
}
class GitHubApi {
  constructor(private readonly token:string){
    requireControl(token.length>0,'pilot-publisher-token');
  }
  async request(method:'GET'|'POST',path:string,data?:unknown):Promise<unknown>{
    requireControl(path.startsWith('/')&&!path.includes('..')&&path.length<300,'pilot-publisher-path');
    const response=await fetch(API+path,{
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
async function main():Promise<void>{
  const env=process.env;
  requireControl(env.GITHUB_REPOSITORY===REPOSITORY&&
    env.GITHUB_ACTOR==='MightyMulligan-ops'&&env.GITHUB_ACTOR_ID==='353505747'&&
    env.GITHUB_REF==='refs/heads/main'&&
    env.GITHUB_EVENT_NAME==='workflow_dispatch'&&
    env.GITHUB_RUN_ATTEMPT==='1'&&/^\d+$/.test(env.GITHUB_RUN_ID??'')&&
    typeof env.GITHUB_TOKEN==='string'&&env.GITHUB_TOKEN.length>0&&
    typeof env.RUNNER_TEMP==='string'&&env.OPENAI_API_KEY===undefined,
    'pilot-publisher-environment');
  const dir=join(env.RUNNER_TEMP!,'sovereign-pilot','validated');
  const scope=JSON.parse(await readFile(join(dir,'scope.json'),'utf8')) as TaskScope & {scopeDigest:string};
  const patch=new Uint8Array(await readFile(join(dir,'proposal.patch')));
  const receipt=JSON.parse(await readFile(join(dir,'validated-report.json'),'utf8')) as PilotReceipt;
  const summary=await readFile(join(dir,'summary.txt'),'utf8');
  requireControl(Buffer.byteLength(summary)<=16*1024,'pilot-publisher-summary');
  verifyPilotReceipt(receipt,scope,patch);
  requireControl(scope.issue===76&&scope.sourceSha===env.GITHUB_SHA&&
    scope.scopeDigest===sha256(canonicalScope(scope)),'pilot-publisher-scope');
  const api=new GitHubApi(env.GITHUB_TOKEN);
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
    {encoding:'utf8',timeout:30_000,env:gitEnv,stdio:['ignore','pipe','pipe']}).trim();
  try{
    run('read-tree',scope.sourceSha);
    run('apply','--cached','--check',out);
    run('apply','--cached',out);
    requireControl(run('write-tree')===receipt.tree_sha,'pilot-publisher-tree-drift');
  }catch{throw new ControlDenied('pilot-publisher-tree');}
  const treeEntries=[];
  for(const path of receipt.paths){
    let content:string;
    try{content=run('show',':'+path);}catch{throw new ControlDenied('pilot-publisher-file');}
    // git show via encoding UTF-8 may remove trailing newline in .trim(); obtain exact
    // bytes from git cat-file for successful digest/tree reconstruction instead.
    const binary=execFileSync('git',['-c','core.hooksPath=/dev/null','show',':'+path],
      {env:gitEnv,timeout:30_000,maxBuffer:1_500_000});
    content=new TextDecoder('utf8',{fatal:true}).decode(binary);
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
  void main().catch(()=>{process.stderr.write('Sovereign draft publisher denied. No automatic retry.\n');process.exitCode=1;});
}
