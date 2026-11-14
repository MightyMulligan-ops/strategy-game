# Sovereign autonomous Codex development pipeline — implementation candidate

**2026-11-14 continuation:** The owner has now explicitly authorized a safe first paid pilot in the active Work request; earlier no-paid-authorization statements below are historical. Technical activation remains BLOCKED. PR78 stays literal-false disabled. No authenticated launch service, durable claim/budget ledger or isolated publisher is delivered by this increment.

The replay validator now returns the reconstructed `tree_sha`, rejects ignored files in the validator's checkout, bounds reads before allocating full artifacts, and rejects final-component symlinks and multi-link files. Use a pristine, disposable, credential-free trusted checkout **before installing dependencies** and a trusted artifact directory with no worker-controlled parents. This does not inspect the original worker filesystem or prove that its ignored files were absent. It does not make a worker-modified checkout trustworthy. Secret-pattern filtering is deliberately incomplete, not a confidentiality guarantee.

**Status: DRAFT / INCOMPLETE / NO PAID EXECUTION / NO TRUSTED PUBLISHER.** Issue #79 records the owner's 2026-11-14 authorization to build the infrastructure and publish draft review candidates, **not** to activate paid API calls, merge, deploy, weaken security settings or access existing databases.

## Target owner experience

1. Owner describes a feature, bug or discrepancy; intake freezes one issue's acceptance criteria, exclusions, source/base and exact allowed paths.
2. A separately authenticated, owner-approved B/C + D + P grant covers one task's ordinary implementation, bounded corrections, existing hosted CI and one draft PR. E/F remain separate.
3. A single isolated Codex worker reads trusted design rules, implements and tests within a bounded multi-hour session. No write credentials or production DB access.
4. A **different trusted process/environment** verifies source identity, full Git patch reconstruction, modes, paths, artifact confidentiality, independent test evidence and live grant/claim/budget state.
5. A distinct trusted publisher, holding only necessary scoped GitHub credentials, publishes the verified exact tree to one issue branch and draft PR; unchanged CI runs; owner reviews before merge.

## Delivered in this draft

- `scripts/codex-automation-policy.ts` implements pure, offline fail-closed checks for frozen scope, actor/ref/source/issue identity, grant digest, expiry/revocation, run assignment, duplicate claim, reported budget evidence, bounded patch manifest and publication prerequisites.
- `scripts/tests/codex-automation-policy.test.ts` exercises adversarial synthetic policy cases using Node's built-in test runner. These tests do not authenticate GitHub identities or execute a Codex worker.
- `scripts/codex-proposal-replay.py` is a separate **offline, credential-free** patch replay validator. It applies an untrusted patch into a temporary Git index at the exact source SHA, rejects unauthorized paths, deletions/renames/type/mode changes, and verifies complete changed-file bytes against a manifest without executing generated code. It is not connected to a live worker or publisher. Its scope JSON is **not authenticated**; a trusted collector must provide it.
- `scripts/tests/codex-proposal-replay.test.py` includes nine synthetic Git fixtures. Local Python unittest execution passed 9/9 before publication.
- No agent runner, authenticated GitHub admission collector, durable lock/ledger, real-time billing checker, **trusted source-to-artifact handoff**, or GitHub publisher is connected to these components. **An input flag such as `authenticatedOwnerGrant: true` is not evidence of actual owner approval.** The caller must prove it independently.

## Admission and cost

An admission service must verify the actual owner identity/permission, frozen issue body and SHA-256 scope digest, unrevoked grant and expiry, current source/base, one designated run, no competing claims and authoritative billing evidence. Reject reruns and queued duplicates; concurrency alone is not a lock. $45 is an operational cutoff and $50 is a monthly preference, **not** a proven hard API cap. A time limit cannot cap tokens or money. Keep paid invocation disabled until independent verification of an actual enforced limit and complete trusted admission.

## Artifact and publisher boundary

The pure `validateProposal` verifies metadata and byte bounds **only**; the separate Python replay tool reconstructs a patch but does not authenticate its scope, validate ignored-file absence, establish isolation or authorize publication. The publisher MUST first obtain independently authenticated task/grant data, reconstruct the entire patch against the exact trusted source in a disposable no-credentials environment, compare file bytes/modes/path inventory, run required tests there, and recheck current source/grants/claims before writing. The untrusted worker must never share an execution environment with a publisher token. Never run agent-authored code in a token-bearing publisher job. Avoid unsafe `workflow_run` artifact handling, symlink traversal and unbounded extraction.

A secure GitHub write integration has **not** been implemented. The `publicationDecision` function is a precondition checker, not a publishing tool or a security boundary. It does not open PRs.

## Future components and stop conditions

- Phase 0 PR #78: complete disabled worker hardening and independent review, including process/proxy termination and raw GitHub job-log exposure.
- Phase 1: authenticated issue intake/approval, source-bound scope, atomic idempotency claim and durable ledger, explicit revocation checks, verified usage and immutable toolchain.
- Phase 2: independent full-tree validator, isolated DB-free test runner and separate trusted publisher with least privilege and one draft PR; reuse existing CI and read-only reporter.
- Phase 3: optional preview builds and clear owner-facing status. Preview code runs without secrets.

Stop on scope ambiguity, stale evidence, duplicate runs, unknown billing, missing permissions, secret-like artifacts or failed validation. No automatic paid retry. Existing five in-task correction passes and two separately owner-started post-review repairs remain distinct. Neither passing tests nor this document grants E/F.

## Verification and evidence

Local synthetic policy tests were executed on Node 22 with `node --experimental-strip-types --test scripts/tests/codex-automation-policy.test.ts`: 13 passed, 0 failed, in an isolated candidate directory before publication. Hosted repository CI, TypeScript workspace typecheck, actionlint, full security audit, live GitHub authorization, actual worker execution and publisher integration are **not verified** by those tests. A fresh independent review must inspect the exact published source and latest CI evidence.

