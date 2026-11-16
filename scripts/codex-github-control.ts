/** Privileged control-plane adapter. Never import or execute worker output here. */
import { randomUUID } from 'node:crypto';
import { canonicalScope, sha256, OWNER, REPOSITORY, SHA, type TaskScope } from './codex-automation-policy.ts';
import { ControlDenied, requireControl, validateLedger, type LedgerStore, type RunLedger,
  type Snapshot, type AdmissionCollector, type LaunchEvidence } from './codex-run-control.ts';

const ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const LEDGER_REF = 'sovereign-control-ledger-v1';
const LEDGER_PATH = '.sovereign/control-ledger.json';
const OWNER_ID = 353505747;
export type GitHubReply = { status: number; data: unknown };
export interface GitHubTransport {
  request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<GitHubReply>;
}
/** Fixed-origin HTTPS; bounded replies; redirects, retries and raw error/log output disabled. */
export class GitHubHttpsTransport implements GitHubTransport {
  constructor(private readonly token: string) { requireControl(typeof token === 'string' && token.length > 0, 'github-credential-missing'); }
  async request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<GitHubReply> {
    requireControl(path.startsWith('/') && !path.includes('..') && !/[\r\n#]/.test(path), 'github-path');
    const reply = await fetch(ROOT+path,{method,redirect:'error',signal:AbortSignal.timeout(20_000),
      headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
        'Content-Type':'application/json','User-Agent':'sovereign-trusted-control-v1'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})}).catch(() => {throw new ControlDenied('github-transport');});
    const chunks: Uint8Array[] = []; let size = 0;
    requireControl(reply.body, 'github-response-body');
    const reader = reply.body.getReader();
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > 2_000_000) { await reader.cancel(); throw new ControlDenied('github-response-size'); }
        chunks.push(next.value);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      let data: unknown; try { data = JSON.parse(text); } catch { throw new ControlDenied('github-response-json'); }
      return {status:reply.status,data};
    } finally { reader.releaseLock(); }
  }
}
function record(value: unknown): Record<string,unknown> {
  requireControl(value && typeof value === 'object' && !Array.isArray(value), 'github-response-shape');
  return value as Record<string,unknown>;
}
async function get(api: GitHubTransport,path: string): Promise<Record<string,unknown>> {
  const r = await api.request('GET',path); requireControl(r.status === 200, 'github-read-denied'); return record(r.data);
}
function gitSha(value: unknown): string { requireControl(typeof value === 'string' && SHA.test(value), 'github-object-sha'); return value; }
async function createObject(api: GitHubTransport,path: string,body: unknown): Promise<string> {
  const r = await api.request('POST',path,body); requireControl(r.status === 201,'github-object-create'); return gitSha(record(r.data).sha);
}

/** A separate Git ref is the durable CAS register; no worker receives its token.
 * Non-fast-forward PATCH rejects races. Uncertain writes are NOT retried as inference.
 * The ledger branch is never merged and is not a PR head or application checkout.
 */
export class GitHubLedgerStore implements LedgerStore {
  constructor(private readonly api: GitHubTransport) {}
  async read(): Promise<Snapshot> {
    const ref = await get(this.api,`/git/ref/heads/${LEDGER_REF}`);
    requireControl(ref.ref === `refs/heads/${LEDGER_REF}`, 'ledger-ref');
    const revision = gitSha(record(ref.object).sha);
    const file = await get(this.api,`/contents/${LEDGER_PATH}?ref=${revision}`);
    requireControl(file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string' &&
      typeof file.size === 'number' && file.size > 0 && file.size <= 65_536 && file.content.length <= 90_000, 'ledger-file');
    const bytes = Buffer.from(file.content,'base64');
    requireControl(bytes.length === file.size, 'ledger-file-size');
    let ledger: RunLedger; try { ledger = JSON.parse(bytes.toString('utf8')); } catch { throw new ControlDenied('ledger-json'); }
    validateLedger(ledger); return {revision,ledger};
  }
  private async commit(ledger: RunLedger,parents: string[]): Promise<string> {
    validateLedger(ledger); const content = JSON.stringify(ledger);
    requireControl(Buffer.byteLength(content) <= 65_536, 'ledger-file-size');
    const tree = await createObject(this.api,'/git/trees',{tree:[{path:LEDGER_PATH,mode:'100644',type:'blob',content}]});
    return createObject(this.api,'/git/commits',{message:`Sovereign control ledger v1 ${randomUUID()}`,tree,parents});
  }
  async compareAndSwap(revision: string,ledger: RunLedger): Promise<boolean> {
    gitSha(revision); const commit = await this.commit(ledger,[revision]);
    const r = await this.api.request('PATCH',`/git/refs/heads/${LEDGER_REF}`,{sha:commit,force:false});
    if (r.status === 409 || r.status === 422) return false;
    requireControl(r.status === 200 && record(record(r.data).object).sha === commit,'ledger-write-unconfirmed');
    return true;
  }
  /** Explicit trusted-operator bootstrap only. Never infer an initial balance from absent state. */
  async bootstrap(ledger: RunLedger): Promise<void> {
    const check = await this.api.request('GET',`/git/ref/heads/${LEDGER_REF}`);
    requireControl(check.status === 404,'ledger-already-exists-or-inaccessible');
    const commit = await this.commit(ledger,[]);
    const r = await this.api.request('POST','/git/refs',{ref:`refs/heads/${LEDGER_REF}`,sha:commit});
    requireControl(r.status === 201 && record(r.data).ref === `refs/heads/${LEDGER_REF}`,'ledger-bootstrap-unconfirmed');
  }
}

export type RuntimeProof = {
  project: string; exclusiveProjectRouting: boolean; keyProjectBindingVerified: boolean;
  isolatedWorkerVerified: boolean; immutableToolchainVerified: boolean; runtimeObservedAt: string;
};
/** Verifier belongs to the trusted runtime; worker requests cannot supply this callback's output. */
export interface RuntimeVerifier { verify(): Promise<RuntimeProof> }
export type OwnerGrant = { repository: string; issue: number; scopeDigest: string; runId: string; project: string; maxMicroUsd: number;
  operations: readonly string[] };
export function grantText(grant: OwnerGrant): string { return `SOVEREIGN-CODEX-GRANT-V1\n${JSON.stringify(grant)}`; }
export class GitHubAdmissionCollector implements AdmissionCollector {
  constructor(private readonly api: GitHubTransport,private readonly scope: TaskScope,private readonly grantCommentId: number,
    private readonly expectedGrant: OwnerGrant,private readonly runtime: RuntimeVerifier,private readonly now: () => Date = () => new Date()) {
    requireControl(Number.isSafeInteger(grantCommentId) && grantCommentId > 0, 'grant-comment-id');
    requireControl(expectedGrant.repository === REPOSITORY && expectedGrant.issue === scope.issue &&
      expectedGrant.scopeDigest === sha256(canonicalScope(scope)) && /^[a-zA-Z0-9_-]{1,80}$/.test(expectedGrant.runId) &&
      /^proj_[A-Za-z0-9]+$/.test(expectedGrant.project) && Number.isSafeInteger(expectedGrant.maxMicroUsd) &&
      expectedGrant.maxMicroUsd > 0 && expectedGrant.maxMicroUsd < 45_000_000 &&
      JSON.stringify(expectedGrant.operations) === JSON.stringify(['implement','test','paid','publish-draft','existing-ci']), 'grant-identity');
  }
  async check(): Promise<LaunchEvidence> {
    // Fetch current authoritative data every time; no labels, runner flags or cached grant admission.
    const [issue,comment,permission,source] = await Promise.all([
      get(this.api,`/issues/${this.scope.issue}`),get(this.api,`/issues/comments/${this.grantCommentId}`),
      get(this.api,`/collaborators/${OWNER}/permission`),get(this.api,'/git/ref/heads/main'),
    ]);
    requireControl(issue.number === this.scope.issue && issue.state === 'open' && !('pull_request' in issue) &&
      typeof issue.body === 'string' && sha256(issue.body) === this.scope.acceptanceDigest,'issue-changed-or-closed');
    const actor = record(comment.user);
    requireControl(actor.login === OWNER && actor.id === OWNER_ID && actor.type === 'User' &&
      permission.permission === 'admin' && record(permission.user).id === OWNER_ID,'grant-author-not-owner');
    requireControl(comment.id === this.grantCommentId && comment.issue_url === `${ROOT}/issues/${this.scope.issue}` &&
      comment.body === grantText(this.expectedGrant) && typeof comment.created_at === 'string' &&
      comment.created_at === comment.updated_at && !comment.minimized,'grant-revoked-edited-or-mismatched');
    requireControl(source.ref === 'refs/heads/main' && record(source.object).sha === this.scope.sourceSha &&
      this.scope.baseSha === this.scope.sourceSha,'source-drift');
    const now = this.now(); const grantCreated = Date.parse(comment.created_at as string);
    requireControl(Number.isFinite(now.getTime()) && Number.isFinite(grantCreated) && grantCreated <= now.getTime() &&
      now.getTime() < Date.parse(this.scope.expiresAt),'grant-time');
    const proof = await this.runtime.verify();
    return {...proof,grantDigest:this.expectedGrant.scopeDigest,runId:this.expectedGrant.runId,now:now.toISOString(),runMaxMicroUsd:this.expectedGrant.maxMicroUsd};
  }
}
