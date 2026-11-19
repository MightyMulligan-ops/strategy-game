/** Sovereign autonomous worker: pure, offline, default-deny policy.
 * All observations MUST come from a separately trusted, authenticated collector.
 * This module does not authenticate actors, authorize paid runs, or publish PRs.
 */
import { createHash } from 'node:crypto';

export const REPOSITORY = 'MightyMulligan-ops/strategy-game';
export const OWNER = 'MightyMulligan-ops';
export const OPERATIONAL_CUTOFF_USD = 45;
export const MONTHLY_PREFERENCE_USD = 50;
export const MAX_PATCH_BYTES = 1_500_000;
export const MAX_MANIFEST_BYTES = 32 * 1024;
export const MAX_SUMMARY_BYTES = 16 * 1024;
export const MAX_SOURCE_FILES = 25;
export const SHA = /^[a-f0-9]{40}$/;
export const DIGEST = /^[a-f0-9]{64}$/;
const pathPattern = /^(?:apps|packages)\/[a-zA-Z0-9_./-]+\.(?:ts|tsx)$/;
const forbidden = /(?:^|\/)(?:\.github|\.git|node_modules|\.env|prisma|migrations|secrets)(?:\/|$)|(?:^|\/)(?:AGENTS\.md|package\.json|pnpm-lock\.yaml)$/i;
export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export function validPath(path: string): boolean {
  return typeof path === 'string' && path.length < 200 && pathPattern.test(path) && !path.includes('//') &&
    !path.split('/').some(x => x === '..' || x === '.' || x.startsWith('.')) && !forbidden.test(path);
}
export const FEATURE_SCOPE_PROFILE = 'city-feature-v1' as const;
export const MAX_FEATURE_FILES = 128;
export function validScopePath(path:string,profile?:typeof FEATURE_SCOPE_PROFILE):boolean {
  if (profile === undefined) return validPath(path);
  if (profile !== FEATURE_SCOPE_PROFILE || typeof path !== 'string' || path.length >= 200 ||
      path.includes('\\') || path.includes('//') || path.split('/').some(p => p === '..' || p.startsWith('.') ||
      /^(?:node_modules|secrets|AGENTS\.md|package\.json)$/i.test(p))) return false;
  return /^(?:apps|packages)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|css|json)$/.test(path) ||
    /^database\/(?:src|tests)\/[A-Za-z0-9_./-]+\.ts$/.test(path) ||
    /^database\/prisma\/schema\.prisma$/.test(path) ||
    /^database\/prisma\/migrations\/[A-Za-z0-9_-]+\/migration\.sql$/.test(path) ||
    /^docs\/[A-Za-z0-9_-]+\.md$/.test(path);
}
export const scopeFileLimit=(s:TaskScope)=>s.profile===FEATURE_SCOPE_PROFILE?MAX_FEATURE_FILES:MAX_SOURCE_FILES;
export type TaskScope = Readonly<{
  repository: string; issue: number; sourceSha: string; baseSha: string;
  profile?: typeof FEATURE_SCOPE_PROFILE; approvedPaths: readonly string[]; acceptanceDigest: string; expiresAt: string;
}>;
export function canonicalScope(scope: TaskScope): string {
  if (scope.repository !== REPOSITORY || !Number.isSafeInteger(scope.issue) || scope.issue <= 0 ||
    !SHA.test(scope.sourceSha) || !SHA.test(scope.baseSha) || !DIGEST.test(scope.acceptanceDigest) ||
    !Number.isFinite(Date.parse(scope.expiresAt)) || !scope.approvedPaths.length ||
    scope.approvedPaths.length > scopeFileLimit(scope) ||
    new Set(scope.approvedPaths).size !== scope.approvedPaths.length ||
    (scope.profile !== undefined && scope.profile !== FEATURE_SCOPE_PROFILE) ||
    scope.approvedPaths.some(p => !validScopePath(p,scope.profile))) throw Error('Invalid frozen task scope');
  return JSON.stringify({ repository: scope.repository, issue: scope.issue,
    sourceSha: scope.sourceSha, baseSha: scope.baseSha,
    ...(scope.profile ? {profile:scope.profile}:{}), approvedPaths: [...scope.approvedPaths].sort(),
    acceptanceDigest: scope.acceptanceDigest, expiresAt: scope.expiresAt });
}
export type TrustedAdmission = Readonly<{
  actor: string; repository: string; ref: string; issue: number; runId: string;
  attempt: number; sourceSha: string; baseSha: string; now: string;
  authenticatedOwnerGrant: boolean; grantSource: string; grantDigest: string;
  grantRevoked: boolean; designatedRunId: string; competingClaim: boolean;
  billingEvidenceVerified: boolean; monthSpendUsd: number; estimatedRunMaxUsd: number;
  enforcedHardLimitVerified: boolean;
}>;
export type Admission = { allowed: false; reasons: string[] } | { allowed: true; scopeDigest: string };
export function evaluateAdmission(scope: TaskScope, evidence: TrustedAdmission): Admission {
  const reasons: string[] = [];
  let scopeDigest = '';
  try { scopeDigest = sha256(canonicalScope(scope)); } catch { reasons.push('invalid-scope'); }
  if (evidence.repository !== REPOSITORY || evidence.actor !== OWNER || evidence.ref !== 'refs/heads/main') reasons.push('wrong-actor-or-ref');
  if (evidence.issue !== scope.issue || evidence.sourceSha !== scope.sourceSha || evidence.baseSha !== scope.baseSha) reasons.push('source-or-issue-mismatch');
  if (!/^\d+$/.test(evidence.runId) || evidence.attempt !== 1 || evidence.runId !== evidence.designatedRunId) reasons.push('replay-or-unassigned-run');
  if (evidence.authenticatedOwnerGrant !== true || typeof evidence.grantSource !== 'string' || !evidence.grantSource || evidence.grantRevoked !== false ||
    !DIGEST.test(evidence.grantDigest) || evidence.grantDigest !== scopeDigest) reasons.push('missing-current-owner-grant');
  if (evidence.competingClaim !== false) reasons.push('competing-claim');
  const now = Date.parse(evidence.now);
  if (!Number.isFinite(now) || now >= Date.parse(scope.expiresAt)) reasons.push('expired-or-invalid-time');
  if (evidence.billingEvidenceVerified !== true || evidence.enforcedHardLimitVerified !== true ||
    !Number.isFinite(evidence.monthSpendUsd) || evidence.monthSpendUsd < 0 ||
    !Number.isFinite(evidence.estimatedRunMaxUsd) || evidence.estimatedRunMaxUsd <= 0 ||
    evidence.monthSpendUsd + evidence.estimatedRunMaxUsd >= OPERATIONAL_CUTOFF_USD) reasons.push('budget-unverified-or-insufficient');
  return reasons.length ? { allowed: false, reasons } : { allowed: true, scopeDigest };
}
export type ProposalManifest = Readonly<{
  format: string; source_sha: string; scope_digest: string; patch_sha256: string;
  patch_bytes: number; paths: readonly Readonly<{ path: string; sha256: string; bytes: number }>[];
}>;
export function validateProposal(scope: TaskScope, manifestText: string, patch: Uint8Array, summary: string): string[] {
  const errors: string[] = [];
  if (Buffer.byteLength(manifestText) > MAX_MANIFEST_BYTES || Buffer.byteLength(summary) > MAX_SUMMARY_BYTES ||
    patch.length > MAX_PATCH_BYTES || patch.length === 0) errors.push('artifact-size');
  let m: ProposalManifest;
  try { m = JSON.parse(manifestText); } catch { return [...errors, 'manifest-json']; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [...errors, 'manifest-json'];
  let scopeDigest: string;
  try { scopeDigest = sha256(canonicalScope(scope)); } catch { return [...errors, 'invalid-scope']; }
  if (m.format !== 'sovereign-codex-proposal-v1' || m.source_sha !== scope.sourceSha ||
    m.scope_digest !== scopeDigest || !DIGEST.test(m.patch_sha256) ||
    m.patch_sha256 !== sha256(patch) || m.patch_bytes !== patch.length) errors.push('artifact-identity');
  if (!Array.isArray(m.paths) || !m.paths.length || m.paths.length > scopeFileLimit(scope)) return [...errors, 'artifact-paths'];
  const approved = new Set(scope.approvedPaths);
  const seen = new Set<string>();
  for (const f of m.paths) {
    if (!f || typeof f.path !== 'string' || !validScopePath(f.path,scope.profile) || !approved.has(f.path) || seen.has(f.path) ||
      !DIGEST.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > MAX_PATCH_BYTES) errors.push('artifact-paths');
    else seen.add(f.path);
  }
  if (patch.includes(0) || /(?:GIT binary patch|Binary files |-----BEGIN .*PRIVATE KEY-----|sk-proj-|github_pat_)/i.test(Buffer.from(patch).toString('utf8')))
    errors.push('binary-or-secret-like-patch');
  if (/(?:-----BEGIN .*PRIVATE KEY-----|sk-proj-|github_pat_)/i.test(summary)) errors.push('secret-like-summary');
  // A metadata/byte check is NOT a Git tree reconstruction or exhaustive secret scan.
  return [...new Set(errors)];
}
export type TrustedPublication = Readonly<{
  scope: TaskScope; verifiedAdmission: boolean; verifiedCompletePatch: boolean;
  validatedInIsolatedEnvironment: boolean; verifiedLatestSource: boolean;
  currentApprovalP: boolean; currentApprovalD: boolean; independentValidator: boolean;
  existingDraftPrCount: number; newPrRequested: boolean;
}>;
export function publicationDecision(p: TrustedPublication): string[] {
  const failures: string[] = [];
  try { canonicalScope(p.scope); } catch { failures.push('scope'); }
  if (p.verifiedAdmission !== true || p.verifiedCompletePatch !== true || p.validatedInIsolatedEnvironment !== true ||
    p.verifiedLatestSource !== true || p.independentValidator !== true) failures.push('unverified-proposal');
  if (p.currentApprovalP !== true || p.currentApprovalD !== true) failures.push('missing-publication-or-ci-grant');
  if (!Number.isSafeInteger(p.existingDraftPrCount) || typeof p.newPrRequested !== 'boolean' || p.existingDraftPrCount > 1 || p.existingDraftPrCount < 0 ||
    (p.newPrRequested && p.existingDraftPrCount !== 0)) failures.push('duplicate-pr');
  return failures;
}

