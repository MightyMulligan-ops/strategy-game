import {canonicalScope,sha256,REPOSITORY,type TaskScope} from '../codex-automation-policy.ts';
import {REQUIRED_CHECKS,makeValidationReceipt,type ValidationBundle} from '../codex-pilot-receipt.ts';
export const fixtureImage='sha256:'+'c'.repeat(64);
export function validationFixture(sourceSha='a'.repeat(40),tree='b'.repeat(40),patch=Buffer.from('diff --git a/packages/game-engine/src/combat.ts b/packages/game-engine/src/combat.ts\n'),content='export const combat = 2;\n'){
  const scope:TaskScope={repository:REPOSITORY,issue:76,sourceSha,baseSha:sourceSha,
    approvedPaths:['packages/game-engine/src/combat.ts'],acceptanceDigest:'d'.repeat(64),expiresAt:'2027-01-01T00:00:00Z'};
  const digest=sha256(canonicalScope(scope));
  const bundle:ValidationBundle={scope:Buffer.from(JSON.stringify({...scope,scopeDigest:digest})),patch,
    manifest:Buffer.from(JSON.stringify({format:'sovereign-codex-proposal-v1',source_sha:sourceSha,scope_digest:digest,
      patch_sha256:sha256(patch),patch_bytes:patch.length,paths:[{path:scope.approvedPaths[0],bytes:Buffer.byteLength(content),sha256:sha256(content)}]})),
    summary:Buffer.from('Synthetic independently checked proposal.'),
    replay:Buffer.from(JSON.stringify({tree_sha:tree,source_sha:sourceSha,scope_digest:digest,patch_sha256:sha256(patch),
      paths:scope.approvedPaths,result:'RECONSTRUCTED_NO_EXECUTION'}))};
  const context={runId:'123',sourceSha};
  const checks=REQUIRED_CHECKS.map(command=>({command,status:'passed' as const,exitCode:0 as const}));
  const receipt=makeValidationReceipt(bundle,context,fixtureImage,checks);
  const bytes=Buffer.from(JSON.stringify(receipt)+'\n');
  return {scope,bundle,context,checks,receipt,bytes,digest:sha256(bytes)};
}
