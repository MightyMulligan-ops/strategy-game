/** Sovereign GitHub Actions entry gate: pure offline cloud preflight only.
 * Never read an API key, initialize a paid session, grant approval or publish code.
 * GitHub runner metadata is usable only in a trusted workflow from protected main.
 */
import { pathToFileURL } from 'node:url';

export const CLOUD_REPOSITORY = 'MightyMulligan-ops/strategy-game';
export const CLOUD_OWNER = 'MightyMulligan-ops';
export const CLOUD_OWNER_ID = '353505747';
export const CLOUD_MAIN_REF = 'refs/heads/main';
const SHA = /^[a-f0-9]{40}$/;
const DECIMAL = /^[1-9][0-9]{0,15}$/;
const FORBIDDEN_CREDENTIALS = [
  'OPENAI_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'GH_PAT',
  'OPENAI_ORG_KEY', 'CODEX_API_KEY', 'VALIDATOR_SIGNING_KEY',
] as const;
export type CloudPreflight = Readonly<{
  ok: boolean;
  reasons: readonly string[];
  issue: number | null;
  sourceSha: string | null;
}>;

/** Fail closed on absent or spoofed workflow identity. Inputs are observations only, not an owner grant. */
export function checkCloudPreflight(env: Readonly<Record<string,string|undefined>>): CloudPreflight {
  const reasons: string[]=[];
  if (env.GITHUB_REPOSITORY !== CLOUD_REPOSITORY) reasons.push('repository');
  if (env.GITHUB_ACTOR !== CLOUD_OWNER || env.GITHUB_ACTOR_ID !== CLOUD_OWNER_ID) reasons.push('actor');
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_REF !== CLOUD_MAIN_REF || env.GITHUB_REF_TYPE !== 'branch') reasons.push('event-ref');
  if (env.GITHUB_RUN_ATTEMPT !== '1' || !DECIMAL.test(env.GITHUB_RUN_ID ?? '')) reasons.push('run-identity');
  if (!SHA.test(env.GITHUB_SHA ?? '')) reasons.push('source-sha');
  if (env.SOVEREIGN_CLOUD_MODE !== 'offline-preflight') reasons.push('mode');
  // The first phase explicitly permits only a pilot scope. This is NOT approval to spend.
  if (!DECIMAL.test(env.SOVEREIGN_ISSUE ?? '') || env.SOVEREIGN_ISSUE !== '76') reasons.push('issue');
  // Secret-bearing jobs MUST remain physically separate. Prevent accidental test-key exposure.
  if (FORBIDDEN_CREDENTIALS.some(name=>Object.hasOwn(env,name))) reasons.push('credential-environment');
  // Generic sensitive environment fields also deny a diagnostic workflow that could be repurposed.
  if (Object.keys(env).some(name=> /^(?:SECRET_|SOVEREIGN_SECRET_|CODEX_SECRET_)/.test(name)))
    reasons.push('unexpected-secret');
  return {ok:reasons.length===0,reasons,issue:reasons.includes('issue')?null:76,
    sourceSha:SHA.test(env.GITHUB_SHA ?? '')?env.GITHUB_SHA!:null};
}

/** The CLI never prints environment variables, input payloads, tokens or exception stacks. */
async function main(): Promise<void> {
  const result=checkCloudPreflight(process.env);
  if (!result.ok) {
    process.stderr.write('Sovereign cloud preflight denied: '+result.reasons.join(',')+'\n');
    process.exitCode=1;
    return;
  }
  process.stdout.write('Sovereign offline cloud preflight accepted; paid execution and publication remain disabled.\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(()=>{process.stderr.write('Sovereign cloud preflight unavailable.\n');process.exitCode=1;});
}
