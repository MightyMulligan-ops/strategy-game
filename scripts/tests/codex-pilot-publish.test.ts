import {expect,test} from 'vitest';
import {canonicalScope,REPOSITORY,sha256,type TaskScope} from '../codex-automation-policy.ts';
import {verifyPilotReceipt,type PilotReceipt} from '../codex-pilot-publish.ts';
const patch=new Uint8Array([1,2,3]);
const scope:TaskScope={repository:REPOSITORY,issue:76,
  sourceSha:'a'.repeat(40),baseSha:'a'.repeat(40),
  approvedPaths:['packages/game-engine/src/combat.ts'],
  acceptanceDigest:'b'.repeat(64),expiresAt:'2026-12-15T00:00:00Z'};
const valid=():PilotReceipt=>({
  tree_sha:'c'.repeat(40),source_sha:scope.sourceSha,
  scope_digest:sha256(canonicalScope(scope)),patch_sha256:sha256(patch),
  paths:['packages/game-engine/src/combat.ts'],result:'RECONSTRUCTED_NO_EXECUTION',
});
test('publisher accepts only validator exact-tree digest and scope',()=>{
  expect(()=>verifyPilotReceipt(valid(),scope,patch)).not.toThrow();
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
  for(const r of bad)expect(()=>verifyPilotReceipt(r as PilotReceipt,scope,patch)).toThrow();
  expect(()=>verifyPilotReceipt(valid(),scope,new Uint8Array([9]))).toThrow();
});
