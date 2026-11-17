# Manual-start security change — November 17, 2026 candidate

Owner-authorized scope supersedes the legacy fixed overnight window and 300-second
pilot allowance: manually launch one Issue #95 session at any bedtime and rely on
the dedicated Platform project's $50 soft operational spending ceiling. Source
below is an implementation-author review, not independent certification or live
paid-run evidence. The older assessment follows as historical context.

- V2 is a distinct signature domain; v1 approvals retain original semantics.
- V2 rejects cron, reruns, extra tasks, numeric coding allowances, unknown keys,
  altered spending policy/limit and all existing forbidden path/operation changes.
- A durable reservation fixes the run's origin and scope digest. Later jobs bind
  to that digest and the same queue/run/source/approval; no sliding renewal.
- No controller USD meter is claimed. Owner must verify project limit $50 with
  enforcement enabled and correct existing project-key binding. Alerts alone do
  not stop execution; monthly spend and propagation delays affect the result.
- The six-hour Agent infrastructure ceiling has a two-minute cleanup margin.
  Manual streams use a matching timeout rather than the old hidden 13-minute cap.
  Existing HTTP size bounds, isolated validation, credentials and dependency pins
  remain intact. Spending/timeout/failure never automatically creates a replacement.
- Owner-local signing compares the old signed request with the live config/key
  pin, checks old/new consumed IDs and current task/owner/main, and retains scope.
  Only the existing private signing key is read locally. It is never passed as a
  GitHub argument/body or printed. The prepared request contains only a signature
  and public key. Start revalidates before writing and binds publication to SHA.
- Local signing has no GitHub mutations/provider calls. Start records an exclusive
  local attempt marker before mutations and never retries an ambiguous dispatch.
  Durable history remains authoritative across devices; stable derived approval
  IDs prevent repeated conversion of the same original approval into fresh starts.
- No live billing setting, private key, activation switch or dispatch was accessed
  or changed by implementation/testing. Owner merge and local signing/start remain.

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
The later read-only check found OVERNIGHT-REPORT-001: provider termination was
incorrectly described as coding completion after recovery, and known session IDs
were omitted. The owner explicitly authorized one additional narrow correction
pass as an exception to the exhausted five-pass budget; it is not a reset.

The formatter now separates coding evidence, task state and provider termination.
Failed/stopped/canceled or uncertain tasks never gain a successful coding label
from deletion alone. Safe known IDs are shown; absent IDs are UNKNOWN and unsafe
or credential-shaped IDs are withheld using the existing diagnostic sanitization
plus GitHub credential-prefix filtering. Regression cases include successful,
failed, canceled, owner-reconciled and uncertain outcomes, prior completion
evidence, pending publication, redaction and report immutability. No orchestration,
authorization, ledger, provider, validation or workflow behavior changes.

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
The shared five-pass budget remains exhausted. OVERNIGHT-REPORT-001 has one
separately owner-authorized exception pass, recorded independently; no further
correction is authorized. No automatic CI retry is authorized or performed.
Tests use synthetic credentials/keys/provider
responses; no paid API request, live approval, configuration/ledger provisioning,
existing database access, task-side PostgreSQL/Docker/migration, merge or deployment.

## OVERNIGHT-REPORT-001 — owner-authorized exception result

The active owner message explicitly authorized one narrow exception, including
same-branch publication and normal hosted CI, starting from PR91 source
`2d208f3fbd0550e34d675b62e5d9eb065734d791`, base
`7fd8327c77858b8f4e5bf728528021aab294c40d`. Clean branch/head/draft identity and
owner repository admin permission were verified before edits.

One exception pass used, **1/1**, with no reset of the original5/5 history.
Changed only the formatter, its regression tests and this assessment. All13 new
regressions passed. Focused queue/policy/production/App tests: **137 passed,
0 failed,0 skipped** across4 files. Full database-free suite: **2047 passed,
0 failed,262 intentional database skips**,85 passed/15 skipped files. Build,
full TypeScript, lint and whitespace checks passed with AUTH_ENABLED=false and
RUN_DATABASE_TESTS=0. No ledger/provider/authorization/validation/workflow behavior
was changed. The approved finding is resolved locally; exact published-head CI
evidence is recorded in the PR handoff. No live provider or queue was activated.

## Issue #94 / PR #93 — bootstrap author assessment, activation OFF

The owner-started Issue94 request authorizes focused CI reliability repair,
bootstrap completion, same-PR publication and bounded fresh disposable hosted CI.
It does not authorize settings changes, real bootstrap, paid provider work, merge
or deployment. The original PR93 bootstrap commit remains in history. Its inline
checks are extracted into a deterministic testable administrative entrypoint;
current-main/owner checks, explicit confirmation, disabled activation flags,
strict empty manifest and post-create readback are added. The existing App auth
and GitHubQueueStore.bootstrap implementation remain unchanged. Tests sign/verify
synthetic RSA App JWTs and exercise real store serialization/ref creation/readback
through an offline HTTP model; no test mocks bootstrap itself as a success.

Read-only GitHub evidence on2026-11-16 Eastern: public repository; active rulesets
27421176(main PR + Application/PostgreSQL checks + delete/force denial, no bypass),
27421291(config update restriction with owner353505747 bypass), and27421307(ledger
update restriction with Integration5792895 bypass only). Both environments allow
only the exact main branch. Protected config revision
69ef61ab582bdcee4e80de854aed9806c7285067 has disabled empty unsigned manifest,
unrevoked Ed25519 enrollment and self-consistent computed public fingerprint.
Ledger ref returned404 and was not created.

Remaining live gaps: repository-variable API403 prevents independent pin/activation
flag verification; both environment secret-metadata APIs403 prevent verifying key
placement; repository installation endpoint401 requires an App JWT, so installation
scope/identity cannot be independently confirmed with this integration. No App key
was accessed. Ruleset metadata demonstrates no generic token bypass but an actual
rejected write was deliberately not attempted. Owner-side evidence is required
before operational bootstrap. Tests cannot close these live-configuration gaps.
No external/separate reviewer gate is reintroduced; owner review and separate
operational authorization remain required. CI success does not activate the queue.

### Non-paid acceptance coverage

The full database-free suite includes these deterministic boundaries. GitHub and
provider transports are synthetic; temporary Git packaging/replay is real. No
provider session, protected-ref write or privileged workflow was run for testing.

| Requested acceptance | Executable evidence |
|---|---|
| Disabled intake, invalid signature/pin/revocation, wrong repo/branch/actor | overnight-policy, overnight-production and new overnight-bootstrap tests |
| Existing/inaccessible ledger cannot bootstrap/reset; missing execution ledger fails closed | overnight-queue and overnight-bootstrap tests, real store against HTTP model |
| Dedicated App only, no generic token overwrite | RSA JWT/token repository/permission checks in overnight-ledger-auth + bootstrap tests; live no-bypass rulesets observed, actual denied write untested |
| Inspection launches no work; legacy paid entries retired; cron is not approval | overnight-queue inspection and production workflow tests, policy signed-window cases |
| Artifact cannot forge authenticated receipt | codex-pilot-receipt/validation/publish and production wrong-digest/job/scope cases |
| Duplicate dispatch cannot create twice; uncertain termination retains lock | simultaneous durable admission, lost-create/deletion-uncertainty/recovery cases |
| Publication only drafts, no merge/deploy | real temporary-Git production packaging with bounded mocked publisher HTTP; fixed-path transport rejects unrelated writes |
| Disabled config preserved, empty ledger verified, manual owner bootstrap only |32 new bootstrap cases, including post-create revocation and mandatory readback failures |

Final focused179/0/0 and full2082/0/262 intentional DB skips pass. Build, TypeScript,
lint and actionlint pass. Exact-head hosted evidence and real offline validator
smoke belong in the Issue94 / PR93 handoff; no local Docker smoke is claimed.
