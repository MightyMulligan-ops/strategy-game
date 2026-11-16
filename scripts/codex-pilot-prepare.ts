/** One issue, one immutable source, no paid call. Trusted Actions preflight job only.
 * Env GITHUB_TOKEN is read-only and NEVER enters the agent job.
 */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalScope,sha256,REPOSITORY,type TaskScope} from './codex-automation-policy.ts';
import {ControlDenied,requireControl} from './codex-run-control.ts';
const SHA=/^[a-f0-9]{40}$/;
const APPROVED_PATHS=['packages/game-engine/src/combat.ts',
  'packages/game-engine/tests/combat.test.ts'] as const;

export type PilotInput=Readonly<{
  scope:TaskScope;scopeDigest:string;issueBody:string;
  archiveSha256:string;archiveBytes:number;runId:string;
}>;
export function makePilotInput(
  issueBody:string,sha:string,archive:Uint8Array,runId:string,now:Date,
):PilotInput {
  requireControl(typeof issueBody==='string'&&issueBody.length>0&&
    Buffer.byteLength(issueBody)<=32*1024&&SHA.test(sha)&&
    archive.byteLength>0&&archive.byteLength<=50*1024*1024&&
    /^run_[0-9]{1,16}$/.test(runId),'pilot-input-source');
  const scope:TaskScope={
    repository:REPOSITORY,issue:76,sourceSha:sha,baseSha:sha,
    approvedPaths:APPROVED_PATHS,acceptanceDigest:sha256(issueBody),
    expiresAt:new Date(now.getTime()+60*60*1000).toISOString(),
  };
  return {scope,scopeDigest:sha256(canonicalScope(scope)),issueBody,
    archiveSha256:sha256(archive),archiveBytes:archive.byteLength,runId};
}
export function validatePilotInput(value:PilotInput,archive:Uint8Array,now:Date):void {
  requireControl(value&&value.scope&&value.scope.issue===76&&
    value.scope.repository===REPOSITORY&&
    JSON.stringify(value.scope.approvedPaths)===JSON.stringify(APPROVED_PATHS)&&
    value.scope.sourceSha===value.scope.baseSha&&
    value.scopeDigest===sha256(canonicalScope(value.scope))&&
    value.scope.acceptanceDigest===sha256(value.issueBody)&&
    now.getTime()<Date.parse(value.scope.expiresAt)&&
    Number.isSafeInteger(value.archiveBytes)&&value.archiveBytes===archive.byteLength&&
    value.archiveSha256===sha256(archive)&&/^run_[0-9]{1,16}$/.test(value.runId),
    'pilot-input-invalid');
}
async function main():Promise<void>{
  const e=process.env;
  requireControl(e.GITHUB_REPOSITORY===REPOSITORY&&
    e.GITHUB_ACTOR==='MightyMulligan-ops'&&e.GITHUB_ACTOR_ID==='353505747'&&
    e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='workflow_dispatch'&&
    e.GITHUB_RUN_ATTEMPT==='1'&&e.SOVEREIGN_ISSUE==='76'&&
    SHA.test(e.GITHUB_SHA??'')&&/^\d+$/.test(e.GITHUB_RUN_ID??'')&&
    typeof e.GITHUB_TOKEN==='string'&&e.GITHUB_TOKEN.length>0&&
    typeof e.RUNNER_TEMP==='string','pilot-preflight');
  const response=await fetch('https://api.github.com/repos/'+REPOSITORY+'/issues/76',{
    redirect:'error',headers:{Authorization:'Bearer '+e.GITHUB_TOKEN,
      Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
  requireControl(response.status===200,'pilot-issue-http-'+String(response.status));
  const issue=await response.json() as Record<string,unknown>;
  requireControl(issue.number===76&&issue.state==='open'&&
    typeof issue.body==='string'&&Buffer.byteLength(issue.body)<=32*1024,'pilot-issue');
  const out=join(e.RUNNER_TEMP!,'sovereign-pilot');
  const archive=new Uint8Array(await readFile(join(out,'source.tar.gz')));
  const value=makePilotInput(issue.body,e.GITHUB_SHA!,archive,'run_'+e.GITHUB_RUN_ID!,new Date());
  validatePilotInput(value,archive,new Date());
  await mkdir(out,{recursive:true});
  await writeFile(join(out,'pilot-input.json'),JSON.stringify(value));
  process.stdout.write('Sovereign pilot input frozen; no paid execution.\n');
}
if(process.argv[1]?.endsWith('codex-pilot-prepare.ts')){
  void main().catch((error:unknown)=>{\n    const reason=error instanceof ControlDenied ? error.message : 'unexpected-error';\n    process.stderr.write('Sovereign pilot prepare denied: '+reason+'\\n');\n    process.exitCode=1;\n  });
}
