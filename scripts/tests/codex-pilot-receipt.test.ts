import {expect,test} from 'vitest';
import {sha256} from '../codex-automation-policy.ts';
import {verifyValidationReceipt,REQUIRED_CHECKS,type ValidationBundle} from '../codex-pilot-receipt.ts';
import {validationFixture} from './codex-pilot-validation-fixture.ts';
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value));
test('fully successful host evidence verifies; a replay report alone never authorizes publication',()=>{
  const f=validationFixture();expect(verifyValidationReceipt(f.bytes,f.digest,f.context,f.bundle)).toEqual(f.receipt);
  expect(()=>verifyValidationReceipt(f.bundle.replay,sha256(f.bundle.replay),f.context,f.bundle)).toThrow();
});
test.each([undefined,'','not-a-digest','e'.repeat(64)])('missing/forged trusted digest %s denies publication',digest=>{
  const f=validationFixture();expect(()=>verifyValidationReceipt(f.bytes,digest,f.context,f.bundle)).toThrow('validation-receipt-authenticity');
});
test.each(REQUIRED_CHECKS)('missing, failed, skipped or duplicated %s check denies even a correctly hashed receipt',command=>{
  const f=validationFixture();
  for(const checks of [f.checks.filter(c=>c.command!==command),
    f.checks.map(c=>c.command===command?{...c,status:'failed',exitCode:1}:c),
    f.checks.map(c=>c.command===command?{...c,status:'skipped'}:c),
    [...f.checks,f.checks[0]]]){
    const bytes=encode({...f.receipt,checks});
    expect(()=>verifyValidationReceipt(bytes,sha256(bytes),f.context,f.bundle)).toThrow();
  }
});
test('receipt edits cannot authenticate themselves by providing a new digest alongside the artifact',()=>{
  const f=validationFixture(),forged=encode({...f.receipt,treeSha:'e'.repeat(40)});
  expect(()=>verifyValidationReceipt(forged,f.digest,f.context,f.bundle)).toThrow('validation-receipt-authenticity');
  expect(()=>verifyValidationReceipt(forged,sha256(forged),f.context,f.bundle)).toThrow('validation-receipt-context');
});
test.each(['scope','manifest','patch','summary','replay'] as const)('changed %s bytes prevent publication',key=>{
  const f=validationFixture();const bundle:ValidationBundle={...f.bundle,[key]:Buffer.concat([f.bundle[key],Buffer.from(' ')])};
  expect(()=>verifyValidationReceipt(f.bytes,f.digest,f.context,bundle)).toThrow();
});
test('old run/source, malformed/incomplete evidence and unknown policies cannot publish',()=>{
  const f=validationFixture();
  for(const replacement of [{runId:'999'},{sourceSha:'f'.repeat(40)},{runAttempt:2},{policy:'old'},
    {network:'default'},{pnpmVersion:'99.0.0'},{imageId:'unknown'},{checks:[]},{unexpected:true},{artifacts:{}}]){
    const bytes=encode({...f.receipt,...replacement});
    expect(()=>verifyValidationReceipt(bytes,sha256(bytes),f.context,f.bundle)).toThrow();
  }
  expect(()=>verifyValidationReceipt(f.bytes,f.digest,{...f.context,runId:'999'},f.bundle)).toThrow();
  const malformed=Buffer.from('not JSON');expect(()=>verifyValidationReceipt(malformed,sha256(malformed),f.context,f.bundle)).toThrow();
});
