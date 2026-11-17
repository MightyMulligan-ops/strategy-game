/** One explicit non-paid administrative operation; never imported by queue intake. */
import { appendFileSync } from 'node:fs';
import { createHash, createPublicKey } from 'node:crypto';
import { GitHubHttpsTransport, type GitHubTransport } from './codex-github-control.ts';
import { REPOSITORY, OWNER, SHA } from './codex-automation-policy.ts';
import { requireControl } from './codex-run-control.ts';
import { enrolledKey, get, obj } from './overnight-production.ts';
import { canonical, OWNER_ID, parseManifest } from './overnight-policy.ts';
import { ledgerAppTransport } from './overnight-ledger-auth.ts';
import { emptyLedger, GitHubQueueStore } from './overnight-ledger.ts';

async function disabledEnrollment(api: GitHubTransport, env: NodeJS.ProcessEnv) {
  const { config, key } = await enrolledKey(api, env);
  const publicKey = createPublicKey(key.publicKeyPem as string);
  const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  requireControl(publicKey.asymmetricKeyType === 'ed25519' && fingerprint === env.SOVEREIGN_OWNER_KEY_SHA256 &&
    Object.keys(config).sort().join(',') === 'enabled,enrollment,manifest,signature,version' &&
    config.enabled === false && config.signature === null, 'bootstrap-disabled-enrollment');
  requireControl(parseManifest(Buffer.from(JSON.stringify(config.manifest))).enabled === false, 'bootstrap-empty-manifest');
}

export async function bootstrapLedger(env: NodeJS.ProcessEnv, api: GitHubTransport,
  app: () => Promise<GitHubTransport> = () => ledgerAppTransport(env)): Promise<string> {
  requireControl(env.OPENAI_API_KEY === undefined && env.GITHUB_REPOSITORY === REPOSITORY &&
    env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_ACTOR === OWNER && env.GITHUB_ACTOR_ID === String(OWNER_ID) &&
    env.GITHUB_RUN_ATTEMPT === '1' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.BOOTSTRAP_CONFIRMATION === 'BOOTSTRAP_EMPTY_LEDGER' && SHA.test(env.GITHUB_SHA ?? '') &&
    /^\d{1,20}$/.test(env.GITHUB_RUN_ID ?? '') &&
    [env.SOVEREIGN_OVERNIGHT_ENABLED, env.SOVEREIGN_OVERNIGHT_SCHEDULE_ENABLED].every(v => v === undefined || v === '' || v === 'false'),
    'bootstrap-identity');
  const main = await get(api, '/git/ref/heads/main');
  requireControl(main.ref === 'refs/heads/main' && obj(main.object).sha === env.GITHUB_SHA, 'bootstrap-main-drift');
  const permission = await get(api, `/collaborators/${OWNER}/permission`), user = obj(permission.user);
  requireControl(permission.permission === 'admin' && user.id === OWNER_ID && user.login === OWNER && user.type === 'User', 'bootstrap-owner');
  await disabledEnrollment(api, env);
  // Only the dedicated App can write. The generic Actions token is read-only.
  const store = new GitHubQueueStore(await app());
  await store.bootstrap(); // Existing implementation refuses existing/inaccessible state; no retry/reset.
  const result = await store.read();
  requireControl(canonical(result.ledger) === canonical(emptyLedger()), 'bootstrap-ledger-not-empty');
  await disabledEnrollment(api, env); // A post-create failure is uncertain, never permission to reset/retry.
  return `Empty ledger verified at ${result.revision}. Source ${env.GITHUB_SHA}; run ${env.GITHUB_RUN_ID}, attempt 1. Paid queue remains DISABLED.\n`;
}

if (process.argv[1]?.endsWith('overnight-bootstrap.ts')) {
  try {
    const summary = await bootstrapLedger(process.env, new GitHubHttpsTransport(process.env.GITHUB_TOKEN ?? ''));
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch {
    process.stderr.write('Ledger bootstrap denied or outcome uncertain. Inspect the protected ref; never reset history or retry automatically.\n');
    process.exitCode = 1;
  }
}
