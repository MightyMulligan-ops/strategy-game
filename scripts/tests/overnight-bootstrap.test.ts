import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { bootstrapLedger } from '../overnight-bootstrap.ts';
import { ledgerAppTransport } from '../overnight-ledger-auth.ts';
import { CONFIG_REF } from '../overnight-production.ts';
import { emptyLedger, GitHubQueueStore, QUEUE_REF } from '../overnight-ledger.ts';
import { OWNER_ID } from '../overnight-policy.ts';
import { REPOSITORY } from '../codex-automation-policy.ts';
import type { GitHubTransport } from '../codex-github-control.ts';

const ownerKey = generateKeyPairSync('ed25519'), appKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fingerprint = createHash('sha256').update(ownerKey.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const env: NodeJS.ProcessEnv = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40),
    GITHUB_ACTOR: 'MightyMulligan-ops', GITHUB_ACTOR_ID: String(OWNER_ID), GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', BOOTSTRAP_CONFIRMATION: 'BOOTSTRAP_EMPTY_LEDGER',
    SOVEREIGN_OWNER_KEY_SHA256: fingerprint, SOVEREIGN_LEDGER_APP_ID: '123', SOVEREIGN_LEDGER_INSTALLATION_ID: '456',
    SOVEREIGN_LEDGER_APP_PRIVATE_KEY: appKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const config = { version: 1, enabled: false, signature: null as string | null,
    enrollment: { fingerprint, publicKeyPem: ownerKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false },
    manifest: { version: 1, repository: REPOSITORY, enabled: false, tasks: [] as unknown[] } };
  const calls: { method: string; path: string; body?: unknown; credential: string }[] = [];
  let ref: string | null = null, tree = '', content = '', created = 0, readStatus = 200;
  const read: GitHubTransport = { async request(method, path, body) {
    calls.push({ method, path, body, credential: 'generic-read' });
    if (method !== 'GET') return { status: 403, data: {} };
    if (path === '/git/ref/heads/main') return { status: 200, data: { ref: 'refs/heads/main', object: { sha: 'a'.repeat(40) } } };
    if (path.includes('/permission')) return { status: 200, data: { permission: 'admin', user: { id: OWNER_ID, login: env.GITHUB_ACTOR, type: 'User' } } };
    if (path === `/git/ref/heads/${CONFIG_REF}`) return { status: 200, data: { ref: `refs/heads/${CONFIG_REF}`, object: { sha: 'b'.repeat(40) } } };
    if (path.startsWith('/contents/.sovereign/queue.json?ref=')) {
      expect(path.endsWith('b'.repeat(40))).toBe(true);
      const bytes = Buffer.from(JSON.stringify(config));
      return { status: 200, data: { type: 'file', encoding: 'base64', size: bytes.length, content: bytes.toString('base64') } };
    }
    return { status: 404, data: {} };
  } };
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url).replace('https://api.github.com', ''), method = init?.method ?? 'GET';
    const credential = (init?.headers as Record<string, string>).Authorization!;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, credential });
    if (path === `/repos/${REPOSITORY}/installation` || path === '/app/installations/456/access_tokens') {
      const parts = credential.slice(7).split('.');
      expect(verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), appKey.publicKey, Buffer.from(parts[2]!, 'base64url'))).toBe(true);
      if (method === 'GET') return Response.json({ id: 456, app_id: 123, account: { id: OWNER_ID } });
      expect(body).toEqual({ repository_ids: [1451525917], permissions: { contents: 'write' } });
      return Response.json({ token: 'synthetic-app-token', repositories: [{ id: 1451525917 }], permissions: { contents: 'write', metadata: 'read' },
        expires_at: new Date(Date.now() + 1800000).toISOString() }, { status: 201 });
    }
    expect(credential).toBe('Bearer synthetic-app-token');
    const prefix = `/repos/${REPOSITORY}`;
    if (path === `${prefix}/git/ref/heads/${QUEUE_REF}`) return Response.json(ref ? { ref: `refs/heads/${QUEUE_REF}`, object: { sha: ref } } : {}, { status: ref ? readStatus : 404 });
    if (path === `${prefix}/git/trees`) { content = body.tree[0].content; expect(body.tree[0].path).toBe('.sovereign/overnight-ledger.json'); tree = 'c'.repeat(40); return Response.json({ sha: tree }, { status: 201 }); }
    if (path === `${prefix}/git/commits`) { expect(body.tree).toBe(tree); expect(body.parents).toEqual([]); return Response.json({ sha: 'd'.repeat(40) }, { status: 201 }); }
    if (path === `${prefix}/git/refs`) { expect(body).toEqual({ ref: `refs/heads/${QUEUE_REF}`, sha: 'd'.repeat(40) }); created++; ref = body.sha; return Response.json({ ref: body.ref, object: { sha: ref } }, { status: 201 }); }
    if (path === `${prefix}/contents/.sovereign/overnight-ledger.json?ref=${ref}`) return Response.json({ type: 'file', encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') });
    throw Error('unexpected request');
  };
  // Token minting and the returned GitHubHttpsTransport must both be offline.
  vi.stubGlobal('fetch', fetcher);
  const app = vi.fn(() => ledgerAppTransport(env, fetcher));
  return { env, config, calls, read, app, created: () => created, content: () => JSON.parse(content),
    existing: () => { ref = 'e'.repeat(40); }, inaccessible: () => { ref = 'e'.repeat(40); readStatus = 403; } };
}

test('explicit bootstrap signs an App JWT, creates and rereads the exact empty ledger, and leaves config disabled', async () => {
  const f = fixture(), before = structuredClone(f.config), summary = await bootstrapLedger(f.env, f.read, f.app);
  expect(f.created()).toBe(1); expect(f.content()).toEqual(emptyLedger()); expect(f.config).toEqual(before);
  expect(f.calls.filter(c => c.credential === 'generic-read').every(c => c.method === 'GET')).toBe(true);
  expect(f.calls.filter(c => c.method !== 'GET').every(c => c.credential !== 'generic-read')).toBe(true);
  expect(summary).toContain('Paid queue remains DISABLED'); expect(summary).toContain('d'.repeat(40));
  expect(summary).not.toMatch(/PRIVATE KEY|synthetic-app-token|publicKeyPem/);
  expect(f.calls.some(c => /openai|sessions|pulls|dispatches/.test(c.path))).toBe(false);
});

test.each([
  ['GITHUB_REPOSITORY', 'other/repo'], ['GITHUB_REF', 'refs/heads/feature'], ['GITHUB_ACTOR', 'other'],
  ['GITHUB_ACTOR_ID', '1'], ['GITHUB_RUN_ATTEMPT', '2'], ['GITHUB_EVENT_NAME', 'schedule'],
  ['BOOTSTRAP_CONFIRMATION', 'yes'], ['GITHUB_SHA', 'bad'], ['GITHUB_RUN_ID', 'bad'],
  ['OPENAI_API_KEY', 'synthetic-forbidden'], ['SOVEREIGN_OVERNIGHT_ENABLED', 'true'],
  ['SOVEREIGN_OVERNIGHT_SCHEDULE_ENABLED', 'true']
])('bootstrap rejects %s drift before any network or App access', async (key, value) => {
  const f = fixture(); f.env[key!] = value;
  await expect(bootstrapLedger(f.env, f.read, f.app)).rejects.toThrow('bootstrap-identity');
  expect(f.calls).toEqual([]); expect(f.app).not.toHaveBeenCalled();
});

test.each(['pin', 'self-enrolled-key', 'revoked', 'enabled', 'signature', 'tasks', 'manifest', 'extra-config'])('bootstrap rejects %s before minting App access', async kind => {
  const f = fixture();
  if (kind === 'pin') f.env.SOVEREIGN_OWNER_KEY_SHA256 = '0'.repeat(64);
  if (kind === 'self-enrolled-key') f.config.enrollment.publicKeyPem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  if (kind === 'revoked') f.config.enrollment.revoked = true;
  if (kind === 'enabled') f.config.enabled = true;
  if (kind === 'signature') f.config.signature = 'not-authority';
  if (kind === 'tasks') f.config.manifest.tasks.push({ issue: 94 });
  if (kind === 'manifest') f.config.manifest.enabled = true;
  if (kind === 'extra-config') Object.assign(f.config, { approval: true });
  await expect(bootstrapLedger(f.env, f.read, f.app)).rejects.toThrow();
  expect(f.app).not.toHaveBeenCalled(); expect(f.created()).toBe(0);
});

test.each(['main', 'permission', 'owner-id'])('bootstrap rejects %s evidence drift', async kind => {
  const f = fixture(); const api: GitHubTransport = { async request(method, path, body) {
    const r = await f.read.request(method, path, body);
    if (kind === 'main' && path.endsWith('/main')) return { status: 200, data: { ref: 'refs/heads/main', object: { sha: '0'.repeat(40) } } };
    if (path.includes('/permission')) return { status: 200, data: { permission: kind === 'permission' ? 'write' : 'admin', user: { id: 1, login: 'MightyMulligan-ops', type: 'User' } } };
    return r;
  } };
  await expect(bootstrapLedger(f.env, api, f.app)).rejects.toThrow(); expect(f.app).not.toHaveBeenCalled();
});

test.each(['existing', 'inaccessible'])('bootstrap refuses %s ledger without creating or resetting anything', async kind => {
  const f = fixture(); if (kind === 'existing') f.existing(); else f.inaccessible();
  await expect(bootstrapLedger(f.env, f.read, f.app)).rejects.toThrow();
  expect(f.created()).toBe(0); expect(f.calls.some(c => c.path.endsWith('/git/trees'))).toBe(false);
});

test('a second bootstrap refuses the existing ledger; generic read transport cannot create one', async () => {
  const f = fixture(); await bootstrapLedger(f.env, f.read, f.app);
  await expect(bootstrapLedger(f.env, f.read, f.app)).rejects.toThrow(); expect(f.created()).toBe(1);
  await expect(new GitHubQueueStore(f.read).bootstrap()).rejects.toThrow(); expect(f.created()).toBe(1);
});

test('config revocation after creation reports failure without resetting the created ledger', async () => {
  const f = fixture(); const app = async () => { const api = await f.app(); return { async request(...args: Parameters<GitHubTransport['request']>) {
    const r = await api.request(...args); if (args[1] === '/git/refs') f.config.enabled = true; return r;
  } }; };
  await expect(bootstrapLedger(f.env, f.read, app)).rejects.toThrow(); expect(f.created()).toBe(1);
});

test.each(['unavailable', 'corrupt', 'nonempty-shape'])('mandatory persisted readback rejects %s without a creation retry', async kind => {
  const f = fixture(); const app = async (): Promise<GitHubTransport> => {
    const api = await f.app(); return { async request(...args) {
      const reply = await api.request(...args);
      if (!args[1].startsWith('/contents/.sovereign/overnight-ledger.json?ref=')) return reply;
      if (kind === 'unavailable') return { status: 403, data: {} };
      const bytes = Buffer.from(JSON.stringify(kind === 'corrupt' ? { version: 999 } : { ...emptyLedger(), reconciliations: [] }));
      return { status: 200, data: { type: 'file', encoding: 'base64', size: bytes.length, content: bytes.toString('base64') } };
    } };
  };
  await expect(bootstrapLedger(f.env, f.read, app)).rejects.toThrow();
  expect(f.created()).toBe(1); expect(f.app).toHaveBeenCalledTimes(1);
});

test('bootstrap workflow has only manual intake, read-only generic permissions and no paid secret or provider action', () => {
  const yaml = readFileSync(new URL('../../.github/workflows/sovereign-ledger-bootstrap.yml', import.meta.url), 'utf8');
  expect(yaml).toContain('workflow_dispatch:'); expect(yaml).not.toMatch(/schedule:|pull_request:|workflow_call:|contents: write|OPENAI_API_KEY|codex-action/);
  expect(yaml).toContain("github.run_attempt == '1'"); expect(yaml).toContain("github.actor_id == '353505747'");
  expect(yaml).toContain('environment: sovereign-queue-control'); expect(yaml).toContain('persist-credentials: false');
  expect(yaml).toContain('BOOTSTRAP_CONFIRMATION: ${{ inputs.confirmation }}');
  expect(yaml).toContain('run: node --experimental-transform-types scripts/overnight-bootstrap.ts');
});
