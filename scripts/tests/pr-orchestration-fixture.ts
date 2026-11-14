// SYNTHETIC ONLY: no live review, owner grant, CI execution or database.
import template from "../../.github/PR_REVIEW_HANDOFF.template.json" with { type: "json" };
import { acceptancePacket, object } from "../pr-review.ts";
import type { Json } from "../pr-review.ts";
import { collectReview } from "../pr-review-github.ts";
import { acceptanceFixture } from "./pr-acceptance-fixture.ts";
import type { Observation, ManualVerification, OrchestrationInput } from "../pr-orchestration.ts";

export async function orchestrationFixture() {
  const apiFixture = acceptanceFixture(), p = acceptancePacket(await collectReview(apiFixture.api, apiFixture.request));
  const o: Observation = { repository: p.identity.repository, issue: p.issue!.number, pr: p.identity.pr, head: p.identity.head, base: p.identity.base,
    currentMain: p.identity.currentMain!, branch: p.identity.branch!, workflowId: 1, runId: 100, attempt: 1, jobIds: [201, 202], scopeDigest: p.issue!.snapshotDigest!, taskId: "synthetic-task", now: "2026-11-14T12:00:00Z" };
  const m: ManualVerification = { owner: { source: "owner-chat:synthetic-scope", repository: o.repository, issue: o.issue, pr: o.pr, head: o.head, base: o.base,
    scopeDigest: o.scopeDigest, taskId: o.taskId, expiresAt: "2026-11-15T12:00:00Z", revoked: false, ended: false, claimAvailable: true, protectedScopeCovered: true },
    independentReview: { source: "owner-chat:synthetic-independent-review", head: o.head, base: o.base, independent: true }, historySource: "owner-chat:synthetic-history" };
  const history: Json = { repository: o.repository, issueNumber: o.issue, prNumber: o.pr, taskId: o.taskId, implementationPassLimit: 5, implementationPasses: [], postReviewRepairLimitPerFailure: 2, repairs: [], transferSources: [] };
  const review = structuredClone(template) as unknown as Json;
  const syncReview = () => {
    review.identity = { issueNumber: o.issue, prNumber: o.pr, branch: o.branch, expectedHeadSha: o.head, observedHeadSha: o.head, expectedBaseSha: o.base, observedBaseSha: o.base, verifiedAt: o.now, sources: [m.independentReview!.source] };
    review.ci = { ...object(p.ci), headSha: o.head, headRepository: o.repository, headBranch: o.branch, jobs: (object(p.ci).jobs as Json[]).map(j => ({ ...j, tests: { ...object(j.tests), sourceUrl: j.url, trust: "UNTRUSTED_RUNNER_REPORT" } })), association: { verified: true, method: "synthetic", sources: [] } };
    review.diff = { headSha: o.head, baseSha: o.base, fileCount: p.inventory.declared, fetchedCount: p.inventory.fetched, inventoryComplete: true, diffReviewed: true, files: p.inventory.files.map(f => ({ path: f.path, previousPath: f.previous, status: f.status, reviewed: true })), protectedFiles: [], limitations: [] };
    review.checks = Object.fromEntries(["scope", "functionalCorrectness", "security", "authorization", "regressions", "tests", "documentation"].map(k => [k, "PASS"]));
    review.outcome = { decision: "READY", remainingLimitations: [] }; review.findings = []; review.missingEvidence = []; review.conflictingFeedback = []; review.repairHistory = history.repairs;
  };
  syncReview();
  const input = (): OrchestrationInput => ({ packet: JSON.stringify(p), review: JSON.stringify(review), history: JSON.stringify(history) });
  return { p, o, m, history, review, input, syncReview, apiFixture };
}
export type OrchestrationFixture = Awaited<ReturnType<typeof orchestrationFixture>>;
export function confirmed(f: OrchestrationFixture, overrides: Json = {}) {
  return { id: "SYNTHETIC-DEFECT-001", classification: "CONFIRMED_DEFECT", severity: "HIGH", blocking: true,
    location: { path: "docs/CI.md", side: "HEAD", sha: f.o.head, startLine: 1, endLine: 2, url: `https://github.com/${f.o.repository}/blob/${f.o.head}/docs/CI.md#L1` },
    trigger: "Synthetic missing text", evidence: "Synthetic reproduction", impact: "Synthetic policy ambiguity", recommendation: "Correct only the documented synthetic condition", verification: "Run the trusted deterministic regression", ...overrides };
}
export function repairRecord(f: OrchestrationFixture, attempt: number, failureId = "SYNTHETIC-DEFECT-001") {
  return { failureId, attempt, ownerSource: "owner-chat:synthetic-repair", oldHeadSha: f.o.head, newHeadSha: null, oldBaseSha: f.o.base, newBaseSha: f.o.base, result: "Synthetic unsuccessful/uncommitted attempt" };
}
