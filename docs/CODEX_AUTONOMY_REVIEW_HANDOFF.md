# Sovereign autonomous Codex — independent review handoff

**Prepared by implementation author; NOT an independent security review.**
**Review targets:** draft PR #78 (disabled worker), draft PR #80 (offline policy foundation).
**Date:** 2026-11-14. **Owner E/F:** NOT_GRANTED. **Paid execution:** NOT_GRANTED.

## Reviewer instructions

Freeze exact source HEAD, PR base and current main; inspect all changed paths and GitHub Actions permissions/triggers, action SHA and downstream CLI/proxy package versions. Re-run actionlint and synthetic adversarial tests against **the published source**, then inspect newest hosted CI run/attempt, both jobs, source/base association, and actual skip counts. Do not substitute historical green CI or local author's tests for independent evidence.

## Current evidence

- PR #78 hard-disabled the paid job with a literal `false` gate and removed raw report/artifact publication. It is not an operational worker; process isolation and secret exposure remain unproven.
- PR #80 adds offline pure policy primitives and tests. Local Node 22 synthetic tests on the candidate module passed 13/13 before publication. It also adds a separate credential-free Git-index patch replay validator and nine synthetic Python fixtures, which passed 9/9 locally before publication. Neither authenticates its own scope or proves worker/publisher isolation. The published tests were adapted to Vitest for repository CI; **published-head CI remains a separate verification**.
- No Codex API request, workflow dispatch, token retrieval, existing/production DB access, migration, merge or deployment was intentionally initiated by this implementation. GitHub automatically runs the repository's existing PR CI, including its configured disposable PostgreSQL service, when a draft PR is published; this is the existing D-authorized path, not a task-side DB operation.

## Blocking findings — request changes

1. **HIGH — No trusted agent-to-validator isolation.** Upstream recommends the Codex action last in its job; a same-job validator and upload cannot assume descendant/proxy termination. Need a reviewed secure handoff and proof of effective filesystem, process and network boundaries, including job logs.
2. **HIGH — No authenticated owner grant or durable idempotency.** The offline policy receives trusted booleans as input but does not verify GitHub actor permissions, scope/expiry/revocation, designated run or competing claim from authoritative sources. Never treat a JSON flag, label or typed confirmation as authorization.
3. **HIGH — No enforceable paid spending control.** The $45 operational cutoff and $50 preference remain advisory. Verify actual hard-limit semantics, current spend freshness, worst-case session estimate, safe cancellation and no automatic retry.
4. **HIGH — No end-to-end authenticated patch handoff or trusted publisher.** PR #80 now includes a standalone Git-index patch replay check, but its supplied scope is not authenticated, ignored-file changes are not proven absent, and no live publisher or isolated runner integration exists. Metadata checks alone remain insufficient. Do not give a token to an untrusted worker or test process.
5. **MEDIUM — Dependency/toolchain verification incomplete.** PR #78 pins the action commit, but the CLI/proxy versions and package integrity have not been independently reviewed or pinned.
6. **MEDIUM — Offline tests are not end-to-end security evidence.** Test authenticated grant failures, source drift, staged/unstaged/untracked/ignored changes, symlinks/hardlinks, rename/deletion, traversal, secrets/logs, malicious artifacts, reruns, cancellations and partial outputs under the actual deployment boundary.

## Acceptance criteria before activation

A separate reviewer must establish authenticated, fresh issue-specific owner grant and revocation handling; atomic durable one-run claim; verified billing enforcement and immutable dependencies; independent worker/validator/publisher isolation; complete patch reconstruction and exact tested tree; bounded artifact and job-log confidentiality; explicit least-privilege GitHub publisher; successful adversarial tests/actionlint and exact-head CI; and a separately approved paid pilot. If any of these is UNKNOWN, keep paid execution disabled.

The implementation author cannot certify their own independent review. No reviewer decision, E merge or F deployment is implied by this handoff.
