import {test,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('hosted source packager passes isolated Git archive security fixtures',()=>{
  const script=fileURLToPath(new URL('./codex-hosted-packager.test.py',import.meta.url));
  const output=execFileSync('python3',[script],{encoding:'utf8',timeout:30_000,stdio:['ignore','pipe','pipe']});
  expect(output).toBe('');
});
