# Sovereign manual Codex worker pilot — Issue #77

**Status: DISABLED / DRAFT / NOT A RUNNABLE PAID WORKER.** This candidate remains in draft PR #78. It authorizes no gameplay Issue #76 implementation, paid API execution, GitHub publishing, merge or deployment.

## Current safety state

The job in `.github/workflows/codex-manual-worker.yml` is guarded by a literal `false &&` condition. This prevents its paid Codex step from executing even if manually dispatched. The job also rejects reruns, is scoped to the repository owner, `main`, and the fixed Issue #76. These conditions are defense in depth, **not** an authenticated grant or a reliable anti-replay ledger.

The candidate pins the inspected `openai/codex-action` commit `bdf19a4a223ec2549a3e2274a0cf61556bc07675`; it does not pin or verify the CLI/proxy versions installed by that action. Existing CI passing does not validate the action's process, sandbox or credential isolation.

The original post-agent validator and raw final-report artifact uploader were removed from the workflow. A same-job post-agent validator cannot be assumed trustworthy: upstream guidance recommends running the Codex action last; proxy/descendant shutdown and job-log exposure have not been demonstrated. The disabled candidate currently produces **no proposal artifact**. This is intentional and must not be represented as a working pipeline.

## Intended future pilot

One separately approved Issue #76 B/C + paid grant would authorize a bounded isolated development session only after trusted source/scope verification, revocation/expiry/duplicate-run checks, verified current billing and actual enforced limits, and independent security review. The future worker should produce an untrusted proposal that a **separate** trusted validator reconstructs against the exact source and verifies without credentials. A distinct P/D-authorized publisher may then create one draft PR, reusing existing CI and review evidence. The worker never gets GitHub write credentials.

The original offline Phase 0 candidate remains available to the owner as a separate local package. Its isolated-index patch replay and 20 synthetic tests are useful research, **not published/verified implementation in this PR**. Do not imply the local package was applied to this branch.

## Financial and operational restrictions

The $45 operational cutoff and $50 monthly preference are not hard spending caps. GitHub runner timeouts bound wall clock only; neither an alert nor a typed phrase enforces money/token limits. Concurrency serializes but does not reject queued duplicate dispatches. Missing authoritative billing evidence, owner grant, process isolation, source identity or immutable toolchain verification must block paid execution. No automatic paid retry.

## Verification and remaining gates

Before any paid activation, complete offline adversarial tests (staged/unstaged/untracked/ignored changes, symlinks/hard links, rename/deletion, secrets, logs, cancellation, replay and forged approvals), actionlint, isolated post-agent process handoff, immutable action and CLI/proxy integrity review, authenticated issue-specific grant and durable claim, enforced budget verification, trusted validator/publisher boundary and fresh independent review.

This branch is **not** authorized for paid dispatch or gameplay work. No production/existing database access, migrations, deployment, automatic merge or credential/permission changes. E/F remain NOT_GRANTED. See `docs/CODEX_AUTONOMOUS_PIPELINE.md` on the separate Issue #79 development branch for the proposed reusable architecture; that draft is not a trusted policy on `main`.
