# Sovereign autonomous Codex — current review handoff

**Author-prepared evidence; NOT independent certification.** Review draft PR80 and disabled worker PR78. Paid pilot remains blocked. E/F (merge/deployment) remain prohibited.

## Current change

PR80 adds trusted-controller candidate modules for persistent Git-ref claims/budget reservations, current GitHub owner-grant/source authentication, a bounded model gateway, signed exact-tree publication and a sandbox preflight. See CODEX_AUTONOMOUS_PIPELINE.md for exact delivered/missing boundaries. This increment does not install a running service, initialize a live ledger, enroll a signer, read a credential, mint a grant, dispatch a workflow or make a paid call.

## Local evidence

Six relevant Vitest suites: 49 passed, one skipped (50 total). The skipped Unix-socket fixture is blocked by host EPERM; it remains an activation blocker. Python replay fixtures run through the existing wrapper: 18 passed. Targeted tsc 6.0.3 passed using strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, noImplicitOverride and noFallthroughCasesInSwitch. Initial narrower typechecks did not establish the stricter workspace flags; those errors were subsequently corrected. Existing hosted CI must be inspected on the new exact source, with actual skip counts. Passing mocked/provider fixtures are not live transaction or sandbox evidence.

The namespace probe on this Work host returns unavailable. Docker/Podman are absent; required API/GitHub token variables are absent (presence-only inspection). No insecure fallback was attempted. Diagnostic TS execution needs compiled JS or Node24 transform-types; strip-only parsing rejects parameter properties.

## Required independent review and remaining blockers

1. Audit the real executable worker/bridge/exporter/validator lifecycle once implemented on a compatible executor. None is wired yet. Verify filesystem, PID and network isolation; broker-only model egress; no credentials/host processes in children; complete termination on cancellation; no raw log exposure; no worker-controlled Git/config execution; complete output inventory.
2. Inspect Git-ref ledger CAS, nonce uniqueness for identical concurrent mutations, bootstrap authority, reset/rollback protections, monthly baselines, exclusive project routing, price provenance, project-key binding, conservative accounting and crash/unknown outcomes. Synthetic races are not live concurrency certification. No production ledger/rate card is initialized.
3. Verify owner grant intake against existing active Work authority, immutable comment/source/issue binding, actual permission and revocation/expiry. Do not let a worker create or supply its own approval, evidence, price card or RuntimeVerifier. In-flight calls cannot be retroactively revoked.
4. Enroll the validator public key through a trusted operator path; audit its private-key isolation and signer implementation. Receipt signature checking does not prove tests or sandbox execution when the signer/lifecycle are absent. Verify exact complete tested tree, required checks and expiry before publication.
5. Verify provider token counting and pricing semantics, chosen immutable model/toolchain integrity, stream/backpressure/disconnect behavior, request limits and real CLI compatibility. API schemas/prices may change; unknown cases must block.
6. Recheck signed publisher provenance, grant/source drift, every Git write's one-shot claim, tree SHA comparison, dedicated branch and draft-only PR, duplicate historical PR rejection and manual reconciliation after ambiguous writes. No untrusted code may run in the credential-bearing publisher.
7. Inspect exact published source/base, existing workflow/job/run/attempt provenance, root build/typecheck/lint/test results, all deliberate application DB skips, separate hosted PostgreSQL zero-skip execution and cleanup. Do not automatically retry CI or paid calls.

Browser evidence previously established project spending around $0.11 and an enforced $45 project limit. Provider UI warns enforcement may lag and spend exceed the configured threshold. That is defense in depth, not a verified strict financial ceiling. Other key access and authoritative starting spend remain unverified.

Outcome: **BLOCKED for live paid activation; ready only for draft code review after new-head CI.** The implementation author cannot provide the required independent security acceptance. Preserve the five-pass/two-attempt history in DEVELOPMENT_STATUS.md and do not merge or deploy.
