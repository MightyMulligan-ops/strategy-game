/** Credential-free trusted host controller. Never import generated application
 * code here. Docker stdout/stderr is untrusted and is never an Actions command. */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,readFileSync,writeFileSync,appendFileSync,mkdtempSync,rmSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,relative,sep,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireControl,ControlDenied} from './codex-run-control.ts';
import {sha256,REPOSITORY,SHA} from './codex-automation-policy.ts';
import {REQUIRED_CHECKS,PNPM_VERSION,makeValidationReceipt,verifyBundle,type CheckSuccess,type ValidationBundle,type ValidationContext} from './codex-pilot-receipt.ts';

export const PNPM_EXECUTABLE='/opt/sovereign/node_modules/.bin/pnpm';
export type CommandResult={status:number|null;signal?:string|null;error?:unknown;stdout?:string};
export type Runner=(executable:string,args:readonly string[],input?:string)=>CommandResult;
export const execute:Runner=(executable,args,input)=>{
  const r=spawnSync(executable,[...args],{input,encoding:'utf8',timeout:5*60_000,maxBuffer:8*1024*1024,
    // Capture, do not forward workflow commands printed by untrusted code.
    stdio:['pipe','pipe','pipe']});
  return {status:r.status,signal:r.signal,error:r.error,stdout:r.stdout??''};
};
function checked(run:Runner,exe:string,args:readonly string[],code:string,input?:string):string{
  let result:CommandResult;
  try{result=run(exe,args,input);}catch{throw new ControlDenied(code);}
  requireControl(result.status===0&&!result.error&&!result.signal,code);
  return result.stdout??'';
}
export function buildValidationImage(repo:string,tag:string,run:Runner=execute):string{
  requireControl(/^[a-z0-9][a-z0-9:._-]{0,100}$/.test(tag),'validation-image-tag');
  checked(run,'docker',['build','--network=default','-t',tag,'-'],'validation-image-build',
    readFileSync(join(repo,'scripts/sovereign-validation.Dockerfile'),'utf8'));
  const image=checked(run,'docker',['image','inspect','--format','{{.Id}}',tag],'validation-image-inspect').trim();
  requireControl(/^sha256:[a-f0-9]{64}$/.test(image),'validation-image-id');return image;
}
export function isolatedArguments(workspace:string,image:string,user:string):string[]{
  requireControl(/^sha256:[a-f0-9]{64}$/.test(image)&&/^\d+:\d+$/.test(user),'validation-container-identity');
  requireControl(!/[\r\n,]/.test(workspace),'validation-workspace-path');
  return ['run','--rm','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only',
    '--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--pids-limit','256','--memory','4g','--cpus','2',
    '--user',user,'--env','HOME=/tmp','--env','AUTH_ENABLED=false','--env','RUN_DATABASE_TESTS=0',
    '--mount',`type=bind,source=${workspace},target=/workspace`,'-w','/workspace',image,PNPM_EXECUTABLE];
}
/** No shell/AND-list. A nonzero exit, missing executable, signal, timeout or
 * failed tree verification aborts before the next command and before a receipt. */
export function runIsolatedChecks(workspace:string,image:string,user:string,verifyTree:()=>void,run:Runner=execute):readonly CheckSuccess[]{
  const args=isolatedArguments(workspace,image,user);
  const version=checked(run,'docker',[...args,'--version'],'validation-pnpm-unavailable').trim();
  requireControl(version===PNPM_VERSION,'validation-pnpm-version');
  verifyTree();
  const checks:CheckSuccess[]=[];
  for(const command of REQUIRED_CHECKS){
    process.stdout.write(`Validator starting ${command}\n`);
    checked(run,'docker',[...args,command],`validation-${command}-failed`);
    verifyTree();
    checks.push({command,status:'passed',exitCode:0});
  }
  return checks;
}
export function copyValidationWorkspace(repo:string,workspace:string):void{
  // Never mount a host Git directory, receipt, Actions output file or cache of
  // previous diagnostics. The container receives source/dependencies only.
  requireControl(relative(repo,workspace).startsWith('..'),'validation-workspace-outside-source');
  cpSync(repo,workspace,{recursive:true,verbatimSymlinks:true,filter:path=>
    !['.git','.cache','.worktrees'].includes(relative(repo,path).split(sep)[0]??'')&&
    (!/^\.env(?:\.|$)/.test(basename(path))||basename(path)==='.env.example')});
}
/** Trusted Git reads expected objects only. Hash actual workspace bytes ourselves
 * so worker-written Git config/index/hooks cannot impersonate the tested tree. */
export function verifyWorkspaceTree(repo:string,workspace:string,tree:string):void{
  requireControl(SHA.test(tree),'validation-tree-id');
  const git=(args:readonly string[],env?:NodeJS.ProcessEnv)=>{
    const result=spawnSync('git',['-C',repo,'-c','core.hooksPath=/dev/null',...args],
      {encoding:'utf8',timeout:30_000,maxBuffer:4*1024*1024,...(env?{env}:{})});
    requireControl(result.status===0&&!result.error&&!result.signal,'validation-tree-git');return result.stdout;
  };
  const rows=git(['ls-tree','-r','-l','-z',tree]).split('\0').filter(Boolean);
  requireControl(rows.length>0,'validation-tree-empty');
  for(const row of rows){
    const match=/^(100644|100755) blob ([a-f0-9]{40}) +([0-9]+)\t(.+)$/.exec(row);
    requireControl(match,'validation-tree-entry');
    const [,mode,hash,sizeText,path]=match;
    requireControl(path&&!path.includes('\\')&&!path.startsWith('/')&&
      path.split('/').every(p=>p!=='.'&&p!=='..'&&p!==''),'validation-tree-path');
    let current=workspace;
    const parts=path.split('/');
    for(let i=0;i<parts.length;i++){
      current=join(current,parts[i]!);const info=lstatSync(current);
      requireControl(!info.isSymbolicLink()&&(i===parts.length-1?info.isFile():info.isDirectory()),'validation-tree-file');
    }
    const info=lstatSync(current);
    requireControl(info.size===Number(sizeText)&&info.nlink===1&&
      (process.platform==='win32'||Boolean(info.mode&0o111)===(mode==='100755')),'validation-tree-file');
    const bytes=readFileSync(current);
    requireControl(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')===hash,'validation-tree-drift');
  }
  // Find added, non-ignored files against a private expected-tree index. No
  // worker Git metadata or clean/smudge filter is loaded or executed.
  const temp=mkdtempSync(join(tmpdir(),'sovereign-tree-'));
  try{
    const env={...process.env,GIT_INDEX_FILE:join(temp,'index')};
    git(['read-tree',tree],env);
    const gitDir=git(['rev-parse','--absolute-git-dir']).trim();
    const untracked=git(['--git-dir='+gitDir,'--work-tree='+workspace,'ls-files','--others','--exclude-standard','-z'],env);
    if(untracked!==''){
      // Bounded path metadata only, never file contents or arbitrary tool output.
      const paths=untracked.split('\0').filter(Boolean).slice(0,8).map(path=>
        /^[A-Za-z0-9_./-]{1,160}$/.test(path)&&!/(?:sk[-_]|github_pat|Bearer)/i.test(path)?path:'[redacted]');
      process.stderr.write(JSON.stringify({code:'validation-tree-untracked',paths})+'\n');
      throw new ControlDenied('validation-tree-untracked');
    }
  }finally{rmSync(temp,{recursive:true,force:true});}
}
const names={scope:'scope.json',manifest:'manifest.json',patch:'proposal.patch',summary:'summary.txt',replay:'validated-report.json'} as const;
export function readValidationBundle(dir:string):ValidationBundle{
  return Object.fromEntries(Object.entries(names).map(([key,name])=>[key,new Uint8Array(readFileSync(join(dir,name)))])) as ValidationBundle;
}
export function writeValidationReceipt(dir:string,context:ValidationContext,image:string,checks:readonly CheckSuccess[],bundle:ValidationBundle,output:string):void{
  // Re-read binding files after containers have stopped, before writing evidence.
  const current=readValidationBundle(dir);
  requireControl(Object.entries(bundle).every(([k,v])=>sha256(v)===sha256(current[k as keyof ValidationBundle])),
    'validation-artifact-drift');
  const bytes=JSON.stringify(makeValidationReceipt(bundle,context,image,checks))+'\n';
  writeFileSync(join(dir,'validation-receipt.json'),bytes,{flag:'wx',mode:0o600});
  appendFileSync(output,`validation_sha256=${sha256(bytes)}\n`);
}
function main():void{
  const repo=process.cwd(),env=process.env;
  requireControl(env.OPENAI_API_KEY===undefined&&env.GITHUB_TOKEN===undefined&&env.AUTH_ENABLED==='false'&&
    env.RUN_DATABASE_TESTS==='0'&&env.GITHUB_REPOSITORY===REPOSITORY,'validation-host-environment');
  const smoke=process.argv[2]==='smoke';
  requireControl(smoke?env.GITHUB_ACTIONS==='true'&&env.GITHUB_JOB==='quality':
    env.GITHUB_JOB==='validate'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_REF==='refs/heads/main'&&
    env.GITHUB_ACTOR==='MightyMulligan-ops'&&env.GITHUB_ACTOR_ID==='353505747'&&env.GITHUB_RUN_ATTEMPT==='1',
    'validation-host-identity');
  requireControl(/^\d+$/.test(env.GITHUB_RUN_ID??'')&&typeof env.RUNNER_TEMP==='string','validation-run');
  const user=`${process.getuid!()}:${process.getgid!()}`;
  const root=mkdtempSync(join(env.RUNNER_TEMP!,'sovereign-validation-'));
  const workspace=join(root,'repo');
  const dir=join(env.RUNNER_TEMP!,'sovereign-pilot','validated');
  const bundle=smoke?undefined:readValidationBundle(dir);
  const expected=bundle?verifyBundle(bundle).replay.tree_sha:
    checked(execute,'git',['rev-parse','HEAD^{tree}'],'validation-source-tree').trim();
  const image=buildValidationImage(repo,'sovereign-validation:'+env.GITHUB_RUN_ID);
  copyValidationWorkspace(repo,workspace);
  const checks=runIsolatedChecks(workspace,image,user,()=>verifyWorkspaceTree(repo,workspace,expected));
  if(bundle){
    requireControl(typeof env.GITHUB_OUTPUT==='string'&&typeof env.GITHUB_SHA==='string','validation-output');
    writeValidationReceipt(dir,{runId:env.GITHUB_RUN_ID!,sourceSha:env.GITHUB_SHA!},image,checks,bundle,env.GITHUB_OUTPUT!);
  }
  process.stdout.write('Validator completed all four isolated checks and exact-tree verification.\n');
  // Runner-temp workspace is intentionally left to runner teardown. Never follow
  // worker-created symlinks in a recursive host cleanup operation.
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){
    const code=error instanceof ControlDenied?error.code:'validation-failed';
    process.stderr.write(`Sovereign validator denied: ${code}\n`);process.exitCode=1;
  }
}
