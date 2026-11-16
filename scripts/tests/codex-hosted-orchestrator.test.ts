import {expect,test} from 'vitest';
import {canonicalScope,REPOSITORY,sha256,type TaskScope} from '../codex-automation-policy.ts';
import {HostedAgentOrchestrator,type HostedPacket,type HostedProvider} from '../codex-hosted-orchestrator.ts';
import {HostedSessionJournal,type HostedJournal,type HostedJournalStore} from '../codex-hosted-journal.ts';
import {HOSTED_ARTIFACTS,type HostedAdmission} from '../codex-hosted-agents.ts';

const issueBody='Implement deterministic combat.';
const scope:TaskScope={repository:REPOSITORY,issue:76,sourceSha:'a'.repeat(40),baseSha:'a'.repeat(40),
  approvedPaths:['packages/game-engine/src/combat.ts'],acceptanceDigest:sha256(issueBody),expiresAt:'2026-12-15T00:00:00Z'};
const admission=():HostedAdmission=>({
  scope,issueBody,scopeDigest:sha256(canonicalScope(scope)),
  sourceArchiveFileId:'file_fixture',sourceArchiveSha256:'b'.repeat(64),sourceArchiveBytes:1234,
  sourceArchiveVerifiedFromGitTree:true,currentOwnerGrantVerified:true,
  durableRunClaimVerified:true,projectKeyBindingVerified:true,
  exclusiveProjectRoutingVerified:true,hostedSandboxPolicyReviewed:true,
  sessionTerminationVerified:true,
});
const session='sess_fixture',root='turn_fixture';
const patch=Buffer.from('diff --git a/packages/game-engine/src/combat.ts b/packages/game-engine/src/combat.ts\n');
const manifest=Buffer.from(JSON.stringify({format:'sovereign-codex-proposal-v1',source_sha:scope.sourceSha,
  scope_digest:sha256(canonicalScope(scope)),patch_sha256:sha256(patch),patch_bytes:patch.length,
  paths:[{path:scope.approvedPaths[0],sha256:'c'.repeat(64),bytes:20}]}));
const summary=Buffer.from('Implemented a proposal, pending independent validation.');
class MemoryStore implements HostedJournalStore {
  revision=0;value:HostedJournal|null=null;
  async read(){return {revision:String(this.revision),value:this.value?structuredClone(this.value):null};}
  async compareAndSwap(_id:string,revision:string,value:HostedJournal){
    if(revision!==String(this.revision)) return false;
    this.value=structuredClone(value);this.revision++;return true;
  }
}
class FixtureProvider implements HostedProvider {
  creates=0;deletes=0;failDelete=false;streamDisconnect=false;rootFails=false;extras=false;
  async *createSession():AsyncIterable<HostedPacket>{
    this.creates++;
    yield {sessionId:session,event:{type:'agent.session.idle'}};
    if(this.streamDisconnect) return;
    yield {sessionId:session,event:{type:this.rootFails?'agent.session.turn.failed':'agent.session.turn.completed',
      turn:{subagent_id:null}},rootTurnId:root};
  }
  async listArtifacts(){
    const items=HOSTED_ARTIFACTS.map((path,i)=>({path,id:'art_'+i,turn_id:root}));
    return {items:this.extras?[...items,{path:'/workspace/outputs/extra',id:'art_extra',turn_id:root}]:items,allPagesRead:true};
  }
  async downloadBounded(_sessionId:string,id:string,maxBytes:number){
    const bytes=[patch,manifest,summary][Number(id.slice(4))]!;
    if(bytes.length>maxBytes) throw Error('fixture cap');
    return bytes;
  }
  async deleteSession(){this.deletes++;if(this.failDelete) throw Error('unconfirmed deletion');}
}
const setup=()=>{
  const store=new MemoryStore(),provider=new FixtureProvider();
  return {store,provider,orchestrator:new HostedAgentOrchestrator(new HostedSessionJournal(store),provider)};
};
test('complete synthetic hosted lifecycle returns only untrusted bounded proposal',async()=>{
  const x=setup();
  const result=await x.orchestrator.run('run-76',admission());
  expect(result.sessionId).toBe(session);
  expect(result.rootTurnId).toBe(root);
  expect(result.patch).toEqual(patch);
  expect(x.store.value?.phase).toBe('completed');
  expect(x.provider.creates).toBe(1);
  expect(x.provider.deletes).toBe(1);
  await expect(x.orchestrator.run('run-76',admission())).rejects.toThrow('hosted-duplicate-run');
  expect(x.provider.creates).toBe(1);
});
test('missing trusted launch evidence prevents paid create',async()=>{
  const x=setup();
  await expect(x.orchestrator.run('run-76',{...admission(),projectKeyBindingVerified:false})).rejects.toThrow();
  expect(x.provider.creates).toBe(0);
  expect(x.store.value).toBeNull();
});
test('disconnected stream is ambiguous, never retried, and session cleanup attempted',async()=>{
  const x=setup();x.provider.streamDisconnect=true;
  await expect(x.orchestrator.run('run-76',admission())).rejects.toThrow('hosted-turn-not-completed');
  expect(x.store.value?.phase).toBe('ambiguous');
  expect(x.provider.creates).toBe(1);
  expect(x.provider.deletes).toBe(1);
  await expect(x.orchestrator.run('run-76',admission())).rejects.toThrow('hosted-duplicate-run');
});
test('root failure blocks artifacts and is terminal',async()=>{
  const x=setup();x.provider.rootFails=true;
  await expect(x.orchestrator.run('run-76',admission())).rejects.toThrow('hosted-root-failed');
  expect(x.store.value?.phase).toBe('failed');
  expect(x.provider.deletes).toBe(1);
});
test('extra artifacts are rejected after root completion',async()=>{
  const x=setup();x.provider.extras=true;
  await expect(x.orchestrator.run('run-76',admission())).rejects.toThrow('hosted-artifact-inventory');
  expect(x.store.value?.phase).toBe('completed');
  expect(x.provider.deletes).toBe(1);
});
test('uncertain provider termination blocks delivery',async()=>{
  const x=setup();x.provider.failDelete=true;
  await expect(x.orchestrator.run('run-76',admission())).rejects.toThrow('hosted-session-termination-unconfirmed');
  expect(x.provider.deletes).toBe(1);
});
