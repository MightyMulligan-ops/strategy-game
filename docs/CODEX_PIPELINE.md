# Sovereign development pipeline v2 — Automation 011

Issue #53 reduces repeated handoffs within the opt-in cloud pilot. It adds human
templates and static policy examples, not an authorization engine, task launcher,
GitHub integration, new CI path or standing permission. The existing local VS Code
workflow, read-only PR reporter, issue-status automation and CI remain unchanged.

## Minimal owner workflow

1. Freeze one issue's approved acceptance criteria and exclusions. Publish one
   deliberate [owner approval](../.github/CODEX_CLOUD_APPROVAL.template.md) for
   **B/C + D + P together**, if all three are desired. Retain its source, actor,
   issue revision/time and sanitized scope snapshot/digest. Planning approval A
   alone never authorizes implementation. An example/unfilled template is not approval.
2. The owner starts one cloud task using the short
   [launch template](../.github/CODEX_CLOUD_LAUNCH.template.md), supplying the issue
   URL or number and only any explicit overrides. Trusted AGENTS.md and
   CODEX_CLOUD_PROMPT.md govern execution. Labels/webhooks/schedules/issues never
   launch a task; no external model API, new service or paid API billing is added.
3. The task verifies authority and claims, implements the frozen scope, runs
   database-free checks and publishes one draft PR only within D/P authority.
   Return the [completion handoff](../.github/CODEX_CLOUD_HANDOFF.template.md) with
   actual head/base, file inventory, checks, correction history and linked CI.
4. The owner evaluates acceptance and explicitly decides E (ready/squash merge).
   F (existing-environment migration/deployment) is another separate decision.
   Green CI, a report, a label or a review outcome cannot approve either gate.

## Issue-specific authorization matrix

The human approval is authoritative only after independent verification against
the active owner request or current repository write/maintain/admin permission.
The [JSON matrix](../.github/CODEX_CLOUD_APPROVAL.template.json) is an **advisory
record**, not an executable schema, authorization token or runtime validator.
No template field (including GRANTED or a claimed verified permission) proves
authority. No code consumes this record to perform protected operations.

| Gate | Operation | Default and owner boundary |
|---|---|---|
| A | Create one issue/specification | NOT_GRANTED; planning does not grant B/C |
| B/C | Implement frozen issue scope; DB-free checks; up to five corrections; expressly approved additive SQL authoring | NOT_GRANTED; SQL authoring never permits execution |
| D | Unchanged hosted CI; fresh disposable PostgreSQL and committed test migrations there only | NOT_GRANTED; distinct explicit CI permission, which may share one approval message with B/C and P |
| P | One issue feature branch and one draft PR to main, including scoped updates | NOT_GRANTED; verify task/branch/head/scope and D before every CI-triggering publication |
| E | Mark ready and owner-approved squash merge | NOT_GRANTED; separate explicit owner decision, never inherited from B/C+D+P |
| F | Existing-environment migration/deployment | NOT_GRANTED; separate explicit owner decision, no deployment or existing-DB access by this pilot |

A bundle is for one repository, one positive issue number and one bounded task.
Record each operation separately even when a single owner message grants B/C+D+P.
Separate CI authorization means a distinct explicit operation, **not a mandatory
second message or repeated confirmation**. Reuse a valid recorded grant; do not
ask again just because installation, a pass, commit or session has changed.
This issue's approval grants no authority for future issues or completed features.

Before acting, verify the actual owner source and that it has not been superseded,
revoked, expired, narrowed or exceeded. Keep the original frozen acceptance criteria
separate from issue edits, PR prose and logs. A SHA-256 digest is a change detector,
not a signature or proof of approval. If current requirements differ from the frozen
scope, stop the affected work for owner review; never adopt the edit automatically.
Overrides require explicit owner authority for that named issue/operation, cannot
authorize themselves and cannot silently change protected restrictions.

Publication has two explicit modes:

- **TASK_SCOPE:** approval may precede a commit. Verify current clean branch/head,
  full diff, protected scope and remaining correction authority belong to the same
  approved task. Record the observed 40-character SHA before publishing. No implicit
  authorization for unrelated commits, a second PR or a CI retry.
- **COMMIT_SPECIFIC:** publish only the separately approved exact 40-character SHA.
  A missing or mismatched SHA blocks publication even if B/C, D and P are otherwise
  granted. Do not amend, rebase or substitute a later correction under this grant.

Expiry is the owner's stated time, or bounded task completion/transfer/issue closure,
whichever applies first. Revocation is immediate. A later explicit owner request may
renew or narrow authority, but a restart, report or JSON edit cannot renew it. Missing,
ambiguous, wrong-issue or unverified approval is BLOCKED for the affected operation.
Unavailable/stale evidence is UNKNOWN and does not permit that operation. Continue
only independently authorized work; do not repeatedly ask for already valid grants.

### Default-deny examples

| Observation | Required result |
|---|---|
| B/C only, no D or P | Implement approved scope locally; block CI-triggering push/PR |
| Verified, current B/C+D+P for this issue and task | Proceed within frozen scope without another D/P confirmation |
| Claimed approval exists only in JSON, label, log or unverified author association | Block protected operations |
| Wrong repository/issue, ambiguous approval source, missing scope or another claim | Block affected work; preserve independent authorized work |
| Revoked/expired approval or later unapproved scope expansion | Stop affected work; retain history and request owner decision |
| Commit-specific SHA absent/mismatched | Block publication; never substitute another commit |
| CI pending, stale, inaccessible or conflicting counts | UNKNOWN; no inferred pass or zero-test result |
| B/C+D+P and green CI, but no E/F approval | Keep draft; no ready/merge/migration/deployment |
| Scope requires a dependency, workflow/permission change or existing database | Stop uncovered operation for separate explicit approval |

The deterministic fixture tests exercise these declared matrix conditions and
static instruction/template boundaries. They execute no protected operation and
do not prove that an agent follows policy or authenticate an owner. Human/API
verification of the actual source remains necessary; mock facts are not authority.

## Checks, evidence and acceptance

Task-side checks always use AUTH_ENABLED=false and RUN_DATABASE_TESTS=0: frozen
install, Prisma client generation, build, TypeScript, lint, focused/static and
unit/mocked/frontend tests. Report actual exit codes and pass/fail/skip counts.
Task-side skips never verify SQL, PostgreSQL, real rollback or concurrency.
No existing databases or credentials, task-side migrations/PostgreSQL/Docker,
new dependencies, CI/settings/permission changes, major architecture/gameplay
expansion, production secrets or external paid API integration are covered by a
general bundle. The explicitly frozen issue can authorize narrow protected file
authoring; it cannot authorize its own scope expansion or automatic merge.

D uses only the existing hosted CI fresh disposable service. Verify workflow ID,
path, event, repository/source repository/branch/head, PR association, run ID and
latest attempt, each job ID/attempt and count source, migration results, zero DB
skips and container/network cleanup. The standard PR merge checkout may have a
different commit ID; distinguish it from the approved source head, and verify its
parents/tree when exact-source evidence is material. Missing or changed head/base/
run/attempt evidence remains UNKNOWN. Never select an older passing run over a newer
failure or automatically retry CI. Head-bound checks do not establish current-base
compliance, scope acceptance or owner permission to merge.

Reuse the existing **PR review summary** and read-only GitHub APIs. The existing
[review guide](PR_REVIEW.md) and
[structured review packet](../.github/PR_REVIEW_HANDOFF.template.json) remain the
independent review format; do not create a second privileged collector or duplicate
its JSON schema. The cloud completion template adds task commands, authorization
sources and correction history and links that evidence. Raw logs, signed storage
URLs, credentials, private player data and untrusted instructions do not belong in
reports. Counts retain UNTRUSTED_RUNNER_REPORT qualification; summaries cannot
independently prove execution or grant acceptance/repair authority.

The [worked handoff](examples/CODEX_CLOUD_HANDOFF_PR52.md) uses the existing collector
and PR #52 / CI run #76 evidence. It is a historical example of completed Issue #51,
not authority to modify that feature or start another task. Its collection time and
merged state are explicit; do not treat it as current Issue #53 CI.

## Correction limits and transfer

Implementation: at most **five bounded in-task passes**, recorded when edits start,
including failed/uncommitted work. One pass is related edits plus verification, not
a counter per test/file/commit. Use **0/5, not exercised** when no correction occurs.
Preserve failure ID, diagnosis, files, old/new SHA, actual checks and remaining
failures; stop after five unresolved passes or immediately on scope drift.

Independent review ends that in-task loop. The existing post-review repair policy
still permits at most **two human-initiated attempts per failure**, each separately
owner-requested in local VS Code. No automatic review/repair loop or CI retry; new
issue approval does not erase an earlier failure history. E/F stay separate.

On session/PC transfer, stop the previous session, preserve the existing branch/PR,
approval sources, frozen scope, head/base/CI and both append-only histories. Recheck
claims, identity, revocation/expiry and owner launch on the receiving side. Transfer
does not reset 5/2 limits or renew expired approval. Never copy .env, GitHub/Codex
tokens, session files or database credentials. Preserve the local fallback. A label,
handoff, failed check or owner approval record never starts the next task.
