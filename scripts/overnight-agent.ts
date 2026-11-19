/** Agent job only: provider key + GitHub READ capability, never publication token.
 * Generated code executes only in the provider sandbox, not this controller. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {GitHubHttpsTransport,type GitHubTransport} from './codex-github-control.ts';
import {productionContext} from './overnight-production.ts';
import {taskScope} from './overnight-policy.ts';
import {canonicalScope,sha256} from './codex-automation-policy.ts';
import {verifyModelAccess} from './overnight-cost.ts';
import {requireControl} from './codex-run-control.ts';
import {uploadPinnedSource} from './codex-openai-source.ts';
import {HostedAgentOrchestrator} from './codex-hosted-orchestrator.ts';
import {HostedSessionJournal} from './codex-hosted-journal.ts';
import {OneProcessJournalStore} from './codex-pilot-agent.ts';
import {QueueSessionProvider,initialProviderState} from './overnight-provider.ts';
import type {PilotFetcher} from './codex-pilot-diagnostics.ts';
export async function runQueueAgent(env:NodeJS.ProcessEnv,api:GitHubTransport,fetcher:PilotFetcher=fetch,now:()=>Date=()=>new Date()){
  requireControl(env.GITHUB_JOB==='agent'&&typeof env.OPENAI_API_KEY==='string'&&env.OPENAI_API_KEY.length>0&&
    typeof env.RUNNER_TEMP==='string'&&typeof env.GITHUB_OUTPUT==='string','queue-agent-environment');
  const c=await productionContext(api,env,now());requireControl(c.record.phase==='agent_running'&&c.record.sessions===1,'queue-agent-not-reserved');
  const dir=join(env.RUNNER_TEMP,'sovereign-pilot');mkdirSync(dir,{recursive:true});
  const statePath=join(dir,'provider-state.json');requireControl(!existsSync(statePath),'queue-agent-local-replay');
  const save=(state:unknown)=>writeFileSync(statePath,JSON.stringify(state),{mode:0o600});save(initialProviderState());
  try{
    if(c.manifest.execution)await verifyModelAccess(env.OPENAI_API_KEY,fetcher);
    const archive=new Uint8Array(readFileSync(join(dir,'source.tar.gz')));
    requireControl(archive.length>0&&archive.length<=50*1024*1024&&sha256(archive)===env.EXPECTED_ARCHIVE_SHA256,'queue-archive-binding');
    const uploaded=await uploadPinnedSource(env.OPENAI_API_KEY,archive,env.EXPECTED_ARCHIVE_SHA256!,fetcher);
    const seconds=Math.min(c.task.codingSeconds,(Date.parse(c.manifest.endsAt)-now().getTime())/1000)-120;
    requireControl(seconds>0,'queue-cleanup-window-insufficient');
    const scope=taskScope(c.manifest,c.task),digest=sha256(canonicalScope(scope));
    const provider=new QueueSessionProvider(env.OPENAI_API_KEY,seconds,async()=>{
      const fresh=await productionContext(api,env,now());requireControl(fresh.record.phase==='agent_running'&&fresh.record.sessions===1&&fresh.task.approvalDigest===c.task.approvalDigest,'queue-before-create-claim');
    },save,fetcher,Date.parse(c.manifest.endsAt)-120000,!!c.manifest.execution);
    const journal=new HostedSessionJournal(new OneProcessJournalStore(join(dir,'session-state.json')));
    const result=await new HostedAgentOrchestrator(journal,provider).run(`run_${c.runId}_${c.index}`,{
      scope,scopeDigest:digest,issueBody:c.task.scopeText,sourceArchiveFileId:uploaded.fileId,sourceArchiveSha256:uploaded.sha256,sourceArchiveBytes:uploaded.bytes,
      sourceArchiveVerifiedFromGitTree:true,currentOwnerGrantVerified:true,durableRunClaimVerified:true,
      // Owner-provisioned environment credential binding is a documented manual
      // activation prerequisite, not a billing/cost guarantee inferred by code.
      projectKeyBindingVerified:true,exclusiveProjectRoutingVerified:true,hostedSandboxPolicyReviewed:true,sessionTerminationVerified:true,
    });
    requireControl(provider.state.coding==='completed'&&provider.state.termination==='deleted_confirmed','queue-provider-not-terminal');
    const output=join(dir,'untrusted-output');mkdirSync(output,{recursive:true});
    writeFileSync(join(output,'proposal.patch'),result.patch);writeFileSync(join(output,'manifest.json'),result.manifest);
    writeFileSync(join(output,'summary.txt'),result.summary);writeFileSync(join(output,'scope.json'),JSON.stringify({...scope,scopeDigest:digest}));
  }finally{
    const bytes=readFileSync(statePath);
    const {appendFileSync}=await import('node:fs');appendFileSync(env.GITHUB_OUTPUT,`agent_state_sha256=${sha256(bytes)}\n`);
  }
}
if(process.argv[1]?.endsWith('overnight-agent.ts')){
  void runQueueAgent(process.env,new GitHubHttpsTransport(process.env.GITHUB_TOKEN??'')).catch(()=>{
    process.stderr.write('Queue agent failed or uncertain. Durable reservation retained; no retry.\n');process.exitCode=1;
  });
}
