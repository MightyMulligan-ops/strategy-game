import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
const workflow=readFileSync(new URL('../../.github/workflows/sovereign-hosted-pilot.yml',import.meta.url),'utf8');
test('clean replay precedes installation, which precedes applying the untrusted patch',()=>{
  const replay=workflow.indexOf('python3 scripts/codex-proposal-replay.py');
  const install=workflow.indexOf('run: pnpm install --frozen-lockfile');
  const apply=workflow.indexOf('git apply --check');
  expect(replay).toBeGreaterThan(0);expect(install).toBeGreaterThan(replay);expect(apply).toBeGreaterThan(install);
  const prepare=workflow.indexOf('run: pnpm prepare:checks');
  expect(prepare).toBeGreaterThan(install);expect(prepare).toBeLessThan(apply);
});
test('retains only sanitized diagnostics on failure without enabling proposal publication',()=>{
  const diagnosticStep=workflow.slice(workflow.indexOf('- name: Retain sanitized'),workflow.indexOf('name: sovereign-untrusted-proposal'));
  expect(diagnosticStep).toContain('always()');expect(diagnosticStep).toContain('diagnostics.jsonl');
  expect(diagnosticStep).toContain('session-state.json');expect(diagnosticStep).not.toMatch(/\.env|response\.json|raw/);
  expect(workflow).toContain('group: sovereign-hosted-pilot');expect(workflow).toContain('cancel-in-progress: false');
  const validation=workflow.split('\n  validate:')[1]!.split('\n  publish:')[0]!;
  expect(validation).not.toMatch(/OPENAI_API_KEY|secrets\.|contents: write|pull-requests: write/);
  expect(validation).toContain('scripts/codex-pilot-validator.ts');
  expect(validation).toContain('steps.checks.outputs.validation_sha256');
  expect(workflow).toContain("github.run_attempt == '1'");
});

test('publication requires trusted validator output; the pilot remains manual and no queue is activated',()=>{
  const publication=workflow.split('\n  publish:')[1]!;
  expect(publication).toContain("needs.validate.result == 'success'");
  expect(publication).toContain("needs.validate.outputs.validation_sha256 != ''");
  expect(publication).toContain('EXPECTED_VALIDATION_SHA256: ${{ needs.validate.outputs.validation_sha256 }}');
  expect(workflow).not.toContain('pnpm build &&');expect(workflow).not.toMatch(/continue-on-error|schedule:|workflow_run:/);
});

test('a skipped/missing receipt producer fails validation before proposal artifact transfer',()=>{
  const guard=workflow.indexOf('- name: Require host execution receipt');
  const upload=workflow.indexOf('name: sovereign-validated-proposal');
  expect(guard).toBeGreaterThan(workflow.indexOf('id: checks'));expect(guard).toBeLessThan(upload);
  const step=workflow.slice(guard,upload);
  expect(step).toContain('test -n "$VALIDATION_SHA256"');expect(step).toContain('test -f "$RECEIPT"');
  expect(step).toContain('sha256sum --check --status');expect(step).toContain('set -euo pipefail');
});
