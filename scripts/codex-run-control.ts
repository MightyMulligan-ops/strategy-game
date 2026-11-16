/** Trusted controller only. Never mount this state or credentials in a worker.
 * No inference is performed by this module. All money is integer micro-USD.
 */
import { canonicalScope, sha256, type TaskScope } from './codex-automation-policy.ts';

export const MONTHLY_CUTOFF_MICRO_USD = 45_000_000;
const MAX_RECORDS = 256;
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const monthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const isMoney = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
export class ControlDenied extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function requireControl(ok: unknown, code: string): asserts ok {
  if (!ok) throw new ControlDenied(code);
}
export type Reservation = { id: string; maxMicroUsd: number; state: 'reserved' | 'settled' };
export type RunRecord = {
  id: string; issue: number; scopeDigest: string; month: string;
  maxMicroUsd: number; state: 'claimed' | 'finished' | 'stopped'; requests: Reservation[];
  publication?: { receiptDigest: string; state: 'claimed' | 'published' };
};
export type MonthRecord = { month: string; baselineMicroUsd: number; safetyMarginMicroUsd: number };
export type RunLedger = { version: 1; project: string; months: MonthRecord[]; runs: RunRecord[] };
export type Snapshot = { revision: string; ledger: RunLedger };
/** CAS must be durable and linearizable. A memory adapter is for tests only. */
export interface LedgerStore {
  read(): Promise<Snapshot>;
  compareAndSwap(revision: string, ledger: RunLedger): Promise<boolean>;
}
export function validateLedger(ledger: RunLedger): void {
  requireControl(ledger && ledger.version === 1 && /^proj_[A-Za-z0-9]+$/.test(ledger.project), 'ledger-identity');
  requireControl(Array.isArray(ledger.months) && ledger.months.length > 0 && ledger.months.length <= 24 &&
    Array.isArray(ledger.runs) && ledger.runs.length <= MAX_RECORDS, 'ledger-size');
  const months = new Set<string>();
  for (const m of ledger.months) {
    requireControl(m && monthPattern.test(m.month) && !months.has(m.month) && isMoney(m.baselineMicroUsd) &&
      isMoney(m.safetyMarginMicroUsd) && m.safetyMarginMicroUsd > 0, 'ledger-month');
    months.add(m.month);
  }
  const ids = new Set<string>(); const scopes = new Set<string>();
  for (const r of ledger.runs) {
    requireControl(r && idPattern.test(r.id) && !ids.has(r.id) && /^[a-f0-9]{64}$/.test(r.scopeDigest) &&
      !scopes.has(r.scopeDigest) && Number.isSafeInteger(r.issue) && r.issue > 0 && months.has(r.month) &&
      isMoney(r.maxMicroUsd) && r.maxMicroUsd > 0 && ['claimed','finished','stopped'].includes(r.state) &&
      Array.isArray(r.requests) && r.requests.length <= MAX_RECORDS, 'ledger-run');
    ids.add(r.id); scopes.add(r.scopeDigest);
    if (r.publication !== undefined) requireControl(r.state === 'finished' &&
      /^[a-f0-9]{64}$/.test(r.publication.receiptDigest) && ['claimed','published'].includes(r.publication.state), 'ledger-publication');
    const requests = new Set<string>(); let spent = 0;
    for (const q of r.requests) {
      requireControl(q && idPattern.test(q.id) && !requests.has(q.id) && isMoney(q.maxMicroUsd) &&
        q.maxMicroUsd > 0 && ['reserved','settled'].includes(q.state), 'ledger-request');
      requests.add(q.id); spent += q.maxMicroUsd;
      requireControl(Number.isSafeInteger(spent) && spent <= r.maxMicroUsd, 'ledger-run-budget');
    }
  }
  for (const m of ledger.months) {
    const reserved = ledger.runs.filter(r => r.month === m.month).reduce((sum,r) => sum+r.maxMicroUsd,0);
    requireControl(Number.isSafeInteger(reserved) && m.baselineMicroUsd + m.safetyMarginMicroUsd + reserved < MONTHLY_CUTOFF_MICRO_USD,
      'ledger-month-budget');
  }
  requireControl(ledger.runs.filter(r => r.state === 'claimed').length <= 1, 'ledger-multiple-active-runs');
}

export class RunController {
  constructor(private readonly store: LedgerStore, readonly project: string) {}
  private async change(update: (ledger: RunLedger) => void): Promise<void> {
    // Metadata CAS conflicts may retry. Inference is never inside this loop.
    for (let tries = 0; tries < 4; tries++) {
      const {revision,ledger:original} = await this.store.read(); validateLedger(original);
      requireControl(original.project === this.project, 'ledger-wrong-project');
      const ledger = structuredClone(original); update(ledger); validateLedger(ledger);
      if (await this.store.compareAndSwap(revision,ledger)) return;
    }
    throw new ControlDenied('ledger-contention');
  }
  async claim(scope: TaskScope, runId: string, month: string, maxMicroUsd: number): Promise<void> {
    const scopeDigest = sha256(canonicalScope(scope));
    requireControl(idPattern.test(runId) && monthPattern.test(month) && isMoney(maxMicroUsd) && maxMicroUsd > 0, 'claim-input');
    await this.change(ledger => {
      requireControl(ledger.months.some(m => m.month === month), 'uninitialized-month');
      requireControl(!ledger.runs.some(r => r.state === 'claimed'), 'active-run');
      requireControl(!ledger.runs.some(r => r.id === runId || r.scopeDigest === scopeDigest), 'duplicate-run');
      requireControl(ledger.runs.length < MAX_RECORDS, 'ledger-full');
      ledger.runs.push({id:runId,issue:scope.issue,scopeDigest,month,maxMicroUsd,state:'claimed',requests:[]});
    });
  }
  async reserve(runId: string, requestId: string, month: string, maxMicroUsd: number,scopeDigest: string,runMaxMicroUsd: number): Promise<void> {
    requireControl(idPattern.test(requestId) && isMoney(maxMicroUsd) && maxMicroUsd > 0, 'reservation-input');
    await this.change(ledger => {
      const run = ledger.runs.find(r => r.id === runId);
      requireControl(run && run.state === 'claimed' && run.month === month && run.scopeDigest === scopeDigest && run.maxMicroUsd === runMaxMicroUsd, 'run-inactive-or-month-changed');
      requireControl(run.requests.length < MAX_RECORDS && !run.requests.some(q => q.id === requestId), 'duplicate-or-excess-request');
      // Reserve BEFORE inference; missing/error/cancelled responses never refund.
      run.requests.push({id:requestId,maxMicroUsd,state:'reserved'});
    });
  }
  async settled(runId: string, requestId: string): Promise<void> {
    await this.change(ledger => {
      const run = ledger.runs.find(r => r.id === runId);
      const request = run?.requests.find(q => q.id === requestId);
      requireControl(run?.state === 'claimed' && request?.state === 'reserved', 'request-not-reserved');
      request.state = 'settled'; // Deliberately retain the full worst-case reservation.
    });
  }
  async stop(runId: string, state: 'finished' | 'stopped'): Promise<void> {
    requireControl(state === 'finished' || state === 'stopped', 'stop-state');
    await this.change(ledger => {
      const run = ledger.runs.find(r => r.id === runId);
      requireControl(run?.state === 'claimed', 'run-not-active'); run.state = state;
    });
  }
  async claimPublication(runId: string,receiptDigest: string,scopeDigest: string): Promise<void> {
    requireControl(/^[a-f0-9]{64}$/.test(receiptDigest),'publication-receipt');
    await this.change(ledger => {
      const run = ledger.runs.find(r => r.id === runId);
      requireControl(run?.state === 'finished' && run.scopeDigest === scopeDigest && run.publication === undefined,'publication-already-claimed-or-run-not-finished');
      run.publication = {receiptDigest,state:'claimed'};
    });
  }
  async published(runId: string,receiptDigest: string): Promise<void> {
    await this.change(ledger => {
      const run = ledger.runs.find(r => r.id === runId);
      requireControl(run?.publication?.state === 'claimed' && run.publication.receiptDigest === receiptDigest,'publication-claim');
      run.publication.state = 'published';
    });
  }
}

export type PriceCard = {
  model: string; verifiedAt: string; expiresAt: string;
  inputMicroUsdPerMillion: number; outputMicroUsdPerMillion: number;
  maxInputTokens: number; maxOutputTokens: number;
};
export type LaunchEvidence = {
  project: string; exclusiveProjectRouting: boolean; keyProjectBindingVerified: boolean;
  isolatedWorkerVerified: boolean; immutableToolchainVerified: boolean;
  grantDigest: string; runId: string; now: string; runtimeObservedAt: string; runMaxMicroUsd: number;
};
/** Implemented by the trusted HTTPS collector, never from worker JSON. */
export interface AdmissionCollector { check(): Promise<LaunchEvidence> }
export interface ResponsesTransport {
  countInputTokens(body: Record<string,unknown>): Promise<number>;
  // Buffer/stream adaptation belongs to the transport. It must not retry inference.
  infer(body: Record<string,unknown>): Promise<unknown>;
}
function textOnly(value: unknown, depth = 0): void {
  requireControl(depth <= 24, 'request-depth');
  if (Array.isArray(value)) { requireControl(value.length <= 4096, 'request-array'); for (const v of value) textOnly(v,depth+1); }
  else if (value && typeof value === 'object') {
    const record = value as Record<string,unknown>;
    requireControl(Object.keys(record).length <= 64, 'request-object');
    if ('type' in record) requireControl(typeof record.type === 'string' &&
      !/(?:image|audio|video|file|web_search|computer|code_interpreter|mcp|search|shell|apply_patch)/i.test(record.type), 'unsupported-billable-input-or-tool');
    for (const v of Object.values(record)) textOnly(v,depth+1);
  } else requireControl(value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)), 'request-value');
}
function localTool(value: unknown,depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 4) return false;
  const tool = value as Record<string,unknown>;
  if (tool.type === 'function' || tool.type === 'custom') return true;
  return tool.type === 'namespace' && Array.isArray(tool.tools) && tool.tools.length > 0 &&
    tool.tools.length <= 64 && tool.tools.every(t => localTool(t,depth+1));
}
export function boundedRequest(raw: string, card: PriceCard): Record<string,unknown> {
  requireControl(Buffer.byteLength(raw) <= 2_000_000, 'request-size');
  let body: Record<string,unknown>;
  try { body = JSON.parse(raw); } catch { throw new ControlDenied('request-json'); }
  requireControl(body && typeof body === 'object' && !Array.isArray(body), 'request-object');
  const allowed = new Set(['model','input','instructions','tools','tool_choice','parallel_tool_calls','reasoning','text','include','stream','store','max_output_tokens','service_tier']);
  requireControl(Object.keys(body).every(k => allowed.has(k)) && body.model === card.model && 'input' in body, 'request-fields-or-model');
  textOnly(body);
  if ('tools' in body) {
    requireControl(Array.isArray(body.tools) && body.tools.length <= 64 && body.tools.every(t => localTool(t)), 'hosted-or-unsupported-tool');
  }
  // Pin paid service tier, output bound, and server-side retention. No provider-side continuation IDs.
  body.service_tier = 'default'; body.max_output_tokens = card.maxOutputTokens; body.store = false;
  return body;
}
export function reserveCost(inputTokens: number, card: PriceCard): number {
  requireControl(Number.isSafeInteger(inputTokens) && inputTokens > 0 && inputTokens <= card.maxInputTokens, 'input-token-bound');
  const total = BigInt(inputTokens)*BigInt(card.inputMicroUsdPerMillion) + BigInt(card.maxOutputTokens)*BigInt(card.outputMicroUsdPerMillion);
  const result = Number((total+999_999n)/1_000_000n);
  requireControl(isMoney(result) && result > 0, 'price-overflow'); return result;
}
export class BoundedResponsesGate {
  private sequence = 0;
  constructor(private readonly scope: TaskScope, private readonly runId: string, private readonly project: string,
    private readonly card: PriceCard, private readonly ledger: RunController,
    private readonly collector: AdmissionCollector, private readonly transport: ResponsesTransport) {}
  private async admit(): Promise<LaunchEvidence> {
    const e = await this.collector.check();
    requireControl(e && e.project === this.project && e.runId === this.runId && e.grantDigest === sha256(canonicalScope(this.scope)) &&
      e.exclusiveProjectRouting === true && e.keyProjectBindingVerified === true && e.isolatedWorkerVerified === true &&
      e.immutableToolchainVerified === true && isMoney(e.runMaxMicroUsd) && e.runMaxMicroUsd > 0 &&
      e.runMaxMicroUsd < MONTHLY_CUTOFF_MICRO_USD, 'unverified-launch-boundary');
    const now = Date.parse(e.now); const verified = Date.parse(this.card.verifiedAt);
    const observed = Date.parse(e.runtimeObservedAt);
    requireControl(Number.isFinite(observed) && observed <= now && now-observed <= 30_000, 'stale-runtime-proof');
    requireControl(Number.isFinite(now) && Number.isFinite(verified) && verified <= now && now < Date.parse(this.card.expiresAt) &&
      now < Date.parse(this.scope.expiresAt) && Date.parse(this.card.expiresAt)-verified <= 86_400_000, 'expired-grant-or-price');
    for (const x of [this.card.inputMicroUsdPerMillion,this.card.outputMicroUsdPerMillion,this.card.maxInputTokens,this.card.maxOutputTokens])
      requireControl(Number.isSafeInteger(x) && x > 0 && x <= 1_000_000_000, 'invalid-price-card');
    requireControl(this.card.maxOutputTokens <= 32_768, 'output-token-bound');
    return e;
  }
  async request(raw: string): Promise<unknown> {
    await this.admit(); const body = boundedRequest(raw,this.card);
    const inputTokens = await this.transport.countInputTokens(body);
    const e = await this.admit(); // Recheck revocation/source/time after the network count.
    const requestId = `req-${++this.sequence}`;
    await this.ledger.reserve(this.runId,requestId,e.now.slice(0,7),reserveCost(inputTokens,this.card),sha256(canonicalScope(this.scope)),e.runMaxMicroUsd);
    await this.admit(); // A failed recheck retains the reservation and performs no inference.
    // Exactly one invocation. Any ambiguous transport outcome remains fully reserved.
    const result = await this.transport.infer(body);
    await this.ledger.settled(this.runId,requestId); return result;
  }
}
