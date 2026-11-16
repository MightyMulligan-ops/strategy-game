import { test,expect } from 'vitest';
import { canonicalScope,sha256,REPOSITORY,OWNER,type TaskScope } from '../codex-automation-policy.ts';
import { GitHubAdmissionCollector,GitHubLedgerStore,grantText,type GitHubTransport,type OwnerGrant,type GitHubReply } from '../codex-github-control.ts';
import { RunController,type RunLedger } from '../codex-run-control.ts';

const scope:TaskScope={repository:REPOSITORY,issue:76,sourceSha:'a'.repeat(40),baseSha:'a'.repeat(40),
  approvedPaths:['packages/game-engine/src/combat.ts'],acceptanceDigest:sha256('frozen fixture issue'),expiresAt:'2026-11-15T00:00:00Z'};
const project='proj_fixture';
const initial=():RunLedger=>({version:1,project,months:[{month:'2026-11',baselineMicroUsd:1000000,safetyMarginMicroUsd:1000000}],runs:[]});
class FakeGitHubLedger implements GitHubTransport {
  ref:string|undefined; content=new Map<string,string>(); trees=new Map<string,string>(); commits=new Map<string,{parent:string|undefined;content:string}>();
  writes:{method:string;path:string;body:unknown}[]=[];
  async request(method:'GET'|'POST'|'PATCH',path:string,body?:unknown):Promise<GitHubReply>{
    const b=body as Record<string,unknown>; if(method!=='GET')this.writes.push({method,path,body});
    if(method==='GET'&&path.startsWith('/git/ref/'))return this.ref?{status:200,data:{ref:'refs/heads/sovereign-control-ledger-v1',object:{sha:this.ref}}}:{status:404,data:{}};
    if(method==='GET'&&path.startsWith('/contents/')){
      const commit=this.commits.get(path.split('?ref=')[1]!);if(!commit)return {status:404,data:{}};
      return {status:200,data:{type:'file',encoding:'base64',size:Buffer.byteLength(commit.content),content:Buffer.from(commit.content).toString('base64')}};
    }
    if(method==='POST'&&path==='/git/trees'){
      const content=(b.tree as {content:string}[])[0]!.content;const sha=sha256(content).slice(0,40);this.trees.set(sha,content);return {status:201,data:{sha}};
    }
    if(method==='POST'&&path==='/git/commits'){
      const sha=sha256(JSON.stringify(b)).slice(0,40);this.commits.set(sha,{parent:(b.parents as string[])[0]!,content:this.trees.get(b.tree as string)!});return {status:201,data:{sha}};
    }
    if(method==='POST'&&path==='/git/refs'){
      if(this.ref)return {status:422,data:{}};this.ref=b.sha as string;return {status:201,data:{ref:b.ref}};
    }
    if(method==='PATCH'){
      if(b.sha===this.ref)return {status:200,data:{object:{sha:this.ref}}};
      if(this.commits.get(b.sha as string)?.parent!==this.ref)return {status:422,data:{}};
      expect(b.force).toBe(false);this.ref=b.sha as string;return {status:200,data:{object:{sha:this.ref}}};
    }
    throw Error('unexpected fixture endpoint');
  }
}
test('GitHub ledger bootstrap is explicit, durable, and cannot overwrite a live ledger',async()=>{
  const api=new FakeGitHubLedger();const store=new GitHubLedgerStore(api);
  await expect(store.read()).rejects.toThrow();await store.bootstrap(initial());expect((await store.read()).ledger).toEqual(initial());
  await expect(store.bootstrap(initial())).rejects.toThrow();
});
test('two GitHub-backed controllers cannot both claim an active paid run',async()=>{
  const api=new FakeGitHubLedger();await new GitHubLedgerStore(api).bootstrap(initial());
  const outcomes=await Promise.allSettled([1,2].map(i=>new RunController(new GitHubLedgerStore(api),project).claim(scope,`run-${i}`,'2026-11',10000)));
  expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect((await new GitHubLedgerStore(api).read()).ledger.runs).toHaveLength(1);
  expect(api.writes.every(x=>!x.path.includes('main')&&!x.path.includes('merge'))).toBe(true);
});
const grant:OwnerGrant={repository:REPOSITORY,issue:76,scopeDigest:sha256(canonicalScope(scope)),runId:'run-1',project,maxMicroUsd:1000000,
  operations:['implement','test','paid','publish-draft','existing-ci']};
function collectorFixture(){
  const responses:Record<string,Record<string,unknown>>={
    '/issues/76':{number:76,state:'open',body:'frozen fixture issue'},
    '/issues/comments/123':{id:123,issue_url:`https://api.github.com/repos/${REPOSITORY}/issues/76`,
      user:{id:353505747,login:OWNER,type:'User'},body:grantText(grant),created_at:'2026-11-14T00:00:00Z',updated_at:'2026-11-14T00:00:00Z'},
    [`/collaborators/${OWNER}/permission`]:{permission:'admin',user:{id:353505747}},
    '/git/ref/heads/main':{ref:'refs/heads/main',object:{sha:scope.sourceSha}},
  };
  let unavailable=false;let checks=0;
  const api:GitHubTransport={request:async(_method,path)=>{checks++;return {status:unavailable?404:200,data:responses[path]};}};
  const runtime={verify:async()=>({project,exclusiveProjectRouting:true,keyProjectBindingVerified:true,isolatedWorkerVerified:true,immutableToolchainVerified:true,runtimeObservedAt:'2026-11-14T20:00:00Z'})};
  return {responses,fail:()=>{unavailable=true;},checks:()=>checks,
    collector:new GitHubAdmissionCollector(api,scope,123,grant,runtime,()=>new Date('2026-11-14T20:00:00Z'))};
}
test('live collector authenticates owner identity, permission, immutable grant, frozen issue and current source',async()=>{
  const x=collectorFixture();expect((await x.collector.check()).grantDigest).toBe(grant.scopeDigest);
  await x.collector.check();expect(x.checks()).toBe(8);
});
test('edited, deleted, wrong-issue or forged owner grants fail current admission',async()=>{
  for(const mutate of [
    (r:Record<string,Record<string,unknown>>)=>{r['/issues/comments/123']!.updated_at='2026-11-14T01:00:00Z';},
    (r:Record<string,Record<string,unknown>>)=>{r['/issues/comments/123']!.issue_url='https://api.github.com/repos/other/repo/issues/76';},
    (r:Record<string,Record<string,unknown>>)=>{r['/issues/comments/123']!.user={id:1,login:OWNER,type:'User'};},
    (r:Record<string,Record<string,unknown>>)=>{r[`/collaborators/${OWNER}/permission`]!.permission='read';},
    (r:Record<string,Record<string,unknown>>)=>{r['/issues/76']!.body='new scope';},
    (r:Record<string,Record<string,unknown>>)=>{r['/git/ref/heads/main']!.object={sha:'c'.repeat(40)};},
  ]){const x=collectorFixture();mutate(x.responses);await expect(x.collector.check()).rejects.toThrow();}
  const x=collectorFixture();x.fail();await expect(x.collector.check()).rejects.toThrow();
});

test('identical simultaneous run IDs still have only one winner (unique Git commit nonce)',async()=>{
  const api=new FakeGitHubLedger();await new GitHubLedgerStore(api).bootstrap(initial());
  const outcomes=await Promise.allSettled([1,2].map(()=>new RunController(new GitHubLedgerStore(api),project).claim(scope,'identical-run','2026-11',10000)));
  expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
});
