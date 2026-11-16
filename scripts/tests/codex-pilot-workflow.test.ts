import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
const workflow=readFileSync(new URL('../../.github/workflows/sovereign-hosted-pilot.yml',import.meta.url),'utf8');
test('clean replay precedes installation, which precedes applying the untrusted patch',()=>{
  const replay=workflow.indexOf('python3 scripts/codex-proposal-replay.py');
  const install=workflow.indexOf('run: pnpm install --frozen-lockfile');
  const apply=workflow.indexOf('git apply --check');
  expect(replay).toBeGreaterThan(0);expect(install).toBeGreaterThan(replay);expect(apply).toBeGreaterThan(install);
});
test('retains only sanitized diagnostics on failure without enabling proposal publication',()=>{
  const diagnosticStep=workflow.slice(workflow.indexOf('- name: Retain sanitized'),workflow.indexOf('name: sovereign-untrusted-proposal'));
  expect(diagnosticStep).toContain('always()');expect(diagnosticStep).toContain('diagnostics.jsonl');
  expect(diagnosticStep).toContain('session-state.json');expect(diagnosticStep).not.toMatch(/\.env|response\.json|raw/);
  expect(workflow).toContain('group: sovereign-hosted-pilot');expect(workflow).toContain('cancel-in-progress: false');
  const validation=workflow.split('\n  validate:')[1]!.split('\n  publish:')[0]!;
  expect(validation).not.toMatch(/OPENAI_API_KEY|secrets\.|contents: write|pull-requests: write/);
  expect(validation).toContain('--network none');expect(validation).toContain('--cap-drop ALL');
  expect(validation).toContain('EXPECTED_TREE');expect(workflow).toContain("github.run_attempt == '1'");
});
