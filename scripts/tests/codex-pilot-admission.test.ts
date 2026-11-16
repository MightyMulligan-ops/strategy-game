import {expect,test} from 'vitest';
import {canonicalScope,sha256,REPOSITORY,type TaskScope} from '../codex-automation-policy.ts';
import {assessPilotAdmission,requirePilotAdmission,PILOT_MAX_WALL_SECONDS} from '../codex-pilot-admission.ts';

const scope:TaskScope={repository:REPOSITORY,issue:76,sourceSha:'a'.repeat(40),
  baseSha:'a'.repeat(40),approvedPaths:['packages/game-engine/src/combat.ts'],
  acceptanceDigest:'b'.repeat(64),expiresAt:'2026-12-01T00:00:00Z'};
const valid=()=>({
  actor:'MightyMulligan-ops',actorId:353505747,repository:REPOSITORY,
  event:'workflow_dispatch',ref:'refs/heads/main',runAttempt:1,issue:76,
  sourceSha:scope.sourceSha,baseSha:scope.baseSha,now:'2026-11-15T21:15:00Z',
  signedOwnerGrantVerified:true,grantRevoked:false,
  frozenScopeDigest:sha256(canonicalScope(scope)),exclusiveRunClaimVerified:true,
  verifiedProjectKeyIsolation:true,hostedNetworkDisabled:true,
  sessionTerminationAvailable:true,activeJobs:0,requestedWallSeconds:300,
});
test('allows a single isolated owner-authorized bounded pilot without USD accounting',()=>{
  expect(assessPilotAdmission(scope,valid()).approved).toBe(true);
  expect(requirePilotAdmission(scope,valid())).toBe(sha256(canonicalScope(scope)));
  expect('monthSpendUsd' in valid()).toBe(false);
  expect('cutoff' in valid()).toBe(false);
});
test('rejects untrusted owner, branch, replay and changed issue/source',()=>{
  const cases=[['actor','bad'],['actorId',1],['repository','fork/repo'],
    ['event','pull_request_target'],['ref','refs/heads/feature'],
    ['runAttempt',2],['issue',79],['sourceSha','c'.repeat(40)],
    ['baseSha','c'.repeat(40)]] as const;
  for(const [key,value] of cases){
    expect(assessPilotAdmission(scope,{...valid(),[key]:value}).approved,key).toBe(false);
  }
});
test('rejects absent authorizations, revocation, active run and unsafe isolation',()=>{
  for(const key of ['signedOwnerGrantVerified','exclusiveRunClaimVerified',
    'verifiedProjectKeyIsolation','hostedNetworkDisabled',
    'sessionTerminationAvailable'] as const){
    expect(assessPilotAdmission(scope,{...valid(),[key]:false}).approved,key).toBe(false);
  }
  expect(assessPilotAdmission(scope,{...valid(),grantRevoked:true}).approved).toBe(false);
  expect(assessPilotAdmission(scope,{...valid(),activeJobs:1}).approved).toBe(false);
  expect(assessPilotAdmission(scope,{...valid(),frozenScopeDigest:'f'.repeat(64)}).approved).toBe(false);
});
test('enforces wall time and frozen scope expiry',()=>{
  expect(PILOT_MAX_WALL_SECONDS).toBe(900);
  for(const seconds of [0,-1,901,1.5,Infinity]){
    expect(assessPilotAdmission(scope,{...valid(),requestedWallSeconds:seconds}).approved).toBe(false);
  }
  expect(assessPilotAdmission(scope,{...valid(),now:'2026-12-02T00:00:00Z'}).approved).toBe(false);
});
