# Completion security assessment — author review, activation OFF

This is the implementation author's security-focused review. The owner explicitly
waived an external/separate independent security review for this task. This report
does not claim independence or grant activation, merge, deployment or paid approval.

## Boundaries reviewed

| Property | Code/evidence | Practical limit |
|---|---|---|
| Owner-only bounded authority | `overnight-policy.ts`, `overnight-production.ts`: domain-separated Ed25519, external SPKI pin, fresh permission/issue/main/config checks, immutable exact scope/order | Owner must protect enrollment/config and private key; no signature authenticates its own key |
| One durable admission | `GitHubQueueStore` / `QueueJournal`: nonce-bearing child commits, non-forced CAS, consumed approval IDs, reservation before provider POST | Real GitHub ref protections/App enrollment are manual prerequisites; transport/concurrency tests are synthetic |
| Every paid entry controlled | Old pilot fails before checkout; old smoke's paid action removed; new caller is signed/main-only | Administrators can change trusted main or run unrelated clients; this is not control over activity outside this repository |
| Separate privilege domains | Reusable prepare/agent/seal/validate/publish jobs; provider key only in agent/recovery, dedicated ledger App only in control jobs | Main-only environment policies must be configured before secrets; never give generic Actions tokens ledger bypass |
| Exact validation | PR90 executor and receipt reused; successful real job/step metadata plus protected needs digest; strict source/tree/artifact/run/attempt and signed scope checks | Unit fixtures simulate command outcomes; unchanged normal CI independently runs the real isolated validator smoke |
| Safe publication | Detached Git index, full tree comparison, fixed queue branch, fixed body with exactly one task closing line, no worker summary authority, no executable generated code in publisher | Unknown remote response stops; owner must inspect any orphan branch/draft before manual follow-up |
| Crash and provider uncertainty | Pre-create intent, bounded SSE/artifacts, local state + retained artifacts, deletion ACK verified, sealed durable termination, no retry/TTL takeover | Lost create response without an ID cannot be exhaustively reconciled by this API implementation; exclusion remains held |
| Narrow recovery | Separate signed stop request bound to ledger revision; completed original run; exact known IDs or proven skipped step; authenticated recovery receipt; stop/release CAS only | Cannot invent an ID, infer termination from404/timeout, restore approvals or restart remaining tasks |
| One night | IANA Eastern22:30, canonical UTC bounds,15-minute grace, two disabled-by-default activation flags, exact run attempt1 | GitHub scheduler can delay/drop runs; late dispatch stops, never rolls over |
| Reporting/privacy | Constant reason codes, bounded IDs, no provider key/prompts/error bodies/code in summary; reserved vs confirmed starts; billing UNKNOWN | Abrupt runner loss may prevent an artifact; durable ledger can be rendered separately by owner |

The final bounded review also strengthened: App installation/repository/permission
binding; exact existing-PR body identity; unique actual GitHub job IDs; source-bound
recovery; strict output-name allowlist; and persisted termination before validation.
No additional material defect was observed in the reviewed final implementation.
This statement is limited to code inspection and the recorded automated checks.

## Required owner configuration and operational confirmation

1. Protect main/config/ledger refs as specified in `OVERNIGHT_QUEUE.md`. Confirm
   generic Actions tokens and ordinary contributors cannot reset the ledger.
2. Install the dedicated App for this repository, enroll its IDs/key in the
   main-only control environment, and enroll the owner's signing key/pin/revocation.
3. Use a separate main-only provider environment and dedicated provider credential.
   Project/key binding and activity outside this controller are manual assumptions.
4. Execute the initially non-paid acceptance procedure. Real queue/recovery job
   naming, GitHub permissions/token response shape and protected-ref behavior were
   not exercised through a live dispatch in this task. They fail closed on mismatch.
5. Separately approve any first paid acceptance/night. Actual provider status,
   deletion/cancellation semantics and billing were not tested with live sessions.
   A local timer is not a spending ceiling or remote termination proof.

The production boundaries are connected in code. Operational activation remains
blocked until these prerequisites and explicit owner authorization are satisfied.
There is no missing external-review gate and no invented dollar cutoff.

## Verification and history

See the PR completion handoff for the final source SHA and current-head CI evidence.
Focused completion verification passed150 tests with zero failures/skips across8
files, including real temporary-Git packaging/replay/tree reconstruction, JWT
signature verification and mocked production GitHub/provider/publisher transports.
Script TypeScript, actionlint1.7.12 and whitespace checks passed. Normal CI also
executes the unchanged credential-free isolated-validator smoke; its result must
be bound to the published final source before relying on it.

Final full database-free verification: frozen pnpm12.18.0 install, Prisma7.10.1
generation, full build, full TypeScript and lint all passed. Full suite:
**2034 passed /0 failed /262 intentional database skips**,85 passed/15 skipped
files. No skip is presented as PostgreSQL verification. The completion owner source
is the active uploaded request, SHA256
`d3297aad683dc364a6d6701e6d7157a165c81bb9c0b1e13d49cd8e2ae2846ffb`;
it expressly authorizes existing draft publication/normal disposable CI and the
review waiver, while excluding paid execution/activation/settings/merge/deployment.

Foundation correction history2/5 is preserved. Completion used passes3–5:
3 retired-entry actionlint correction;4 output-name fix and termination sealing;
5 test-selector correction and final App/publication/recovery security hardening.
The shared five-pass budget is exhausted. No post-review repair or automatic CI
retry is authorized or performed. Tests use synthetic credentials/keys/provider
responses; no paid API request, live approval, configuration/ledger provisioning,
existing database access, task-side PostgreSQL/Docker/migration, merge or deployment.
