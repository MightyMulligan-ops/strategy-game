import {expect,test} from 'vitest';
import {canonicalScope,REPOSITORY,sha256,type TaskScope} from '../codex-automation-policy.ts';
import {verifyReplayReceipt,type ReplayReceipt} from '../codex-pilot-receipt.ts';
import {validationFixture} from './codex-pilot-validation-fixture.ts';
import {runPilotPublisher} from '../codex-pilot-publish.ts';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {vi} from 'vitest';
const patch=new Uint8Array([1,2,3]);
const scope:TaskScope={repository:REPOSITORY,issue:76,
  sourceSha:'a'.repeat(40),baseSha:'a'.repeat(40),
  approvedPaths:['packages/game-engine/src/combat.ts'],
  acceptanceDigest:'b'.repeat(64),expiresAt:'2026-12-15T00:00:00Z'};
const valid=():ReplayReceipt=>({
  tree_sha:'c'.repeat(40),source_sha:scope.sourceSha,
  scope_digest:sha256(canonicalScope(scope)),patch_sha256:sha256(patch),
  paths:['packages/game-engine/src/combat.ts'],result:'RECONSTRUCTED_NO_EXECUTION',
});
test('publisher accepts only validator exact-tree digest and scope',()=>{
  expect(()=>verifyReplayReceipt(valid(),scope,patch)).not.toThrow();
});
test('publisher rejects unapproved paths, fake tree, patch drift, unknown result',()=>{
  const bad=[
    {...valid(),tree_sha:'not-a-sha'},
    {...valid(),source_sha:'d'.repeat(40)},
    {...valid(),scope_digest:'e'.repeat(64)},
    {...valid(),patch_sha256:'f'.repeat(64)},
    {...valid(),paths:['.github/workflows/ci.yml']},
    {...valid(),paths:['packages/game-engine/src/combat.ts','packages/game-engine/src/combat.ts']},
    {...valid(),result:'FAKE' as const},
  ];
  for(const r of bad)expect(()=>verifyReplayReceipt(r,scope,patch)).toThrow();
  expect(()=>verifyReplayReceipt(valid(),scope,new Uint8Array([9]))).toThrow();
});

test('publisher denies missing, incomplete, unsuccessful or forged evidence before any GitHub request',async()=>{
  const root=mkdtempSync(join(tmpdir(),'publisher-denial-')),dir=join(root,'sovereign-pilot','validated');
  mkdirSync(dir,{recursive:true});const f=validationFixture();
  const env={GITHUB_REPOSITORY:REPOSITORY,GITHUB_ACTOR:'MightyMulligan-ops',GITHUB_ACTOR_ID:'353505747',
    GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',
    GITHUB_RUN_ID:'123',GITHUB_SHA:f.context.sourceSha,GITHUB_TOKEN:'fixture-token',RUNNER_TEMP:root,
    EXPECTED_VALIDATION_SHA256:f.digest};
  let calls=0;const transport:typeof fetch=async()=>{calls++;throw Error('Must not contact GitHub');};
  try{
    for(const [key,name] of Object.entries({scope:'scope.json',manifest:'manifest.json',patch:'proposal.patch',summary:'summary.txt',replay:'validated-report.json'}))
      writeFileSync(join(dir,name),f.bundle[key as keyof typeof f.bundle]);
    await expect(runPilotPublisher(env,transport)).rejects.toThrow();
    for(const receipt of [{...f.receipt,checks:f.checks.slice(0,3)},
      {...f.receipt,checks:f.checks.map(c=>({...c,exitCode:1}))},{...f.receipt,runId:'999'}]){
      const bytes=Buffer.from(JSON.stringify(receipt));writeFileSync(join(dir,'validation-receipt.json'),bytes);
      await expect(runPilotPublisher({...env,EXPECTED_VALIDATION_SHA256:sha256(bytes)},transport)).rejects.toThrow();
    }
    writeFileSync(join(dir,'validation-receipt.json'),f.bytes);
    await expect(runPilotPublisher({...env,EXPECTED_VALIDATION_SHA256:undefined},transport)).rejects.toThrow();
    writeFileSync(join(dir,'validation-receipt.json'),Buffer.concat([f.bytes,Buffer.from(' ')]));
    await expect(runPilotPublisher(env,transport)).rejects.toThrow('validation-receipt-authenticity');
    writeFileSync(join(dir,'validation-receipt.json'),f.bytes);writeFileSync(join(dir,'summary.txt'),'changed');
    await expect(runPilotPublisher(env,transport)).rejects.toThrow('validation-receipt-artifacts');
    expect(calls).toBe(0);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('fully checked exact-tree receipt publishes only a draft through mocked GitHub',async()=>{
  const root=mkdtempSync(join(tmpdir(),'publisher-success-')),repo=join(root,'repo'),dir=join(root,'sovereign-pilot','validated');
  mkdirSync(join(repo,'packages/game-engine/src'),{recursive:true});mkdirSync(dir,{recursive:true});
  const sourcePath='packages/game-engine/src/combat.ts';
  const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  const log=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  try{
    git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');
    writeFileSync(join(repo,sourcePath),'export const combat = 1;\n');git('add','.');git('commit','-qm','fixture');
    const source=git('rev-parse','HEAD'),baseTree=git('rev-parse','HEAD^{tree}');
    const content='export const combat = 2;\n';writeFileSync(join(repo,sourcePath),content);
    const patch=execFileSync('git',['-C',repo,'diff','--binary']);git('add','.');const tree=git('write-tree');
    const f=validationFixture(source,tree,patch,content);
    for(const [key,name] of Object.entries({scope:'scope.json',manifest:'manifest.json',patch:'proposal.patch',summary:'summary.txt',replay:'validated-report.json'}))
      writeFileSync(join(dir,name),f.bundle[key as keyof typeof f.bundle]);
    writeFileSync(join(dir,'validation-receipt.json'),f.bytes);
    const posts:{path:string;body:Record<string,unknown>}[]=[];
    const transport:typeof fetch=async(url,init)=>{
      const path=String(url).split('/strategy-game')[1]!;
      if(init?.method==='GET')return Response.json(path==='/git/ref/heads/main'?{object:{sha:source}}:
        path.startsWith('/pulls?')?[]:{tree:{sha:baseTree}});
      const body=JSON.parse(init?.body as string);posts.push({path,body});
      return Response.json(path==='/git/trees'?{sha:tree}:path==='/git/commits'?{sha:'d'.repeat(40)}:
        path==='/pulls'?{number:123,draft:true}:{},{status:201});
    };
    await runPilotPublisher({GITHUB_REPOSITORY:REPOSITORY,GITHUB_ACTOR:'MightyMulligan-ops',GITHUB_ACTOR_ID:'353505747',
      GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',
      GITHUB_SHA:source,GITHUB_TOKEN:'fixture-token',RUNNER_TEMP:root,EXPECTED_VALIDATION_SHA256:f.digest},transport,repo);
    expect(posts.map(p=>p.path)).toEqual(['/git/trees','/git/commits','/git/refs','/pulls']);
    expect(posts[0]!.body.tree).toEqual([{path:sourcePath,mode:'100644',type:'blob',content}]);
    expect(posts.at(-1)!.body).toMatchObject({draft:true,base:'main',maintainer_can_modify:false});
    expect(readFileSync(join(dir,'proposal.patch'))).toEqual(patch);
  }finally{log.mockRestore();rmSync(root,{recursive:true,force:true});}
});
