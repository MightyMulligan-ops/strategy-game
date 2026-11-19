# Manual paid runner: GPT-6.2 Astra

This update implements a separately signed, manually started execution mode. It
is source code for review; no paid run or remote configuration change is implied.

## Behavior

- Model pinned to `gpt-6.2-astra`; high reasoning, standard service tier, subagents
  disabled. Preflight checks exact model access before source upload/session POST.
  There is no fallback to an older or cheaper model.
- Manual dispatch at any time within the owner's signed validity period. No
  22:30 Eastern start or 15-minute launch grace for this mode. Legacy nightly
  manifests retain their original rules and cannot acquire the new privileges.
- One task and one session. No automatic retry, parallel run or lock expiry.
- Stop at completion or estimated $50 soft task cost. Poll authenticated session
  usage every 15 seconds; store sanitized counts/estimated cost and stop reason.
- A 5-hour operational watchdog and 6-hour signed validity period protect against
  stalled work. These replace the old 300/900-second coding caps for manual mode;
  GitHub's agent job has a 360-minute emergency timeout.
- Missing session identity stops after 120 seconds without guessing its ID.
  Null usage has a 120-second startup grace. Invalid/mismatched readings or failed
  monitoring stop work; unknown accounting is never recorded as zero.
- On stop, abort transport and explicitly delete a known session. Uncertain
  creation/deletion retains the durable claim and requires reconciliation.
- Workers refresh their patch/manifest/summary after coherent stages. Only a
  completed root turn and confirmed deletion can deliver a proposal. A stopped
  incomplete turn is not publishable; partial checkpoint recovery is not yet an
  automated continuation feature and may be unavailable after deletion.

## Soft cost estimate, not an invoice

OpenAI's session usage is best-effort and can lag/change. It excludes separate
cache-write counts. The guard uses conservative standard-tier long-context rates:
36 micro-USD per input token (16 input + 20 potential cache write), 60 per output
including reasoning, and $1.92 per started 20-minute container interval (largest
published container price, rather than assuming the medium mapping). It ignores
cache discounts. It can stop noticeably before the actual bill reaches $50;
delayed/missing accounting and cancellation can also allow overshoot. No hard
spending guarantee or exact total project/monthly usage claim is made. No billing
settings are changed. Additional API tools and subagents are not enabled.

References verified against official documentation:
- https://developers.openai.com/api/docs/models/gpt-6.2-astra
- https://developers.openai.com/api/docs/guides/agents-api/observability
- https://developers.openai.com/api/reference/python/resources/beta/subresources/agents/subresources/sessions/methods/retrieve
- https://developers.openai.com/api/docs/pricing

## Signed configuration

The existing owner signing/enrollment mechanism is unchanged. Add this exact
object to the signed manifest (not to worker-provided metadata):

```json
"execution": {
  "mode": "manual-cost-v1",
  "model": "gpt-6.2-astra",
  "softLimitMicroUsd": 50000000
}
```

Use fresh startsAt/endsAt ISO instants, at most six hours apart, and one task with
codingSeconds=18000 (now the operational watchdog for this mode), maxSessions=1.
Use the exported MANUAL_FORBIDDEN_PATHS and MANUAL_FORBIDDEN_OPERATIONS arrays,
exact issue title/body digest, unique approvals, exact main SHA and exact paths.
Re-sign the complete manifest using the already enrolled owner key. This document
is not a signature. Expired issue95 authority must never be reused.

Manual feature proposals use the signed-derived `city-feature-v1` scope profile:
up to 128 explicitly named application TS/TSX/CSS/JSON, database source/tests,
Prisma schema, new migration.sql files and docs Markdown. No wildcard paths.
Existing migration edits, deletion/rename/type changes, secrets, executable
controller/workflow/dependency changes and instruction files remain denied.
The scope profile is hashed into authorization, receipts and publication checks;
the replay independently enforces it. Legacy scopes retain the 25-file TS boundary.
Migration files are source only: no existing database access or task-side SQL.
Changed Prisma client generation occurs only inside the separate isolated validator.
Existing fresh-disposable PostgreSQL PR CI remains unchanged and separately required.

## Activation and verification

Merge/review of the runner, protected config signing, live ledger/session
reconciliation, account model access and paid dispatch remain separate operational
steps. No signing key, provider key or permission setting is provisioned here.
Do not dispatch the old signed task or represent this local update as live activation.
The latest Sovereign UI branch and approved recruitment decisions still need to be
included in the feature's frozen source before launching that separate task.

Local evidence on the existing command-UI baseline:
- Build, full typecheck and lint passed.
- Full suite: 2,436 passed, 18 failed, 326 deliberate database skips. Failures have
  the same Windows Python execution, Unix socket and URL-path causes observed
  before this task. This is not a green full-suite claim.
- Eight focused runner suites passed 167 tests, including cost-stop, missing
  identity/usage, cleanup uncertainty and isolated-client generation cases.
- Python replay has five new feature-profile security cases (24 total), but no
  Python interpreter is installed/usable here; exact-head Linux CI must execute them.
- No real API request, billing access, Docker/database startup, paid execution,
  configuration mutation, merge or deployment was performed.

Correction history for this runner task: 1/5 used to update stale model fixtures
and permit dotted database test basenames in both TS/Python profile validators.
Earlier command-interface and combat histories remain unchanged.
