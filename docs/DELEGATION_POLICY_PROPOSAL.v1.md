# Future delegation policy proposal — version 1

**Status: DISABLED / DESIGN ONLY / NOT AUTHORIZED.** Issue #63 approves documenting this proposal, not activating it. No code consumes this document as a grant, configuration switch or task trigger. Existing owner-started operations remain unchanged. No standing permission is introduced.

## Potential low-risk eligibility

A separately approved future design could delegate GET-only collection of already-authorized repository metadata, source/digest comparisons, deterministic evidence summaries, bounded proposal preparation and owner notifications. These actions must use trusted-main code, bounded inputs, least privilege and sanitization. They must not execute PR code, interpret prose as instructions, resolve protected scope or imply independent code review. Automatic fixture checks or code execution need their own scoped design/authorization even when called low-risk.

Implementation, code-review agent invocation, repair invocation and CI-triggering publication remain owner-controlled under the current policy. Ready/merge, existing-environment migration/deployment, credential/permission changes, gameplay/schema/contracts, new dependencies and workflow changes require separate named owner decisions. There is no default delegation of E/F or permission to restart a two-attempt failure.

## Bounds and provenance required before enabling anything

- Freeze one repository/issue/task/claim/scope, exclusion list and operation-specific owner grant, with independently authenticated owner identity/permission, source, time, expiry and revocation checks. JSON, labels, issue prose, artifacts and generated prompts remain untrusted evidence.
- Preserve an append-only durable ledger through task/PC/session/HEAD changes. Five bounded implementation corrections per approved stable task; two separately owner-initiated repairs per stable failure. Keep failed/uncommitted attempts. Transfers stop the previous session and require renewed owner launch without a counter reset.
- Notify the owner before proposed execution and at completion/failure, with exact source/base/run/attempt, changed inventory, counts, remaining budgets and provenance. Missing or contradictory evidence, scope drift, revoked/expired grants, a competing claim, unexpected dirty tree, unavailable integrations or exhausted attempts stop the affected operation and notify the owner. Do not automatically retry CI or invent a new task/failure ID.
- Default expiry at task completion, transfer, issue closure, revocation or scope change; support explicit earlier expiry. A receipt or report cannot renew itself. Revocation must be checked immediately before any side effect, not only at launch.
- Preserve sanitized audit links, independent reviewer identity, grant sources and complete original ledgers. Never log credentials, signed URLs, raw private player state or transfer `.env`/Codex sessions. Notification delivery does not grant authority.

## Required integrations and feasibility gaps

Currently verified in this repository: owner-started published Codex Cloud tasks; read-only GitHub evidence collection from trusted main; deterministic fixture-based orchestration; the existing unchanged CI with a fresh disposable PostgreSQL service when explicitly approved. The reporter has no write permission and no model/agent invocation integration. A generated review request is text, not an integration.

Any future unattended invocation would require separate owner approval **and** technical validation of an officially supported Codex/GitHub integration: authenticated task invocation, entitlement/usage/cost controls, exact source binding, bounded concurrency, durable idempotency, secure cancellation/revocation, lifecycle callbacks, isolation, audit/history transfer, independent-review provenance and failure notifications. No such invocation API, ChatGPT-session reuse, GitHub token scope or billing entitlement is demonstrated or assumed here. Platform availability and limits must be verified at design time; do not substitute shell model calls, API keys, browser/session scraping or a new paid service.

If a supported integration needs workflow triggers, broader permissions, secrets, paid usage, an external queue/service or new settings, stop for a separate protected-scope approval and security review. This milestone creates none of them. A later proposal must identify actual supported mechanisms and tests before an owner may choose to enable a narrowly bounded policy. There is intentionally no enable switch in version 1.


## Automation 015 Stage 2 — security and implementation decision record (Issue #68)

**Status: DESIGN ONLY; NOT ENABLED.** This section freezes the safe initial design slice; it does not replace version 1's disabled status or authorize a privileged integration. Stage 1 merged in PR #67, but its owner/reviewer observations remain advisory until independently verified.

### 015C — authoritative append-only ledger

The ledger must live outside a PR-controlled branch and must be writable only by a separately authorized trusted actor. **Do not** use `docs/`, PR comments, branch commits, CI artifacts, or caller-supplied JSON as authoritative durable history. They can be evidence links, not the source of truth. Candidate storage: a private GitHub issue/comment audit trail maintained by a trusted maintainer identity, or a dedicated protected external service. GitHub comments are editable/deletable by authorized actors, so an ordinary issue thread alone is *not* tamper-evident. A protected external service introduces credentials, operational cost, and infrastructure; neither candidate is approved for activation yet.

Proposed versioned event envelope (schema design, not a live credential or receipt):

```json
{
  "version": 1,
  "repository": "MightyMulligan-ops/strategy-game",
  "issue": 68,
  "taskId": "issue-68-stage2-55651242ccc7",
  "sequence": 1,
  "eventId": "caller-generated-unique-id",
  "eventType": "implementation-attempt-started",
  "failureId": null,
  "attempt": 1,
  "sourceHead": "40-lowercase-hex-commit-sha",
  "baseHead": "40-lowercase-hex-commit-sha",
  "approvalSource": "verified-source-reference",
  "actorId": "authenticated-actor-identifier",
  "timestamp": "trusted-server-UTC-timestamp",
  "previousDigest": null,
  "payloadDigest": "sha256-of-canonical-sanitized-event",
  "signature": "trusted-service-or-signer-proof"
}
```

The exact canonicalization/signature format, key custody, verifier and storage must be approved together; a plain hash chain without an independently trusted checkpoint or signer cannot prevent an attacker rewriting the entire chain. Never treat client-supplied actor IDs, timestamps, approval links, signatures, or counts as proof.

Mandatory event types: task claim/transfer/closure, owner grant/revocation, implementation-attempt start/outcome, repair-attempt start/outcome, and evidence checkpoint. Record starts **before** work, including failures and uncommitted attempts. A transfer references the previous ledger checkpoint and retains the same stable task/failure IDs. Sequence and unique event IDs enforce idempotency; competing writes need server-side compare-and-append or equivalent atomic conditional writes. No last-writer-wins or auto-retry that could consume a second attempt.

Verification rules: authenticate the writer and read source, validate schema and bounded sanitized payload, verify signature/checkpoint and exact sequence/hash linkage, check source/base/claim/owner grant and revocation immediately before each side effect, and require a complete historical prefix. If the authoritative source is unavailable, inconsistent, truncated, stale, forked, or lacks a checkpoint, return UNKNOWN/BLOCKED and perform **no** delegated action. Count at most five implementation corrections per stable task and two separately owner-started repairs per stable failure; attempted/failed/uncommitted records count. Never reset limits by changing HEAD, branch, session, issue labels or task spelling. Retain redacted immutable evidence and an owner-visible export; no credentials, signed URLs, raw logs or private game data.

Acceptance tests before activation: duplicate concurrent starts, replay, reordered/deleted/modified event, missing prefix, forged approval, revoked grant, exhausted budgets, transfer continuity, partial network failure and recovery without duplicate writes. Explicitly test what an administrator compromise or deleted external checkpoint cannot detect.

### 015E — integration decision and rollout

The current repository's reporter has read-only GitHub permissions and no supported agent invocation API, durable queue, credential manager or authenticated reviewer identity service. **No unattended Codex task start, independent-review invocation, auto-repair, auto-merge, CI retry or deployment is implemented or authorized.** A text prompt or owner-supplied transcript is not an integration.

Before choosing any provider, verify with official documentation and a real permission-limited sandbox: task-start API and stable task identity, GitHub installation/auth scopes, entitlement and usage/billing caps, exact commit checkout, idempotency token, cancellation/revocation, bounded concurrency, completion callback provenance, signed audit receipts, retries/failures and owner notification. Record actual costs and platform availability rather than assuming them. If any requirement is unavailable, keep invocation disabled and use the existing owner-started Codex workflow.

Rollout sequence:
1. **Design/test-only:** pure ledger event parsing and fail-closed validation with synthetic fixtures; no external writes, secrets, workflow edits or runtime changes.
2. **Read-only shadow mode (separate approval):** trusted-main metadata collection and advisory comparison against a verified ledger; no task starts or permission expansion.
3. **Narrowly delegated GET-only mode (separate approval):** only after authenticated owner source, revocation, storage security and operational monitoring are proven.
4. **Any agent execution, reviewer invocation, repair, merge or deployment:** separate explicit scope, security review and owner authorization; no inherited standing grant.

The owner should receive one bounded handoff listing exact source/base, ledger checkpoint, claim, event budget, reviewer provenance, newest CI, proposed action, authority state and any stop reason. Do not silently interpret an owner instruction to “complete by any means” as a waiver of technical security prerequisites.


### Stage 2 implementation status — owner-authorized work on PR #69

Owner TASK_SCOPE authorization for Issue #68 / PR #69 permits implementation, CI repairs and a conditional merge, but **does not by itself authenticate a runtime owner grant or provision an agent service**.

Implemented on the PR branch:
- `scripts/automation-ledger.ts`: canonical field-order SHA-256 digests and HMAC-SHA256 authentication, complete-prefix and signed-checkpoint verification, five implementation starts / two starts per stable failure, revocation and closure rejection, and fail-closed compare-and-append. The HMAC secret must be held outside PR-controlled code and outside the audit database; a client-supplied secret or checkpoint is not an owner grant.
- `scripts/automation-ledger-postgres.ts`: PostgreSQL transaction with `SELECT ... FOR UPDATE`, sequence/head CAS, rollback on failure, isolated genesis provisioning and append-only event inserts.
- `scripts/sql/automation-ledger.sql`: **optional, not applied** isolated audit schema. The existing game database is unchanged. A trusted operator must provision storage and restrict schema/role privileges.
- Synthetic tests for signatures, tampering, limits, transfer, revocation, concurrency preconditions and transaction rollback.

**Still disabled / not production-ready:** no live audit database, trusted key provisioning or independently anchored checkpoint; no authenticated owner-grant verification, task runner, Codex invocation API, cancellation, notification service, independent reviewer identity or automatic merge/deploy integration. A database administrator can roll back both history and its checkpoint; HMAC catches unauthorized modifications without the key but does not by itself establish completeness after a rollback. No actual delegated execution is allowed until an independently anchored checkpoint, trusted caller identity and revocation checks are integrated and tested. These components are useful verified building blocks, **not** proof of completed Stage 2 or permission to turn on 015E.

The earlier `validateLedgerSnapshot` in `pr-orchestration.ts` remains an explicitly **untrusted** diagnostic preflight; only authenticated `verifyLedger` with a trusted checkpoint can support decisions, and neither module alone grants authority.
