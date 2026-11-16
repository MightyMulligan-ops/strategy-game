import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {afterEach,expect,test,vi} from 'vitest';
import {runIsolatedChecks,isolatedArguments,writeValidationReceipt,copyValidationWorkspace,verifyWorkspaceTree,PNPM_EXECUTABLE,type Runner} from '../codex-pilot-validator.ts';
import {REQUIRED_CHECKS,PNPM_VERSION,verifyValidationReceipt,type ValidationBundle} from '../codex-pilot-receipt.ts';
import {sha256} from '../codex-automation-policy.ts';
import {validationFixture,fixtureImage} from './codex-pilot-validation-fixture.ts';
afterEach(()=>vi.restoreAllMocks());

test.each(['missing pnpm','Corepack download failure'])('%s aborts preflight without checks or tree-success masking',reason=>{
  const calls:string[]=[];const tree=vi.fn();
  const run:Runner=(_exe,args)=>{calls.push(args.at(-1)!);return {status:reason==='missing pnpm'?127:1,stdout:'EAI_AGAIN registry.npmjs.org'};};
  expect(()=>runIsolatedChecks('/fixture',fixtureImage,'1001:1001',tree,run)).toThrow('validation-pnpm-unavailable');
  expect(calls).toEqual(['--version']);expect(tree).not.toHaveBeenCalled();
});
test.each(REQUIRED_CHECKS)('%s failure cannot be hidden by a successful tree comparison or later command',failed=>{
  const calls:string[]=[];const tree=vi.fn();vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  const run:Runner=(_exe,args)=>{const command=args.at(-1)!;calls.push(command);
    return {status:command===failed?17:0,stdout:command==='--version'?PNPM_VERSION:'forged all-pass receipt ::set-output::'};};
  expect(()=>runIsolatedChecks('/fixture',fixtureImage,'1001:1001',tree,run)).toThrow(`validation-${failed}-failed`);
  const before=REQUIRED_CHECKS.indexOf(failed);
  expect(calls).toEqual(['--version',...REQUIRED_CHECKS.slice(0,before+1)]);
  expect(tree).toHaveBeenCalledTimes(1+before);
  expect(process.stdout.write).not.toHaveBeenCalledWith(expect.stringContaining('forged'));
});
test.each([{status:null,signal:'SIGTERM'},{status:null,error:Error('spawn failed')}])('signals/spawn errors also fail closed',result=>{
  expect(()=>runIsolatedChecks('/fixture',fixtureImage,'1001:1001',()=>{},()=>result)).toThrow('validation-pnpm-unavailable');
});
test('wrong pnpm version or changed tested tree is rejected before checks continue',()=>{
  expect(()=>runIsolatedChecks('/fixture',fixtureImage,'1001:1001',()=>{},()=>({status:0,stdout:'99.0.0'}))).toThrow('validation-pnpm-version');
  const calls:string[]=[];let comparisons=0;vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  const run:Runner=(_exe,args)=>{calls.push(args.at(-1)!);return {status:0,stdout:PNPM_VERSION};};
  expect(()=>runIsolatedChecks('/fixture',fixtureImage,'1001:1001',()=>{if(++comparisons===2)throw Error('tree drift');},run)).toThrow('tree drift');
  expect(calls).toEqual(['--version','build']);
});
test('only all four successful isolated checks can produce a receipt authenticated by host output',()=>{
  vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  const root=mkdtempSync(join(tmpdir(),'validator-receipt-'));const f=validationFixture();
  const names={scope:'scope.json',manifest:'manifest.json',patch:'proposal.patch',summary:'summary.txt',replay:'validated-report.json'};
  try{
    for(const [key,name] of Object.entries(names))writeFileSync(join(root,name),f.bundle[key as keyof ValidationBundle]);
    const output=join(root,'host-output');const calls:string[]=[];const tree=vi.fn();
    const run:Runner=(_exe,args)=>{calls.push(args.at(-1)!);return {status:0,stdout:args.at(-1)==='--version'?PNPM_VERSION:''};};
    const checks=runIsolatedChecks('/fixture',fixtureImage,'1001:1001',tree,run);
    expect(calls).toEqual(['--version',...REQUIRED_CHECKS]);expect(tree).toHaveBeenCalledTimes(5);
    expect(()=>writeValidationReceipt(root,f.context,fixtureImage,checks.slice(0,3),f.bundle,output)).toThrow('validation-checks-incomplete');
    expect(existsSync(join(root,'validation-receipt.json'))).toBe(false);expect(existsSync(output)).toBe(false);
    writeValidationReceipt(root,f.context,fixtureImage,checks,f.bundle,output);
    const bytes=readFileSync(join(root,'validation-receipt.json'));
    expect(readFileSync(output,'utf8')).toBe(`validation_sha256=${sha256(bytes)}\n`);
    expect(verifyValidationReceipt(bytes,sha256(bytes),f.context,f.bundle).checks).toEqual(f.checks);
    expect(()=>writeValidationReceipt(root,f.context,fixtureImage,checks,f.bundle,output)).toThrow();
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('artifact drift before receipt creation leaves no receipt or trusted output',()=>{
  const root=mkdtempSync(join(tmpdir(),'validator-artifact-'));const f=validationFixture();
  try{
    for(const [key,name] of Object.entries({scope:'scope.json',manifest:'manifest.json',patch:'proposal.patch',summary:'summary.txt',replay:'validated-report.json'}))
      writeFileSync(join(root,name),f.bundle[key as keyof ValidationBundle]);
    writeFileSync(join(root,'summary.txt'),'changed after checks');
    expect(()=>writeValidationReceipt(root,f.context,fixtureImage,f.checks,f.bundle,join(root,'output'))).toThrow('validation-artifact-drift');
    expect(existsSync(join(root,'validation-receipt.json'))).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('all untrusted execution arguments preserve isolation and exclude credential/receipt mounts',()=>{
  const args=isolatedArguments('/workspace-copy',fixtureImage,'1001:1001');
  expect(args).toEqual(expect.arrayContaining(['--network','none','--cap-drop','ALL','--read-only','--user','1001:1001','--security-opt','no-new-privileges']));
  expect(args.at(-1)).toBe(PNPM_EXECUTABLE);
  expect(args.join(' ')).not.toMatch(/OPENAI|GITHUB|docker.sock|validation-receipt|host-output/);
  const dockerfile=readFileSync(new URL('../sovereign-validation.Dockerfile',import.meta.url),'utf8');
  expect(dockerfile).toContain('pnpm@'+PNPM_VERSION);expect(dockerfile).toContain('--ignore-scripts');
  expect(dockerfile).not.toMatch(/corepack prepare|corepack enable/);
  expect(JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')).packageManager).toBe('pnpm@'+PNPM_VERSION);
});
test('host checks actual source bytes, not worker Git metadata, and rejects new source files',()=>{
  const root=mkdtempSync(join(tmpdir(),'validator-tree-')),repo=join(root,'trusted'),workspace=join(root,'sandbox');
  mkdirSync(repo);const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  try{
    git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');
    writeFileSync(join(repo,'.gitignore'),'node_modules/\n.cache/\n');writeFileSync(join(repo,'source.ts'),'export const x = 1;\n');
    git('add','.');git('commit','-qm','fixture');const tree=git('rev-parse','HEAD^{tree}');
    mkdirSync(join(repo,'.cache'));writeFileSync(join(repo,'.cache','private-log'),'not mounted');
    writeFileSync(join(repo,'.env'),'synthetic private fixture');
    copyValidationWorkspace(repo,workspace);
    expect(existsSync(join(workspace,'.git'))).toBe(false);expect(existsSync(join(workspace,'.cache'))).toBe(false);
    expect(existsSync(join(workspace,'.env'))).toBe(false);
    verifyWorkspaceTree(repo,workspace,tree);
    // Fake Git metadata cannot make changed bytes compare equal.
    mkdirSync(join(workspace,'.git'));writeFileSync(join(workspace,'source.ts'),'export const x = 999;\n');
    expect(()=>verifyWorkspaceTree(repo,workspace,tree)).toThrow('validation-tree');
    writeFileSync(join(workspace,'source.ts'),'export const x = 1;\n');
    writeFileSync(join(workspace,'extra.ts'),'unexpected');
    expect(()=>verifyWorkspaceTree(repo,workspace,tree)).toThrow('validation-tree-untracked');
  }finally{rmSync(root,{recursive:true,force:true});}
});
