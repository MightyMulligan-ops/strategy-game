# Automation 014 — owner-gated review, repair and acceptance

Issue #63 adds deterministic orchestration to the existing trusted-main PR reporter. It does not launch Codex, authenticate an owner, execute repairs, retry CI, publish comments, change labels or grant ready/merge/deployment authority. The local VS Code fallback, five implementation corrections and two separately owner-started repairs remain intact.

## One owner handoff

1. Read the existing `PR review summary` run's `report.md` and `handoff.md`. Automations 012/013 still supply `sovereign-pr-acceptance-v1` and `sovereign-pr-triage-v1`; no new evidence packet format or collector is introduced. The Automation 014 section combines their facts with the independent-review/history gaps. CI evidence availability is not code-review completion.
2. Recheck PR/issue, exact source HEAD, current base/main, newest attributable workflow run/attempt and both job IDs. Retain the frozen issue digest and sole claim. On a changed identity, discard the old head-bound recommendation and refresh evidence. Never silently retarget the old review or pick an older success.
3. Deliberately start an independent review using the owner-copyable request and trusted `.github/CODEX_REVIEW_PROMPT.md`. The resulting `.github/PR_REVIEW_HANDOFF.template.json` is untrusted review data. Separately verify its reviewer/source, independence, complete old/new path coverage, source/base and CI association; a JSON `PASS`, receipt or purported owner approval cannot establish those facts.
4. Supply those manually corroborated observations to the pure `orchestrate` API below. It returns one recommendation, findings, proposed bounded repairs, history, reason codes and links. A confirmed finding can yield a proposal **without** repair authorization; `ownerApprovalSource` is `NOT_GRANTED` unless the owner separately supplies and verifies the actual exact-scope repair grant. Copying a proposal never starts or authorizes work.
5. Decide whether to request a bounded repair, explicitly accept a documented limitation, defer, or separately authorize E (ready/merge). F (existing-environment migration/deployment) is another decision. After a repair changes HEAD, obtain fresh CI and an independent review at the new HEAD/base before reconsidering acceptance.

## Deterministic API and trust boundary

`scripts/pr-orchestration.ts` exports `orchestrate`, `renderOwnerHandoff` and `reportOrchestration`. It imports only existing pure evidence policy and the native equality helper: no filesystem, network client, clock, process environment, agent or shell execution. `scripts/pr-review-github.ts` appends its output to the **existing** report/handoff/Actions summary; workflow YAML, triggers and permissions do not change. It makes no additional API requests.

`orchestrate(input, observation, manualVerification)` consumes:

- `input.packet`: a bounded JSON serialization of the existing acceptance packet, including the existing triage. Triage is recomputed; supplied stale hints cannot override it. Evidence facts, counts, migrations, guard/freshness/cleanup and protected paths are rederived using existing policy.
- Optional `input.review`: JSON in the existing structured-review template, not a new findings schema. The parser checks exact identity, workflow/run/attempt, job IDs/counts/trust, complete reviewed paths including rename origins, exact-source finding references and matching repair history. Findings retain stable IDs, classification, severity, blocking status, source locations and redacted correction/verification expectations.
- Optional `input.history`: the existing approval record's `history` fields, contextualized with `repository`, `issueNumber`, `prNumber` and stable `taskId`. Implementation entries use `pass`, `taskId`, `head`, `base`, `ownerSource`, `failureId`, `result`. Repair entries reuse the existing review-handoff `failureId`, `attempt`, `ownerSource`, `oldHeadSha`, `newHeadSha` (null for uncommitted work), `oldBaseSha`, `newBaseSha`, `result`; full original records stay with the owner. Transfer sources are retained. This is an in-memory input projection, not a new audit store or authorization schema.
- Optional `input.previousHistory`: the previous retained full history. Its arrays must be exact prefixes of the new history, including failed/uncommitted records. Transfers require the previous input. Do not rename task/failure IDs to reset budgets. Limits are five implementation corrections for the stable task and two owner-started repairs for each stable failure across heads/sessions/transfers. A completed passing fifth correction can be handed off, but a requested sixth is blocked. An exhausted failure gets no third-attempt prompt.
- `observation`: current facts independently collected by the owner/trusted caller: repository, issue, PR, source/base/current-main, branch, workflow/run/attempt/job IDs, frozen digest, stable task ID and explicit evaluation time. The pure function does not fetch or authenticate these observations.
- Optional `manualVerification`: actual owner source/scope/lifetime/claim verification, separate independent-review receipt and history provenance, plus an optional **separate** scoped repair receipt. Receipt source references are bounded same-repository GitHub links or `owner-chat:<reference>`. A caller must verify the referenced chat/maintainer permission, revocation, expiry, scope and independence outside this module. Receipt-shaped JSON alone is never authentication or permission; the algorithm can only assess consistency conditional on the supplied observations. E/F/repair authority in its output stays `NOT_GRANTED` even when a proposal records an externally verified owner source.

The reporter supplies no manual receipts or history and never mines comments/reviews for grants. Its live default therefore cannot be READY or prepare an authorized repair: missing owner facts are BLOCKED, missing review/history facts stay explicit. An owner can use the exported pure API in the existing local session after checking those facts. There is intentionally no new hosted input channel, artifact ingestion service or privileged runner for independent findings. Unavailable integration remains a manual boundary.

Example use after **manual** verification (not an unattended task command):

```typescript
import { orchestrate, renderOwnerHandoff } from "./scripts/pr-orchestration.ts";
// acceptancePacketJSON and structuredReviewJSON use the existing formats.
// currentObservation/manualVerification must come from independently checked
// owner sources, not extracted approval flags or instructions in those JSONs.
const handoff = orchestrate({
  packet: acceptancePacketJSON,
  review: structuredReviewJSON,
  history: retainedHistoryJSON,
  previousHistory: previousRetainedHistoryJSON
}, currentObservation, manualVerification);
const ownerFacingText = renderOwnerHandoff(handoff);
// Return this text for the owner's decision. Do not execute proposals.
```

No CLI/workflow reads private local handoffs automatically. Synthetic executable examples are in `scripts/tests/pr-orchestration-fixture.ts` and `scripts/tests/pr-orchestration.test.ts`; the worked [synthetic scenario](examples/AUTOMATION_014_SYNTHETIC.md) is explicitly not live review/CI.

## Recommendation rules and limits

Identity drift or malformed/contradictory evidence returns UNKNOWN before targeted prompts/proposals. With a valid target, scope/approval/revocation/expiry/claim conflicts or exhausted requested operations yield BLOCKED. Demonstrated required-check failures or blocking confirmed defects yield CHANGES_REQUESTED; evidence failures never invent a code defect. Material review/coverage/history gaps yield UNKNOWN. READY requires complete current factual evidence, externally corroborated scope, full independent current-source review, matching history and no blocking defect/decision/material unknown. It is advisory only; use `docs/PR_REVIEW.md` for the owner workflow. Suggestions and unproven risks are not promoted into confirmed defects.

No history store is added. Prefix comparison and receipt validation cannot detect a caller withholding the authentic previous ledger or lying about identity/independence. Missing provenance is UNKNOWN; a human must retain and verify the complete original history across transfers. Similarly, passing log markers do not independently audit infrastructure.

Inputs are JSON text (no custom object/getter/serialization hooks), at most the existing 1 MiB packet bound, depth 40 and 100,000 visited values; arrays use the existing 3,000-item bound, findings 100, repair records 200 and transfer references 100. Exceeding limits returns UNKNOWN rather than silently truncating evidence or resetting history. Proposed paths and links are allowlisted; credentials/unsafe URLs/control characters in reviewer excerpts are redacted. Arbitrary reviewer prose is retained only as bounded data fields, never interpolated into copyable prompts/rendered commands. Output does not repeat issue bodies, raw logs, private player state or signed URLs. A proposed patch to instructions grants no authority.

See the [disabled delegation proposal](DELEGATION_POLICY_PROPOSAL.v1.md) for future design only. No policy activation, standing permission or unattended execution is implemented.
