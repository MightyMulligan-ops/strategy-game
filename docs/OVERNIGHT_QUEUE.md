# Sovereign manual coding start

## Manual mode — November 17, 2026 candidate

The owner now requests one manual start at bedtime, no clock-based launch window
and no 300-second coding allowance. The signed v2 manifest is single-use,
manual-only, exactly one task/session, with `codingSeconds:null`, `softLimitUsd:50`
and `spendPolicy:"platform-project-limit"`. Scope, source, approval IDs, signature,
key pin, revocation, durable exclusion, isolated validation and draft-only publication
remain enforced. No merge/deployment is authorized. This change needs owner merge
before use on main; it does not start paid work by itself.

**Spending:** the $50 target uses the dedicated OpenAI Platform project's existing
spend control, not a new controller-side real-time USD meter. In Project settings
→ Limits, verify **Monthly spend limit $50** and **Enforce a hard limit enabled**.
An alert-only/unenforced soft budget does not stop work. Although enforcement is
requested, treat $50 as a soft operational ceiling because provider accounting and
enforcement can lag. It is the project's monthly total, not an additional $50 for
each run. Existing monthly spend reduces remaining headroom. The existing project
API key must belong to that project. Do not create a new/admin key for this flow.
The CLI's `--platform-limit-50` flag records the owner's verification of these
settings; it does not independently query or configure billing.

Official sources checked November 17:
[spend-limit behavior](https://developers.openai.com/api/docs/guides/spend-limits)
and [best-effort session usage](https://developers.openai.com/api/docs/guides/agents-api/observability).
Session/turn usage may be null or revised and omits some billing details. Reports
continue to say billing UNKNOWN rather than invent an exact cost or $50 guarantee.

**Runtime:** the short coding timer and hidden 13-minute HTTP stream timeout no
longer apply to v2. Coding ends at root completion, provider failure/spend rejection,
revocation detected at a protected boundary, or an infrastructure failure/watchdog.
The Agent job uses GitHub's six-hour ceiling, with a controller watchdog two minutes
earlier to allow cancellation/deletion. This is a platform ceiling, not a five-minute
work budget. A 24-hour scope lifetime measured from durable intake covers queued
prepare/seal/validate/publish jobs; it never extends at later boundaries. Validation
retains its existing bounded checks. No infinite execution, automatic paid restart,
new session, autonomous task discovery or guarantee of task completion is introduced.

The queue workflow has no cron trigger. The scheduling variable has no effect on
this version; the launch helper explicitly turns it off. Historical v1 signatures
are still parsed and validated with their original windows/limits, never silently
upgraded. V2 signatures use `SOVEREIGN-OVERNIGHT-V2\n` + canonical manifest. Scope
expiry is derived from the authenticated ledger's admission timestamp and is included
in the scope digest at reservation; every later protected boundary checks that same
digest. A modified origin, main, issue, signature, scope or enrollment stops work.

### Owner-local Windows launch for Issue #95

After the reviewed PR is merged by the owner and required CI passes, use a clean
checkout updated to the new `main`. Keep the original signed
`$HOME\.sovereign\issue95-request.json`; it supplies the frozen task description,
issue digest and two allowed files. Do not edit its base64 content by hand.
The helper refuses another active/uncertain run or any consumed original/manual
approval, preserves the task scope, and changes only the baseline, launch/spending
policy and signed approval digest. Repeated preparations produce the same one-use
IDs, so copying the old request to another device does not refill its approval.

1. Review the settings above. Retain the existing enrolled Ed25519 private key
   only on your PC. Node 24 with `--experimental-transform-types` is required.
2. From the updated repository root, prepare the new signed request. The private
   key path is entered locally and is never uploaded. The output file must not
   already exist; preserve uncertain attempts for inspection rather than overwrite.

```powershell
$ErrorActionPreference = "Stop"
$node24 = Join-Path $HOME ".sovereign\tools\node-v24.15.0-win-x64\node.exe"
$env:SOVEREIGN_GH = "C:\Program Files\GitHub CLI\gh.exe"
$original = Join-Path $HOME ".sovereign\issue95-request.json"
$prepared = Join-Path $HOME ".sovereign\issue95-manual-request.json"
$keyPath = Read-Host "Full path to your existing Sovereign Ed25519 private signing key"
& $node24 --experimental-transform-types scripts/overnight-manual.ts `
    prepare $original $keyPath $prepared --platform-limit-50
if ($LASTEXITCODE -ne 0) { throw "Preparation failed; nothing launched." }
```

Preparation performs read-only GitHub checks, verifies the old signature and
independent key pin, verifies the current owner/main/issue/ledger, signs locally and
writes the new Contents API request. It does not publish, activate or call OpenAI.
The frozen Issue #95 title/body must still match; changed task contents require a
new explicit scope approval instead of blindly refreshing their digest.

3. When leaving the PC, run this once. No particular time/date is required.

```powershell
& $node24 --experimental-transform-types scripts/overnight-manual.ts `
    start $prepared --platform-limit-50
if ($LASTEXITCODE -ne 0) {
    throw "Launch failed or is uncertain. Inspect Actions/config/ledger; do not repeat."
}
```

The start helper revalidates owner/signature/key/issue/main/ledger/config revision,
records a local attempt marker **before mutations**, disables execution and recurring
scheduling, publishes the exact signed bytes with the observed config SHA, reads
them back, enables execution and sends one manual `mode=execute` dispatch on main.
A lost response never causes an automatic retry. A dispatch acknowledgement is
not proof of a paid session or successful completion. After it is accepted, the PC
may be shut down; GitHub runs remotely. Queue delays before intake do not consume
a calendar window or coding allowance. If a preflight or mutation fails, inspect
the marker/config/Actions/ledger; do not delete the marker to retry blindly.

4. Check the matching Actions run and durable ledger/report next morning:

```powershell
& $env:SOVEREIGN_GH run list --repo MightyMulligan-ops/strategy-game `
    --workflow sovereign-overnight-queue.yml --event workflow_dispatch --limit 5 `
    --json databaseId,url,createdAt,headSha,status,conclusion
```

Inspect coding, confirmed provider deletion, validation and draft publication
separately. A budget or validation failure can stop without a draft. Uncertain
termination retains the durable lock and requires the existing explicit recovery;
no failed workflow rerun, re-signing or new approval IDs bypass that lock.

## Historical v1 integration and provisioning record

The following records describe the original calendar-based mode and setup at the
time of implementation. Their calendar, scheduling and 900-second guidance applies
only to v1. Use the manual procedure above for the current owner request. Previously
observed activation/ledger/PR states below are historical, not live status.

PR #91 is merged. Prepare, agent, termination sealing, real isolated validation,
exact-tree draft publication, durable completion and reporting are connected
through separate GitHub Actions jobs. Both earlier paid entry points are retired.
The shipped example remains disabled and unenrolled. Owner-provisioned protected
configuration now contains an unrevoked public key and disabled empty unsigned
manifest; it is separate from that example. Existing draft PR #93 prepares a
one-time non-paid bootstrap workflow and Issue #94 isolates shared-schema CI tests.
The ledger is absent at inspection; no bootstrap or paid operation was dispatched.
See the security assessment for current verified settings and precise access gaps.

The owner **waived an external/separate independent security review** for this
completion. Required sign-off is automated tests, exact-head CI, a security-focused
code/evidence review and explicit owner approval before paid activation. The task
author's security review is not represented as an independent review. Earlier
historical requirements below are superseded for this task; runtime protections
are unchanged or strengthened.

## Connected production path

`sovereign-overnight-queue.yml` is the trusted main-only caller. It admits an exact
owner-signed queue once, then invokes `sovereign-overnight-task.yml` sequentially
for indices0,1,2. Task2/3 require the previous task's **durable draft completion**
output. No recursive dispatch, issue discovery, replacement task or code stacking.
Each independent draft starts at the same exact signed main SHA. Main drift stops
protected actions; there is no automatic rebase or branch substitution.

| Job | Credentials | What it actually verifies/does |
|---|---|---|
| Intake / prepare | GitHub read + dedicated ledger App | Owner signature, current permission/issue/main, exact scope; CAS reservation; Git-tree source packaging |
| Agent | Provider key + GitHub read only | Revalidates durable claim immediately before POST; bounded network-disabled hosted session; no generated code on controller |
| Seal termination | GitHub read + ledger App; no provider key | Successful authenticated Agent job, job-output state digest, matching explicit deletion acknowledgement; durably seals identity/termination before validation |
| Validate | No provider key or GitHub write token | PR90 complete replay before trusted frozen install; actual build/typecheck/test/lint in separate networkless containers; independent host tree checks |
| Publish | GitHub draft-branch/PR write + ledger App; no provider key | Successful exact validator job/steps + trusted needs output digest, signed scope, artifact/source/tree binding; reconstruct tree without executing it, one draft, CAS completion |
| Report | GitHub read + ledger App only if recording failure | Stops downstream work, retains uncertain lock, renders current durable state even after partial failure |

All actions are SHA-pinned. The existing `ci.yml`, dependencies/lockfile,
PR90 Dockerfile/check executor/receipt format, gameplay, UI, database schema and
migrations remain unchanged. Issue #94 serializes only PostgreSQL integration
files in the test runner, preserving all per-test connection races and timeouts. Validator entry identity is narrowly extended to the
same trusted queue's scheduled main runs. Legacy publisher logic is reused with
queue-specific scope/branch/authorization callbacks; the old publisher/agent CLI
entrypoints deny execution. The old pilot's first prepare step exits1 before any
checkout or provider call; the old API smoke action/secret is removed entirely.

## Owner authority and protected configuration

The separately protected `sovereign-overnight-config-v1` ref contains
`.sovereign/queue.json`:

- `version:1`, `enabled:false` until separately approved.
- `enrollment:{publicKeyPem,fingerprint,revoked}`. Private signing key stays on the
  owner's device. Pin SHA256 of SPKI DER in owner-controlled repository variable
  `SOVEREIGN_OWNER_KEY_SHA256`, OUTSIDE the manifest/artifacts.
- `manifest`: existing restrictive v1 manifest, or the disabled empty manifest.
- `signature`: base64 Ed25519 signature, only for a separately authorized live
  manifest. Payload is `SOVEREIGN-OVERNIGHT-V1\n` + `canonical(manifest)`.

`config/overnight-production.disabled.json` is a non-executable provisioning
example. Do not treat it as approval. Configuration lives off main so its exact
main baseline can be approved without a self-referential commit hash.

At every protected boundary the production collector reads the config by an exact
observed ref commit, verifies the separately pinned key and current revocation,
owner ID353505747/login/User/admin permission, current main, each OPEN non-PR
issue's title/body digest, queue/run/attempt provenance and the retired entry
points. Unavailable, changed, revoked or partial evidence denies the action.
Comments, labels, generated text and PR prose never authorize anything.

Each of1–3 tasks has a unique issue/approval ID, explicit scope text, immutable
approval digest, exact existing-policy TypeScript path allowlist, one session and
maximum900 seconds. Task digest is SHA256 of canonical task without
`approvalDigest`; issue digest is SHA256 of canonical `{title,body}`. The queue
signature binds baseline, order, paths, limits, dates and all task digests. No
wildcards or allowlist expansion. Existing coding policy still excludes
controller/workflow/dependency/database/secret paths. Issue76 is ineligible.

To revoke, set protected config `enabled:false` or enrollment `revoked:true` (and
turn both activation variables off); scope/main changes also stop admission.
Already-sent remote work cannot be unsent by revocation. Known cleanup/recovery
uses its separate owner-signed stop approval; it never creates a new session.

## Durable state, exclusion and GitHub App

The existing CAS ledger is `.sovereign/overnight-ledger.json` on
`sovereign-overnight-ledger-v1`. Reads pin the ref SHA. Writes create nonce-bearing
child commits and use non-forced PATCH. Conflicts/unknown responses stop; there is
no retry loop, TTL, expiry takeover, history deletion or automatic unlock.
Missing/corrupt/full state is failure, never an empty ledger. Capacity remains
128 runs /256KiB; reviewed archival must preserve consumed approvals.

**Do not allow generic Actions write tokens to bypass ledger protection.** A
separately provisioned GitHub App owns ledger writes. Native Node RSA JWT code
verifies the installation's owner/App IDs, requests only repository1451525917 and
contents write, verifies returned repository/permissions/expiry and keeps its
installation token inside trusted control jobs. Agent and validator never receive
the App key. Publication uses its separate normal GitHub token for the new draft
branch/PR; it cannot bypass the protected ledger/config/main rules.

App variables: `SOVEREIGN_LEDGER_APP_ID`,
`SOVEREIGN_LEDGER_INSTALLATION_ID`. Put
`SOVEREIGN_LEDGER_APP_PRIVATE_KEY` only in environment `sovereign-queue-control`.
Put `OPENAI_API_KEY` only in separate environment `sovereign-controller`.
Both environments must allow trusted main deployments only; never expose them to
PR/feature-branch jobs. The provider key must be owner-enrolled and dedicated to
this controller; physical project binding/exclusive routing remains a manual
configuration assumption, not something inferred from a key name or boolean.

Owner must configure rulesets BEFORE activation:

1. Main: normal owner review/merge protections; no controller bypass for merge.
2. Config ref: only owner can update/enroll/revoke; no generic Actions/App bypass.
3. Ledger ref: deny deletion/force pushes, permit updates only by the dedicated
   ledger App. Exclude generic GitHub Actions, owner tokens and ordinary contributors.
4. Scope the App installation to this repository; minimum contents write and
   metadata read only. Keep its key isolated in the main-only control environment.

Settings require current evidence; implementation does not provision them. The
reviewed cloud bootstrap path is the manual **Sovereign queue ledger bootstrap
(non-paid)** workflow (`sovereign-ledger-bootstrap.yml`), backed by the existing
`GitHubQueueStore.bootstrap()` and testable `scripts/overnight-bootstrap.ts`.
There is no competing ledger mechanism or provider invocation.

### One-time non-paid bootstrap — separate owner decision required

1. Owner reviews and merges PR #93 only after required CI succeeds. This task does
   not merge, dispatch bootstrap or authorize paid activation.
2. Reverify active main/config/ledger rulesets, the dedicated App installation
   restricted to repository1451525917, and both main-only environments. Confirm
   the generic Actions token has no protected-ledger bypass. Settings evidence is
   necessary; a mock rejection is not proof of live enforcement.
3. Independently compare the owner's Ed25519 SPKI DER SHA256 against repository
   variable `SOVEREIGN_OWNER_KEY_SHA256` and protected configuration enrollment.
   The configuration's own fingerprint is not independent authority. Keep the
   private signing key exclusively on the owner's device. Confirm App IDs/key in
   `sovereign-queue-control`, provider key only in `sovereign-controller`.
4. Keep both activation variables absent/false, configuration and manifest
   `enabled:false`, exactly zero tasks, and `signature:null`. Confirm the ledger
   ref is absent. An existing ref requires inspection, never overwrite/reset.
5. Obtain **separate explicit owner authorization for this one non-paid bootstrap**.
   From Actions select the merged workflow, branch **main**, and confirmation
   **BOOTSTRAP_EMPTY_LEDGER**. Only exact owner353505747 can run it; reruns are
   rejected. Do not use a PR/feature workflow or copy App credentials into a shell.
6. Inspect its safe summary and the protected ref/file directly. Success requires
   schema1, exact repository, `active:null`, `runs:[]`, no session/approval/provider
   history and unchanged disabled configuration. The workflow reads this back and
   verifies enrollment again. If any post-create check fails or output is lost,
   inspect the remote ref; do not rerun or reset history to obtain a green result.
7. After separately approved bootstrap, owner may perform an explicitly authorized
   **inspect-only** acceptance run. Inspect must launch no provider, validator or
   publisher work. Keep both activation flags OFF and config unsigned/disabled.
   No cron trigger, green CI or bootstrap grants spending/scheduling authority.

The generic Actions token is read-only; only the dedicated App creates the ledger
ref/root commit. No provider key is referenced by this workflow. It checks current
main SHA, current owner admin permission, exact identity/event/attempt/confirmation,
independently pinned key, disabled empty manifest and null signature. It refuses
existing/inaccessible state through the existing store, with no automatic retry.
If GitHub metadata APIs cannot reveal variable/secret/installation settings, record
that gap and obtain owner-side evidence before operational bootstrap.

## Time and scheduler

`localDate` names one America/New_York night. Start must equal the unique IANA
22:30 instant (02:30UTC next day in daylight time,03:30UTC in standard time).
Dispatch grace is `[start,start+15 minutes)`; the explicit UTC end is at most four
elapsed hours later. Task order is signed. No later-day rollover or cron approval.
Every protected boundary checks expiry. Agent creation uses the lesser task/window
allowance minus120 seconds reserved for bounded export/cleanup: at most780 seconds
of session streaming for a900-second task. The whole agent job is capped15 minutes.
If the remaining allowance cannot cover cleanup, no session is created. Absolute
window end is also applied after fresh pre-create verification.

The caller has02:30/03:30UTC wake-ups, but **no scheduled job can run unless BOTH**
owner variables `SOVEREIGN_OVERNIGHT_ENABLED=true` and
`SOVEREIGN_OVERNIGHT_SCHEDULE_ENABLED=true`. Neither was configured in this task.
The config also remains disabled and unsigned. The second UTC wake-up is early or
outside grace, not another approval. Duplicate dispatch/run attempts also encounter
the durable one-shot claim. Actions concurrency is defense in depth only; it can
replace pending runs and does not survive as an exactly-once session ledger.
GitHub can delay/drop schedules; late dispatch refuses paid work.

## Provider uncertainty and recovery

`QueueSessionProvider` records not-started, creating, active, root-completed/failed,
unknown and explicit-deletion-confirmed states. Stream closure, local timeout,
runner termination, GET404 and unfamiliar provider status are NOT termination
proof. Creation POST is never repeated. Known sessions use the existing bounded
cancel/delete cleanup and require the matching explicit deletion acknowledgement;
cleanup retries never create sessions. Missing IDs leave an unknown reservation.
Provider state artifacts survive ordinary job failures; an abrupt runner loss can
leave only the durable pre-session intent. Both block future paid tasks.

Successful Agent state is authenticated through job outputs/metadata and sealed
into the ledger before validation. Thus validation/publication failure cannot
silently discard already confirmed termination. Unknown failure keeps the global
claim until owner-authorized recovery. No automatic resume or refill of approvals.

`sovereign-overnight-reconcile.yml` defaults to non-provider inspection. Its
`terminate_and_reconcile` mode requires `.sovereign/reconcile.json` on protected
config ref, with a separate Ed25519 signature over
`SOVEREIGN-RECONCILE-V1\n` + canonical request. Request keys:
`version:1, action:"stop-and-release", approvalId, queueId, previousRunId,
ledgerRevision, expiresAt, sessionIds, neverStarted`. Expiry is at most one hour
away. IDs/indices must exactly cover the durable original reservation.

The original workflow must be completed. A missing session ID can be classified
never-started ONLY if authenticated original Actions metadata proves the Agent
job or its provider step was skipped. A crash after the provider step began with
no ID cannot pass recovery. An arbitrary owner-supplied ID is not a substitute.
For known IDs, prior sealed deletion evidence or new matching delete acknowledgements
are required. The provider recovery job has no GitHub write capability. A separate
key-free commit job authenticates its successful step, trusted output digest,
request/run/revision/IDs, then CAS-stops the old queue and releases exclusion.
Historical approvals and prior status/phases remain recorded and consumed.

If creation response/ID was lost, or the API cannot confirm deletion, the API does
not provide this implementation a safe exhaustive lookup. The lock remains held
and unattended work remains blocked; provider-assisted owner investigation may be
necessary. Neither404 nor elapsed time permits unlock. Lost publisher responses
also stop; existing branch/PR reconciliation verifies exact source/tree/metadata,
never blindly POSTs again. Recovery does not resume remaining tasks or authorize a
second PR. Owner must separately inspect any remote draft missing from the ledger.

## Reports, testing and owner acceptance

An always-run final control job records failed/stopped downstream tasks and emits
sanitized Actions summary plus30-day report artifact. Durable Git history remains
the recovery source if the runner/report job itself disappears. Reports distinguish
reserved starts from confirmed IDs, coding from validation/publication, own constant
failure reasons, verified checks, PR URLs and blocked tasks. Case counts and real
billing remain UNKNOWN if absent from trusted evidence; no $45 gate or dollar
estimate is invented. Artifacts/logs are not an authorization service.

For an interrupted run, owner can export the exact ledger file through authenticated
GitHub GET, then run the existing credential-free local command:
`node --experimental-transform-types scripts/overnight-inspect.ts report FILE QUEUE_ID`.
It performs no provider call or GitHub mutation. Never rerun paid work to get a report.

Initially NON-PAID acceptance procedure:

1. Review this diff and its security assessment; verify exact-head normal CI,
   including PR90's real isolated validator smoke and fresh PostgreSQL tests.
2. Run focused production-interface tests, full tests/build/typecheck/lint and
   actionlint. Interfaces exercise real Git packaging/replay/index reconstruction,
   JWT verification, mocked GitHub CAS/jobs/publisher and synthetic provider HTTP.
   Simulated isolated outcomes are not proof of live provider behavior.
3. Keep both enable variables false and manifest disabled. After owner review/merge,
   dispatch `inspect` only; verify no intake/agent/validation/publication runs.
4. Provision/review the protected App, refs, environments and signing enrollment.
   Test App access/explicit empty-ledger bootstrap in an owner-approved non-paid
   administrative operation. Inspect the ref rules as a contributor and verify
   generic Actions tokens cannot update/reset the ledger. This task does not alter
   settings or create that ledger.
5. Use offline fixtures for unknown creation, timeout, forged receipts and lost PR
   responses. Do not reuse completed Issue76 or fabricate a live approval.
6. Only after these checks, owner separately approves exact issue scopes/paths,
   current main, one night/window and explicit paid activation. Provider contract,
   credential/project binding, actual cancellation, GitHub job naming/permissions
   and scheduler delivery need operational confirmation; mocks do not certify them.

One-night setup checklist: choose1–3 OPEN eligible issues; freeze title/body and
scope digests; use one exact current-main baseline; assign fresh approval/queue IDs;
compute task digests and UTC window; sign owner-local; place full config on protected
ref; verify current key pin/revocation and no existing active/uncertain claim; owner
explicitly authorizes that night; only then enable both scheduling variables. Disable
them/config after completion or revocation. Never enroll a key or grant from PR text.

No external security-review gate is reintroduced. Activation still requires the
owner's review of delivered tests/code/evidence, essential manual configuration and
separate explicit paid authorization. No readiness or billing guarantee is claimed
for operational assumptions that have not been exercised.

## Foundation handoff — historical, superseded operational status

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
