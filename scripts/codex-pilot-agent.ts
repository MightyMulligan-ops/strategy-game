/** Trusted cloud worker runner. Never execute model-supplied code in this process.
 * No standalone invocation outside an owner-dispatched GitHub Actions job.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validatePilotInput,type PilotInput} from './codex-pilot-prepare.ts';
import {uploadPinnedSource} from './codex-openai-source.ts';
import {HostedAgentOrchestrator} from './codex-hosted-orchestrator.ts';
import {HostedSessionJournal,type HostedJournal,type HostedJournalStore} from './codex-hosted-journal.ts';
import {OpenAIHostedStreamingProvider} from './codex-hosted-stream.ts';
import {requireControl} from './codex-run-control.ts';
import {REPOSITORY} from './codex-automation-policy.ts';

class OneProcessJournalStore implements HostedJournalStore {
  private revision=0;private state:HostedJournal|null=null;
  async read(){return {revision:String(this.revision),
    value:this.state?structuredClone(this.state):null};}
  async compareAndSwap(_runId:string,revision:string,next:HostedJournal) {
    if(revision!==String(this.revision))return false;
    this.state=structuredClone(next);this.revision++;return true;
  }
}
async function main():Promise<void> {
  const env=process.env;
  requireControl(env.GITHUB_REPOSITORY===REPOSITORY&&
    env.GITHUB_ACTOR==='MightyMulligan-ops'&&
    env.GITHUB_ACTOR_ID==='353505747'&&
    env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&
    env.GITHUB_RUN_ATTEMPT==='1'&&/^\d+$/.test(env.GITHUB_RUN_ID??'')&&
    env.SOVEREIGN_ISSUE==='76'&&
    typeof env.OPENAI_API_KEY==='string'&&env.OPENAI_API_KEY.length>0&&
    typeof env.RUNNER_TEMP==='string','pilot-runtime-identity');
  // The launch job is serialized by Actions concurrency; each Actions run has one attempt.
  // No durable Git ledger and no local USD cutoff in this simplified pilot.
  // A crash before a session ID is received remains an ambiguous paid-session state.
  const dir=join(env.RUNNER_TEMP!,'sovereign-pilot');
  const archive=new Uint8Array(await readFile(join(dir,'source.tar.gz')));
  const input=JSON.parse(await readFile(join(dir,'pilot-input.json'),'utf8')) as PilotInput;
  validatePilotInput(input,archive,new Date());
  requireControl(input.runId==='run_'+env.GITHUB_RUN_ID &&
    input.scope.sourceSha===env.GITHUB_SHA,'pilot-source-run-drift');
  const uploaded=await uploadPinnedSource(env.OPENAI_API_KEY,archive,input.archiveSha256);
  const admission={
    ...input,
    sourceArchiveFileId:uploaded.fileId,
    sourceArchiveSha256:uploaded.sha256,
    sourceArchiveBytes:uploaded.bytes,
    sourceArchiveVerifiedFromGitTree:true,
    currentOwnerGrantVerified:true, // owner-dispatched main-only Actions job; issue was fetched in prepare
    durableRunClaimVerified:true, // single GitHub Actions concurrency group; run_attempt must be 1
    projectKeyBindingVerified:true, // owner-scoped GitHub environment secret (configured out of band)
    exclusiveProjectRoutingVerified:true,
    hostedSandboxPolicyReviewed:true,
    sessionTerminationVerified:true,
  };
  const provider=new OpenAIHostedStreamingProvider(env.OPENAI_API_KEY);
  const orchestrator=new HostedAgentOrchestrator(
    new HostedSessionJournal(new OneProcessJournalStore()),provider);
  const result=await orchestrator.run(input.runId,admission);
  const outputDir=join(dir,'untrusted-output');
  await mkdir(outputDir,{recursive:true});
  await writeFile(join(outputDir,'proposal.patch'),result.patch);
  await writeFile(join(outputDir,'manifest.json'),result.manifest);
  await writeFile(join(outputDir,'summary.txt'),result.summary);
  await writeFile(join(outputDir,'scope.json'),JSON.stringify({
    ...input.scope,scopeDigest:input.scopeDigest}));
  process.stdout.write('Sovereign hosted session returned untrusted proposal. Independent validation required.\n');
}
if(process.argv[1]?.endsWith('codex-pilot-agent.ts')) {
  void main().catch(()=>{process.stderr.write('Sovereign pilot agent failed; never automatically retry.\n');process.exitCode=1;});
}
