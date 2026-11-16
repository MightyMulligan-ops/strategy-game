# Overnight coding queue — inactive component implementation

**Status: PARTIAL / NOT ACTIVATABLE.** This change implements the restrictive
policy, signed authorization intake, durable queue journal, GitHub CAS adapter,
offline coordinator and morning report. It does not install a paid launcher or
schedule. The shipped `config/overnight-queue.disabled.json` has no tasks, date or
authorization. Existing workflows, PR90 validator/publisher and the Issue76 pilot
are unchanged. No workflow dispatch, provider request or live ledger bootstrap
was performed. Subscription Codex authored this change; it did not run Agents API.

## Delivered boundaries

- Exact repository and owner account ID; 1–3 unique positive issues, excluding
  retired Issue76. Tasks retain exact approved order, individual approval IDs and
  digests, bounded scope text, issue title/body digest, exact file allowlist, one
  session and at most **900 seconds**. The existing 15-minute pilot limit is not
  increased to 30 minutes. Prepare/validation/publication seam timeouts retain
  5/20/5-minute limits. Timers do not establish provider termination or cost caps.
- Existing `validPath`/`canonicalScope` policy is reused, never widened: only
  explicitly listed existing-policy apps/packages TypeScript paths are eligible.
  Controller/docs/database/workflow/dependency/secret paths remain prohibited for
  queued generated changes. This infrastructure PR itself has separate owner
  authorization and does not grant future queued tasks these paths.
- One exact trusted main SHA is shared by all tasks. Every task starts from it;
  earlier draft branches never become the next task's input. Main drift stops
  the queue. No automatic rebase, source substitution or replacement issue.
- Owner authorization is an **Ed25519 signature** over the domain string
  `SOVEREIGN-OVERNIGHT-V1\n` plus canonical manifest JSON. A trusted caller pins
  the enrolled public key's SHA256 SPKI DER fingerprint OUTSIDE the manifest and
  untrusted artifacts. On every protected boundary, the collector verifies the
  signature, current owner ID/login/User/admin permission, exact main ref and
  every task's current open-issue title/body digest. Comments/labels/PR text are
  not approval sources. Paths, scope, timing, sequence and limits are signed.
- Editing/deleting an issue, changing scope/title/paths, key enrollment, baseline,
  or window invalidates authority. The collector fetches fresh GitHub state;
  worker booleans and copied receipts cannot enroll a key or grant authority.
  Mid-call revocation cannot retract work already sent to a provider. An operator
  can revoke a running authorization by stopping its run and retaining the lock;
  reviewed production intake must add an authenticated out-of-band revocation
  source before activation. No queued task can modify that source.

## One-night scheduling policy

`localDate` is an explicit America/New_York calendar date. `startsAt` must be the
unique UTC instant for **22:30 Eastern** on that date, calculated with IANA zone
data. It is 02:30 UTC the next day during daylight time and 03:30 UTC during
standard time. The start hour is outside the repeated/missing DST hour.
`endsAt` is an explicit canonical UTC instant, at most four elapsed hours after
start. Initial dispatch is accepted only in `[start,start+15 minutes)` and every
subsequent protected boundary must precede end. A later day is always refused.
Every boundary's timeout is additionally capped by the remaining approved
window, including a session begun close to its end. Unconfirmed remote termination
still retains global exclusion; a local timeout is not a billing guarantee.

There is **no cron entry**, active future date or dispatch workflow in this PR.
Scheduling support is date/window validation, not a claim that a scheduler has
been installed. A future reviewed scheduler may wake late or not at all: late
dispatch must fail closed, not roll forward. Its run attempt must be 1. Duplicate
dispatches/DST repetition also encounter the same durable one-shot claim.

## Durable state and exclusion

`GitHubQueueStore` stores one bounded ledger at
`refs/heads/sovereign-overnight-ledger-v1`, path
`.sovereign/overnight-ledger.json`. It reads content by the exact ref commit SHA.
Writes create a child commit with a unique random nonce and PATCH the ref with
`force:false`. Competing divergent children cannot both fast-forward. A CAS
conflict or unknown response stops the caller; no write or inference retry loop
exists. Missing/inaccessible/corrupt/full state is failure, never an empty ledger.
The 128-run / 256KiB capacity is finite: retention/rotation requires owner review,
preserving used authorization IDs and consumed task approvals. No reset exists.

The same atomic object holds queue/task state and a global `queue` or `pilot`
claim. A claim has **no TTL**. A session-start intent is committed before calling
the agent adapter. The record survives runner loss even if the provider session
ID is unknown. Used authorization/task IDs remain consumed after completion.

Normal states are `pending → preparing → agent_running → validating → publishing
→ draft_pr_created`. The whole queue becomes completed only after every draft is
confirmed. Failure records sanitized constant reasons and blocks all remaining
tasks. Coding success and publication success are distinct. Validation records
receipt digest/tree/checks; publication records exact draft number/URL/head.

On any failure, the global claim stays held, even if termination appears likely.
A lost runner may leave the previous in-progress record; that is an intentional
durable crash marker. On restart **do not resume the coordinator**: it refuses the
used queue/run/approval. Reconciliation cannot automatically start paid work.
If publication succeeded remotely but its response/state write was lost, report
it as uncertain and inspect the deterministic branch/remote PR before any action.

Only confirmed completion of every task releases the claim automatically. A
future operator recovery procedure must prove all associated provider sessions
terminated, reconcile GitHub drafts/branches and preserve consumed approvals,
then record an owner-authorized metadata-only recovery. This PR installs no
automatic unlock, expiry takeover or recovery-to-running command.

**Important integration gap:** the existing manual pilot does NOT currently use
this global register. Its Actions concurrency group is `sovereign-hosted-pilot`;
its simplified journal is runner-local. GitHub concurrency alone is insufficient
across workflows/crashes and can replace pending runs. Before any queue activation,
both paid entry points must use this same durable admission service, or the
legacy pilot must be independently retired/disabled. Merely giving the new
workflow the same concurrency group is not sufficient. The existing pilot is
still pinned to completed Issue76; it must never be reopened/dispatched as a test.

## Validation and publication

The offline coordinator reuses PR90's `verifyBundle` and
`verifyValidationReceipt`. A reconstruction-only receipt is not validation.
All four ordered checks (build/typecheck/test/lint), image, pinned pnpm, network,
artifact hashes, source, tree, run and attempt must match. The expected receipt
digest must come from independently authenticated successful validator-job
outputs, never from an artifact supplied by the agent. The injected adapters in
unit tests are synthetic observations, NOT independent execution evidence.

No PR90 execution code, Dockerfile, shell commands, Corepack/pnpm installation,
network confinement or publisher tree reconstruction is modified. Activation
must reuse the real PR90 validator (actual isolated commands and independent
host tree verification), not implement a second permissive validator.

The coordinator's dependency-injected adapters are **not** suitable for putting
all credentials into one process. Production jobs must remain separate:

| Boundary | Permitted capability | Required before activation |
|---|---|---|
| Prepare/control | Authenticated owner intake and durable CAS writes | Protected source, pinned enrollment, current revocation and main/scope checks |
| Agent | Provider credential in trusted controller only | No GitHub write token; start claim already durable; bounded archive/output; real termination/reconciliation |
| Validate | No provider key or GitHub write token | PR90 real networkless isolated checks, exact host tree verification and trusted job output |
| Publish | Scoped GitHub write, no provider key | Reconstruct receipt-bound tree, recheck owner/source, deterministic unique branch, one draft, no generated-code execution |

Branch format is `queue/<queueId>/<issue>-<runId>`. Each task is independent.
Once publication may have begun, no automatic second request is allowed. The
production publisher still needs a bounded remote duplicate/draft/tree lookup
and authenticated job-to-ledger receipt binding. A partial response cannot be
silently turned into another branch or PR.

## Owner setup and activation gates — all pending

1. Review/merge this inactive component PR and obtain independent security review.
2. Authorize a separate completion increment for cross-job adapters and shared
   pilot/queue admission. Retain the existing validator and separated publisher.
3. Configure a dedicated trusted controller identity and ledger-ref protection:
   reject deletion/force pushes, allow updates only by that controller and the
   owner, and keep untrusted code and ordinary contributor jobs away from its
   credentials. Do not assume current repository rules enforce this. Protect the
   approved source/main and pin reviewed controller/workflow identities.
4. Enroll the owner's Ed25519 public key/fingerprint outside task input. Keep the
   private key owner-local. Configure authenticated revocation and read-only
   owner permission/issue/main collection; an enrolled key file from a PR is not
   trusted enrollment. A mere self-signed manifest is insufficient.
5. Explicitly bootstrap the empty ledger once using the reviewed operator adapter.
   Confirm backup/audit/recovery and capacity policy. No live bootstrap in this PR.
6. Prove global exclusion across manual pilot and queue, provider-side timeout /
   deletion, unknown-create recovery, crash-safe session identity recording and
   idempotent remote publication. Tests here cover the seams with mocks only.
7. Configure only necessary job-scoped secrets/environments/approval gates; prove
   provider key isolation. Inspect actual provider project limits and current
   billing. A 900-second timer or session-count limit is not a dollar cap. No
   custom $45 gate, imaginary budget or guaranteed cost estimate is introduced.
8. Owner selects 1–3 exact OPEN issues (never76), scopes and existing-policy exact
   paths, freezes current main, and chooses ONE local date/window. Generate each
   `approvalDigest = SHA256(canonical(task without approvalDigest))`; sign the full
   final manifest. Any change needs a new signature/approval identity.
9. Only after the completion/security gates, separately authorize activation for
   that exact queue/night. No standing permission, recurring approval or retry.

Non-executable example fields: queueId `OWNER_CHOSEN_UNIQUE_ID`, authorizationId
`OWNER_APPROVAL_ID`, baselineSha `EXACT_REVIEWED_MAIN_SHA`, localDate
`OWNER_APPROVED_DATE`, task issue `OWNER_SELECTED_OPEN_ISSUE`, issueDigest
`SHA256_OF_CANONICAL_TITLE_AND_BODY`, scopeText `EXACT_APPROVED_SCOPE`, allowedPaths
`EXACT_EXISTING_POLICY_PATHS`, approvalId `UNIQUE_TASK_APPROVAL`, approvalDigest
`COMPUTED_TASK_DIGEST`, codingSeconds 900, maxSessions 1. These placeholders are
intentionally invalid as an executable manifest. The only shipped JSON is disabled.

## Inspection and morning report

Credential-free commands (no launch option exists):

```sh
node --experimental-transform-types scripts/overnight-inspect.ts manifest config/overnight-queue.disabled.json
node --experimental-transform-types scripts/overnight-inspect.ts report /tmp/owner-downloaded-ledger.json QUEUE_ID
```

The second command reads an already downloaded, bounded regular local file. It
does not fetch GitHub or provider data. Verify the ledger's source ref independently.
Generate the report after any termination, including partial failure, and retain
the durable Git ledger history beyond runner artifacts. A future workflow should
upload a sanitized report on `always()`; abrupt runner loss is handled by rendering
from durable state on a separate owner-started read-only inspection.

Reports include queue/run/attempt/baseline/digest, each issue's phase, reserved vs
confirmed session count, coding/validation/publication status, four verified
commands, draft URL, downstream blocking and reconciliation gaps. Numeric test
counts and real provider usage/billing remain UNKNOWN unless independently
collected; this receipt version does not contain them. No prompts, raw errors,
secrets, generated code or invented dollars are included. No PR is merged.

## Verification scope and limitations

Offline tests use synthetic owner keys, mock GitHub transport, fake provider and
publisher adapters and an in-memory CAS store. They execute no paid calls, GitHub
mutations, Docker, PostgreSQL or migrations. Existing credential-free CI exercises
the full unit suite and PR90's real validator smoke on its compatible hosted
runner. Its unchanged PostgreSQL job remains confined to fresh disposable service.

Known release blockers: no cross-job queue launcher/publisher wiring; legacy pilot
not integrated with global exclusion; no configured enrollment/ref protection or
revocation intake; no proven live provider cancellation/crash reconciliation;
no actual one-night scheduler. Therefore this is NOT a production-ready unattended
queue and cannot be activated by changing `enabled` alone. Completion requires
separate reviewed code and explicit owner activation. See the PR handoff for actual
command results, CI source/run/attempt and correction history.

## This task's implementation evidence

Owner source: the active uploaded “Safe Overnight Autonomous Coding Queue” request
(SHA256 `a8088ac08c84fcbde0aceb9c169d58cef5b8e52c9101883a5117827cd467ed0c`).
It authorizes this infrastructure implementation, offline verification and draft
publication with unchanged disposable-PostgreSQL CI, not paid execution/activation.
The authenticated repository account was independently observed as the owner with
admin permission. Starting main/merged PR90:
`7fd8327c77858b8f4e5bf728528021aab294c40d`. Task branch:
`feat/overnight-coding-queue`, isolated worktree; original checkout left untouched.
No queue issue was supplied; no issue or live approval was created.

Local Node24.22.1 / pinned pnpm12.18.0, AUTH_ENABLED=false RUN_DATABASE_TESTS=0:

- Frozen install, Prisma7.10.1 generation, full build, full TypeScript and lint
  passed. No dependency/lockfile changes. Install reported slow registry requests
  and an optional Pixi skill approval prompt; no skill/dependency approval changed.
- Final focused queue tests: **89 passed / 0 failed / 0 skipped**, two files.
- Final full suite: **1999 passed / 0 failed / 262 database tests skipped**,
  83 passed / 15 skipped files. These skips do not verify PostgreSQL behavior.
- Final script TypeScript check and staged diff whitespace check passed. The local
  inspection CLI reports DISABLED. Actionlint is unavailable; no workflow YAML
  changed. Task-side real Docker validator smoke was not run; the unchanged hosted
  Application CI includes PR90's actual credential-free isolated smoke.

Bounded correction history (this task only):

1. Initial focused tests84/0/0; initial direct script tsc found one widened literal
   in a new fixture and missing pre-build shared output. Corrected the fixture,
   added run/session identity and mocked CAS regressions, preserved authenticated
   session observations and aborted failed boundaries. Focused88/0/0; full
   build/typecheck/lint passed; full suite1998/0/262.
2. Final inspection found timers could exceed the remaining approved window.
   Capped every boundary by remaining window and added the near-end timeout
   regression. Focused89/0/0; final script tsc and full suite1999/0/262 passed.

**2/5 implementation corrections used; no post-review repair or CI retry.**
All session/provider/publisher observations in queue tests are synthetic. A green
PR CI does not resolve the explicit activation blockers or authorize a live night.
No existing database, task-side migration, PostgreSQL/Docker startup, paid session,
schedule, repository setting, merge or deployment was performed. Published-head
CI evidence belongs in the draft PR handoff, not an invented pass in this document.
