import {expect,test} from 'vitest';
import {makePilotInput,validatePilotInput} from '../codex-pilot-prepare.ts';
const archive=new Uint8Array([3,5,7]);
const sha='a'.repeat(40);
const now=new Date('2026-11-15T21:00:00Z');
test('freezes issue body, exact source, approved combat paths and archive hash',()=>{
  const input=makePilotInput('combat 1A',sha,archive,'run_123',now);
  expect(input.scope.approvedPaths).toEqual([
    'packages/game-engine/src/combat.ts','packages/game-engine/tests/combat.test.ts'
  ]);
  expect(input.scope.expiresAt).toBe('2026-11-15T22:00:00.000Z');
  expect(()=>validatePilotInput(input,archive,now)).not.toThrow();
});
test('rejects source archive, approval scope, body or run drift',()=>{
  const input=makePilotInput('combat 1A',sha,archive,'run_123',now);
  const corruptions=[
    {...input,archiveBytes:2},
    {...input,issueBody:'new task'},
    {...input,scope:{...input.scope,approvedPaths:['.github/workflows/ci.yml']}},
    {...input,scope:{...input.scope,sourceSha:'b'.repeat(40)}},
    {...input,scopeDigest:'b'.repeat(64)},
    {...input,runId:'../../bad'},
  ];
  for(const changed of corruptions)
    expect(()=>validatePilotInput(changed,archive,now)).toThrow();
  expect(()=>validatePilotInput(input,new Uint8Array([1]),now)).toThrow();
  expect(()=>validatePilotInput(input,archive,new Date('2026-11-15T23:00:00Z'))).toThrow();
});
test('rejects invalid archive and source before any provider calls',()=>{
  expect(()=>makePilotInput('body','bad',archive,'run_1',now)).toThrow();
  expect(()=>makePilotInput('',sha,archive,'run_1',now)).toThrow();
  expect(()=>makePilotInput('body',sha,new Uint8Array(),'run_1',now)).toThrow();
  expect(()=>makePilotInput('body',sha,archive,'run_bad',now)).toThrow();
});
