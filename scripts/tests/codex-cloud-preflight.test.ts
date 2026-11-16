import {expect,test} from 'vitest';
import {checkCloudPreflight} from '../codex-cloud-preflight.ts';
const valid=():Record<string,string>=>({
  GITHUB_REPOSITORY:'MightyMulligan-ops/strategy-game',
  GITHUB_ACTOR:'MightyMulligan-ops', GITHUB_ACTOR_ID:'353505747',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
  GITHUB_REF_TYPE:'branch',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'43774606648',
  GITHUB_SHA:'a'.repeat(40),SOVEREIGN_CLOUD_MODE:'offline-preflight',SOVEREIGN_ISSUE:'76',
});
test('trusted main manual event permits credential-free offline preflight only',()=>{
  const x=checkCloudPreflight(valid());
  expect(x).toEqual({ok:true,reasons:[],issue:76,sourceSha:'a'.repeat(40)});
});
test('rejects different repo, actor, actor ID, branch, event, attempt and unsafe source',()=>{
  const variations=[
    ['GITHUB_REPOSITORY','other/repo'],['GITHUB_ACTOR','attacker'],
    ['GITHUB_ACTOR_ID','123'],['GITHUB_EVENT_NAME','pull_request_target'],
    ['GITHUB_EVENT_NAME','push'],['GITHUB_REF','refs/heads/feature'],
    ['GITHUB_REF_TYPE','tag'],['GITHUB_RUN_ATTEMPT','2'],['GITHUB_RUN_ID','0'],
    ['GITHUB_SHA','not-a-sha'],['SOVEREIGN_CLOUD_MODE','paid'],
    ['SOVEREIGN_ISSUE','79'],['SOVEREIGN_ISSUE','76;echo bad'],
  ];
  for (const [key,value] of variations) {
    const env=valid();env[key!]=value!;
    expect(checkCloudPreflight(env).ok,key).toBe(false);
  }
});
test('rejects missing and untrusted observations rather than silently defaulting',()=>{
  for (const key of Object.keys(valid())) {
    const env=valid();delete env[key];
    expect(checkCloudPreflight(env).ok,key).toBe(false);
  }
});
test('credential-bearing environment may not run this preflight or leaked job',()=>{
  for (const name of ['OPENAI_API_KEY','GITHUB_TOKEN','GH_TOKEN','VALIDATOR_SIGNING_KEY',
    'SECRET_TOKEN','SOVEREIGN_SECRET_PRIVATE','CODEX_SECRET_VALUE']) {
    const env=valid();env[name]='dummy-secret';
    expect(checkCloudPreflight(env).reasons).toContain(
      name.startsWith('SECRET_') || name.startsWith('SOVEREIGN_SECRET_') ||
      name.startsWith('CODEX_SECRET_') ? 'unexpected-secret' : 'credential-environment');
  }
  const empty=valid(); empty.OPENAI_API_KEY='';
  expect(checkCloudPreflight(empty).ok).toBe(false);
});
test('preflight is not evidence of grant, project billing or live readiness',()=>{
  const x=checkCloudPreflight(valid());
  expect(x.ok).toBe(true);
  expect('ownerGrantVerified' in x).toBe(false);
  expect('billingVerified' in x).toBe(false);
  expect('sessionCreated' in x).toBe(false);
});
