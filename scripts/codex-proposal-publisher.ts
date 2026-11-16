/** Separate trusted publisher: verifies a signed isolated-validator receipt, then
 * uses Git object APIs only. It never checks out, imports, installs or runs code.
 */
import { createPublicKey, verify } from 'node:crypto';
import { canonicalScope, sha256, validPath, SHA, MAX_PATCH_BYTES, MAX_SOURCE_FILES, type TaskScope } from './codex-automation-policy.ts';
import { ControlDenied, requireControl, type AdmissionCollector, type RunController } from './codex-run-control.ts';
import type { GitHubTransport } from './codex-github-control.ts';

export type ValidationReceipt = {
  version: 1; sourceSha: string; sourceTreeSha: string; treeSha: string; scopeDigest: string; runId: string;
  testedAt: string; expiresAt: string;
  checks: readonly ['build','typecheck','lint','db-free-tests'];
  files: {path: string; sha256: string; bytes: number}[];
};
export type ProposalFile = {path: string; content: Uint8Array};
export function verifyReceipt(text: string,signature: string,publicKeyPem: string,scope: TaskScope,runId: string,
  files: readonly ProposalFile[],now: Date): ValidationReceipt {
  requireControl(Buffer.byteLength(text) <= 32_768 && signature.length <= 128,'receipt-size');
  const key = createPublicKey(publicKeyPem);
  requireControl(key.asymmetricKeyType === 'ed25519' && /^[A-Za-z0-9+/]{86}==$/.test(signature) &&
    verify(null,Buffer.from(text),key,Buffer.from(signature,'base64')),'receipt-signature');
  let receipt: ValidationReceipt; try {receipt = JSON.parse(text);} catch {throw new ControlDenied('receipt-json');}
  requireControl(receipt && receipt.version === 1 && receipt.sourceSha === scope.sourceSha && SHA.test(receipt.sourceTreeSha) &&
    SHA.test(receipt.treeSha) && receipt.scopeDigest === sha256(canonicalScope(scope)) && receipt.runId === runId &&
    JSON.stringify(receipt.checks) === JSON.stringify(['build','typecheck','lint','db-free-tests']),'receipt-identity-or-checks');
  const tested = Date.parse(receipt.testedAt); const expires = Date.parse(receipt.expiresAt);
  requireControl(Number.isFinite(now.getTime()) && Number.isFinite(tested) && tested <= now.getTime() &&
    Number.isFinite(expires) && now.getTime() < expires && expires - tested <= 3_600_000 &&
    now.getTime() < Date.parse(scope.expiresAt),'receipt-time');
  requireControl(Array.isArray(receipt.files) && receipt.files.length > 0 && receipt.files.length <= MAX_SOURCE_FILES &&
    files.length === receipt.files.length,'receipt-files');
  const seen = new Set<string>(); let total = 0;
  for (const f of receipt.files) {
    requireControl(f && typeof f.path === 'string' && validPath(f.path) && scope.approvedPaths.includes(f.path) &&
      !seen.has(f.path) && /^[a-f0-9]{64}$/.test(f.sha256) && Number.isSafeInteger(f.bytes) && f.bytes >= 0,'receipt-path');
    seen.add(f.path); const matches = files.filter(file => file.path === f.path); const matched = matches[0];
    requireControl(matches.length === 1 && matched && matched.content.byteLength === f.bytes && sha256(matched.content) === f.sha256,'receipt-file-digest');
    const bytes = matched.content; total += bytes.byteLength;
    requireControl(total <= MAX_PATCH_BYTES && !bytes.includes(0),'receipt-file-size');
    const content = new TextDecoder('utf8',{fatal:true}).decode(bytes);
    requireControl(!/(?:sk-proj-|github_pat_|-----BEGIN .*PRIVATE KEY-----)/i.test(content),'receipt-file-secret-pattern');
  }
  return receipt;
}
function object(value: unknown): Record<string,unknown> {
  requireControl(value && typeof value === 'object' && !Array.isArray(value),'publisher-response'); return value as Record<string,unknown>;
}
export class VerifiedProposalPublisher {
  constructor(private readonly api: GitHubTransport,private readonly admission: AdmissionCollector,
    private readonly ledger: RunController,private readonly publicKeyPem: string) {}
  async publish(scope: TaskScope,runId: string,receiptText: string,signature: string,files: readonly ProposalFile[],now: Date): Promise<number> {
    const receipt = verifyReceipt(receiptText,signature,this.publicKeyPem,scope,runId,files,now);
    const evidence = await this.admission.check();
    requireControl(evidence.runId === runId && evidence.grantDigest === receipt.scopeDigest,'publisher-grant');
    const branch = `issue/${scope.issue}-codex-pilot`;
    const existing = await this.api.request('GET',`/pulls?state=all&head=MightyMulligan-ops:${encodeURIComponent(branch)}&base=main`);
    requireControl(existing.status === 200 && Array.isArray(existing.data) && existing.data.length === 0,'publisher-existing-pr');
    const source = await this.api.request('GET',`/git/commits/${scope.sourceSha}`);
    requireControl(source.status === 200 && object(object(source.data).tree).sha === receipt.sourceTreeSha,'publisher-source-tree');
    // Irrevocable publication claim precedes every Git write. Crash/ambiguous responses require operator reconciliation.
    await this.ledger.claimPublication(runId,sha256(receiptText),receipt.scopeDigest);
    const tree = await this.api.request('POST','/git/trees',{base_tree:receipt.sourceTreeSha,tree:files.map(f =>
      ({path:f.path,mode:'100644',type:'blob',content:new TextDecoder('utf8',{fatal:true}).decode(f.content)}))});
    requireControl(tree.status === 201 && object(tree.data).sha === receipt.treeSha,'publisher-reconstructed-tree-mismatch');
    const fresh = await this.admission.check();
    requireControl(fresh.runId === runId && fresh.grantDigest === receipt.scopeDigest,'publisher-grant-drift');
    const commit = await this.api.request('POST','/git/commits',{message:`Issue #${scope.issue}: verified Codex proposal`,
      tree:receipt.treeSha,parents:[scope.sourceSha]});
    const commitSha = object(commit.data).sha;
    requireControl(commit.status === 201 && typeof commitSha === 'string' && SHA.test(commitSha),'publisher-commit');
    const ref = await this.api.request('POST','/git/refs',{ref:`refs/heads/${branch}`,sha:commitSha});
    requireControl(ref.status === 201,'publisher-branch-exists-or-unconfirmed');
    const finalAdmission = await this.admission.check();
    requireControl(finalAdmission.runId === runId && finalAdmission.grantDigest === receipt.scopeDigest,'publisher-grant-drift');
    const pr = await this.api.request('POST','/pulls',{base:'main',head:branch,draft:true,
      title:`Issue #${scope.issue}: verified Codex proposal`,body:`Closes #${scope.issue}\n\nValidated proposal tree: ${receipt.treeSha}.\nSource: ${scope.sourceSha}.\nHuman review required. Merge and deployment are not authorized.`});
    const number = object(pr.data).number;
    requireControl(pr.status === 201 && object(pr.data).draft === true && Number.isSafeInteger(number) && (number as number) > 0,'publisher-pr-unconfirmed');
    await this.ledger.published(runId,sha256(receiptText)); return number as number;
  }
}
