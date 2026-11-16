# Overnight queue — production integration, paid activation OFF

The owner-started completion task extends draft PR91 on its existing branch.
Prepare, agent, termination sealing, real isolated validation, exact-tree draft
publication, durable completion and reporting are now connected through separate
GitHub Actions jobs. Both earlier paid entry points are retired. The configuration
shipped in this branch has no tasks, enrolled key, approval, date or signature.
No variable, environment, GitHub App, rule, ledger or live provider was configured
by implementation. No paid run or queue/reconciliation workflow was dispatched.

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
migrations remain unchanged. Validator entry identity is narrowly extended to the
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
3. Ledger ref: deny deletion/force pushes, permit updates only by owner and the
   dedicated ledger App. Exclude generic GitHub Actions and ordinary contributors.
4. Scope the App installation to this repository; minimum contents write and
   metadata read only. Keep its key isolated in the main-only control environment.

These settings are NOT assumed to exist and were NOT modified by this task.
Without them activation is blocked. Owner bootstrap is explicit: with only the
reviewed App credential in a trusted owner shell, call
`new GitHubQueueStore(await ledgerAppTransport(process.env)).bootstrap()` using
Node's transform-types loader. It refuses an existing/inaccessible ref. Never
bootstrap on a missing-ledger error from a running queue or reset audit history.

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
