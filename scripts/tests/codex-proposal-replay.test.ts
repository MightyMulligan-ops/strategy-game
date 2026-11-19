import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
it('reconstructs or rejects synthetic Git patches using credential-free Python validator', () => {
  const run = spawnSync('python3', ['scripts/tests/codex-proposal-replay.test.py', '-v'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? '/tmp' },
  });
  expect(run.error?.message).toBeUndefined();
  expect(run.status, run.stderr || run.stdout).toBe(0);
  expect(run.stderr).toMatch(/Ran 24 tests/);
  expect(run.stderr).toMatch(/OK/);
}, 35000);

