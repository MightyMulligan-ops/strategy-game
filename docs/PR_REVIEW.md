# PR summaries and CI diagnostics (Automation 008 / Issues #32 and #34)

This is deterministic reporting, not an AI reviewer or agent runner. It reads GitHub metadata and CI evidence and writes an Actions **run summary** plus two Markdown handoff files in the `pr-review-summary` artifact (seven-day retention). It never comments on PRs, updates labels/issues, edits code, retries jobs, commits, merges, deploys or starts Codex. Existing CI and issue-status workflows are unchanged. No dependency, OpenAI API key/billing, production credential or repository setting is added.

## When it runs

`pr-review.yml` listens for completion of the existing **CI** workflow on PR events, and offers a maintainer-only manual dispatch with `pr_number`. It does not use a PR-event write token or `pull_request_target`. The workflow is active on main following PR #33 (`ad1a3ff`). Reporter fixes become active only after human merge; draft changes are verified with mocked API/security tests and actionlint, never by privileged execution of an unreviewed feature workflow.

After merge, find **Actions → PR review summary → Run workflow**, select **main**, enter the PR number and run. Write/maintain/admin permission is rechecked via GitHub before manual collection; permission lookup errors fail closed. Keep the existing two required code checks; this report is advisory and should not become a required CI check. No Actions PR creation/approval setting needs enabling. Existing pinned checkout/setup-node/upload-artifact actions are reused.

Both events are gated to this repository and main. Checkout uses the trusted event's default-branch `github.sha`, never a PR head/merge ref. The job has only contents/PR/issues/Actions **read** permissions, no dependency installation, caches, PR-code import, secret inputs or artifact extraction. Its short-lived GitHub read token is used only for GitHub API requests. Log-storage redirects receive no Authorization header and must use approved HTTPS GitHub/Azure storage hosts. All network operations are GET, bounded and timed out.

GitHub documents the [workflow_run default-branch behavior and untrusted-code risks](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) and [Actions-read job-log endpoint](https://docs.github.com/en/rest/actions/workflow-jobs#download-job-logs-for-a-workflow-run). These are why this workflow uses trusted source and no PR-code/cache/artifact execution.

## Report and evidence rules

The report records PR number/link, current head/base commits, draft/open/closed/merged state, validated same-repository issue relationship and managed labels, changed paths/status/+/- counts, protected-change flags, CI run/attempt/job conclusions, failure links, bounded diagnostic codes and existing failure-artifact links. PR titles, descriptions, patches, commit messages, arbitrary job/step names and logs are never copied into output. The only body processing is a conservative matching standalone `Closes #N` relationship on an `issue/N-slug` branch; fenced/comment examples and ambiguous relationships do not count. This never authorizes work or changes issue status.

- Open or draft PRs remain **unmerged**, including with green CI or a closed issue. Only GitHub's merged field establishes merge. Labels never prove owner approval, progress completion or correctness.
- CI must be the configured workflow ID/path, PR event, same repository/PR/head/source repository, exact source branch and latest attempt. The newest created same-source run for that head is considered; an unprovable association never falls back to an older success. Re-fetch head/base/state/source identity and run/attempt before publishing; changed evidence fails closed. Head-bound evidence does not claim branch-protection/up-to-date-base compliance or code correctness.
- Missing, queued, inaccessible, ambiguous or stale evidence is **unknown**, not success or zero tests. The report may show pending jobs; it is a point-in-time snapshot, not a polling service. Verify the SHA again before using it.
- Only one well-formed Vitest numeric summary per job is reported, with valid nonnegative totals/statuses and an explicit job link. Multiple/contradictory summaries are withheld. Counts are explicitly **untrusted CI log reports**, not independent proof of execution; PR code can forge output or change checks. No totals are taken from PR prose. Existing disposable-DB CI's execution guard remains authoritative within CI; the report does not replace it or assert a new audit.
- Failed step names are allowlisted; other names are withheld. Diagnostic text is an allowlist projection: TypeScript numeric codes and a few known pnpm/connection/Prisma codes only. It emits no raw lines, stack traces, assertions, environment dumps, URLs, usernames, player data or credentials. Unknown failure details stay behind GitHub job links. This trades detail for a stronger privacy boundary than regex-redacted excerpts.
- Existing `application-failure-logs` / `database-failure-logs` artifacts are linked through their CI run, never downloaded or executed. Their label is not a safety guarantee; inspect them as untrusted data. Expired/inaccessible artifacts/logs are reported as unavailable. Raw logs and signed log URLs are processed only in memory, never saved as report artifacts.

Files are paginated up to GitHub's 3,000-file limit; both sides of renames are classified even beyond the first 60 displayed rows. Incomplete inventories explicitly leave protected coverage unknown. Unsafe/sensitive paths, token-shaped names and Markdown/control-character names are withheld. Flags cover authentication/session security, authorization boundaries, schema/migrations, CI/diagnostic policy, agent instructions, dependencies/approvals, deployment and gameplay/contracts. This is a conservative path policy, not semantic diff analysis or an exhaustive secret scanner. Names without recognizable sensitive patterns can still be sensitive; never put credentials into GitHub metadata in the first place.

API responses are capped at 4 MiB, job logs at 2 MiB, jobs/run discovery at 100. Oversized or malformed core data stops the report; unavailable optional logs/artifacts leave evidence unknown. No failure prints raw API/parser exceptions. Forks can receive read-only metadata reports but do not acquire a trusted issue claim or repair authority. Missing fork run associations are not guessed from branch names.

## Read-only acceptance packet (Automation 012 / Issue #55)

The existing trusted-main collector now derives **sovereign-pr-acceptance-v1** from
the same metadata and two bounded job-log reads. Find the evidence table directly
in **Actions → PR review summary → run summary**, or download its existing
`pr-review-summary` artifact: `report.md` contains the human summary; `handoff.md`
contains the same bounded advisory JSON in a fenced block. Workflow YAML, triggers,
checkout, permissions, artifact paths and CI execution are unchanged. New reporter
code becomes active in the hosted trusted-main workflow only after owner merge;
an unmerged feature is verified with deterministic fixtures/read-only previews.

Each check is **PASS**, **FAIL**, **UNKNOWN** or **NEEDS_OWNER_REVIEW**. There is no
overall acceptance decision: `acceptanceDecision=NOT_MADE`, ready/merge, deployment
and repair remain `NOT_GRANTED`. PASS means only the named evidence agrees, not
that code is correct or that the owner authorized its scope. The minimal remaining
owner action is to inspect the packet and relevant diff, verify frozen scope and
approval sources, then explicitly decide ready/squash merge. Deployment stays separate.

The packet binds PR/repository/source branch/head, PR base, current main tip,
configured workflow ID/path/event, run/latest attempt, required job IDs/URLs and
per-job passed/failed/skipped/pending/todo counts. It rechecks current main, PR
identity/state/base, issue snapshot and newest run discovery after collection.
Changed identity/base/scope, a newer run or a changed attempt invalidates the
snapshot; optional inaccessible evidence stays UNKNOWN. A newer pending/failing
run never falls back to an older success. Incomplete discovery/job/file inventory
is explicit, not a passing complete packet.

Source HEAD is distinct from the **synthetic PR merge checkout**. A bounded,
allowlisted checkout log marker supplies a commit prefix; the GitHub commit API
corroborates its full SHA and ordered base/source parents. Every required job's
parents must match the current source head and current main, and PR base must
agree, before current-base evidence passes. Missing/ambiguous markers, unavailable
parents or an advanced main remain UNKNOWN. This is point-in-time consistency,
not branch-protection/up-to-date-base enforcement or an independent checkout audit.

PostgreSQL evidence requires positive matching runner counts, zero failed/skipped/
pending/todo, a successful execution-guard step and exactly one matching no-skips
guard report. Empty/ambiguous/unavailable counts are UNKNOWN, never zero or PASS.
Application-job DB skips remain visible and never establish SQL success. Separate
checks require initialization metadata/service-init marker, successful migration
step plus a complete positive application report, and successful Stop containers
plus container and network removal markers. Missing migration/cleanup evidence
cannot pass. These markers and test counts retain **UNTRUSTED_RUNNER_REPORT**
qualification; GitHub job conclusions are separate API metadata. Neither independently
proves runtime behavior; VM lifecycle remains GitHub-managed.

Only canonical same-repository issue/comment links and a bounded issue-body digest
are retained as **UNVERIFIED** approval candidates. Up to 100 comments/10 candidates
are examined; no prose, author-association claim, label, advisory JSON or green CI
authenticates owner authority. Compare the digest/source with the separately frozen
approved scope. Reporter code never parses a grant into operational permission.
Protected categories include instructions/security, database/migrations, dependency
and lock files, CI/permissions, gameplay/runtime/contracts and infrastructure; both
rename paths are classified. Missing/withheld paths remain UNKNOWN. Owner scope
review is still required even when no path category is flagged.

JSON is capped at 1 MiB; a larger file inventory is shortened to 60 entries with
inventory completeness UNKNOWN. Up to 3,000 files are still fetched/classified by
the existing collector. Only fixed vocabulary, validated IDs/hashes, sanitized
paths, counts and canonical URLs leave the collector. It emits no raw issue/PR/log
text, migration names, service identifiers, secrets or signed log-storage URLs.
No second reporter, new artifact extraction, AI agent, GitHub write, retry, PR
comment/check/status write or database execution is introduced.

## Read-only triage and exact-head handoff (Automation 013 / Issue #57)

The same collector and formatter now add `sovereign-pr-triage-v1` inside the
existing acceptance packet. The Actions summary/report.md shows a deterministic
category, individual reason codes, check names and canonical PR/run evidence links.
The existing handoff.md contains one bounded owner-copyable text prompt and the
same JSON. Workflow YAML, permissions, triggers and artifact paths are unchanged;
no second reporter, bot, model call, agent launch, write automation or review service.

Triage evaluates **evidence readiness for manual review**, never acceptance,
correctness, owner authentication, code findings or permission to mark ready/merge:

| Category | Meaning and permitted recommendation |
|---|---|
| REVIEW_READY_EVIDENCE | All nine factual checks pass consistently; an open same-repository PR, issue snapshot and an approval-candidate source are available. Manually review the exact-head diff, scope and actual owner source. Protected files and UNVERIFIED authority still require owner review. |
| INVESTIGATE | Evidence checks demonstrate a failure without structural/missing-evidence blockers. Manually investigate the cited CI/count/skip failure; it is not yet a confirmed code defect or a repair grant. |
| BLOCKED_UNKNOWN | Missing/stale/mismatched/contradictory identities or evidence, a fork, unavailable issue/approval candidate, truncated/withheld inventory, or non-open PR. Gather current evidence manually; do not reuse an older success. |

Blockers take priority over failures, and failures over review-ready evidence.
Every failed/unknown check retains its reason, even if another reason determines
the category. Protected scope is a review question rather than an automatic defect.
`codeReviewFindings=NOT_EVALUATED`, `repairAuthorization=NOT_GRANTED` and the existing
`acceptanceDecision=NOT_MADE`/E/F exclusions remain explicit in every category.
New commits, changed main/base or issue scope, newer runs/attempts, truncated or
missing evidence, ambiguous associations and PostgreSQL skips invalidate reuse.

Approval availability is deliberately weaker than authorization: a bounded body
marker such as owner-approved/approval status, or an existing approval-candidate
comment, records only that a source can be inspected. It never interprets B/C/D/P
operations, authenticates the author or grants authority. Missing/unavailable
candidate evidence blocks review readiness; malicious prose can still claim
approval, so the actual source and frozen scope always require manual verification.

The review prompt pins canonical PR/issue, source head, PR base/current main,
run/attempt, relevant check states, up to six sanitized protected paths (including
renames) and three fixed review questions. It is capped at 4,000 characters; path
display is omitted first if necessary, preserving identities and prohibitions.
It reads no instructions from issue prose, filenames, log text or artifact URLs.
Before reviewing, re-fetch the complete identity/evidence; any missing/changed
expected identity stops with UNKNOWN. Review-only text forbids edits, PR execution,
comments/check/status/label writes, CI retries, agent launches, database/credential
access, merge and deployment. Any bounded repair needs a separate owner request
after actual findings; the existing five/two histories are not reset or combined.

Live Automation 012 validation is observational: inspect an already-existing
eligible trusted-main report at/after PR #56 merge, its summary/report.md and
handoff.md packet, identities, check states and DB guard/migration/cleanup evidence.
A skipped run or a local preview is not live validation. If no eligible executed
run/artifact exists, record PENDING/UNKNOWN and do not dispatch a workflow merely
to obtain proof. Unavailable evidence does not block separately authorized
database-free implementation/unchanged CI. New triage formatting itself becomes
live only after this issue is owner-merged into trusted main.

## Missing run associations (Automation 008A / Issue #34)

GitHub returned `pull_requests: []` for successful CI run [43265346907](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43265346907), on merged PR #33 head `9f59b9652189e57371d0f93bde22fe652f87c572`. The original reporter therefore showed unknown CI. An absent array association does not prove the absence of PR CI.

Manual dispatch first validates the requested PR through `GET /pulls/N` after checking the actor's current write/maintain/admin permission. Both manual collection and automatic `workflow_run` recovery accept an **empty array only** through this bounded fallback:

1. Validate the configured repository, workflow ID/path, `pull_request` event, head SHA, source repository and nonempty source branch. Automatic triggering additionally requires the requested run ID and a completed run. Missing associations on fork runs remain unavailable; explicit, unique fork associations retain their existing read-only metadata support.
2. Read `GET /repos/<configured-repository>/commits/<validated-head-sha>/pulls?per_page=2`. Require exactly one result. Two or more candidates, including duplicates or candidates for different branches/bases, are conservatively ambiguous; no pagination or candidate guessing follows. Zero results, malformed responses or lookup failures remain unavailable.
3. Re-fetch that candidate with `GET /pulls/N`; validate its number, main base/repository, state, current head/source repository and branch against the run. Manual collection also requires it to be the **requested PR**. A matching SHA alone, branch name alone or relationship in PR prose is insufficient. Merged PRs can qualify using their retained head metadata without requiring the source branch still to exist.
4. Repeat attribution on run re-fetches, including immediately before publishing; do not cache the initial uniqueness proof. Preserve job run-ID/attempt checks and final PR identity/state checks. A conflicting or multiple nonempty run association cannot be overridden by this fallback.

The [commit-to-PR endpoint](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit) uses the existing PR-read permission. GitHub documents different result coverage for commits present in the default branch; its result is evidence, not an exhaustive historical membership search. The fallback can intentionally leave evidence unknown, especially for reused commits, inaccessible/deleted source metadata, forks or unavailable commit associations. It never broadens permissions, queries untrusted URLs, reads PR code, retries CI or changes log handling. Manual reports retain safe metadata with an unavailable note; automatic discovery that cannot establish a unique current PR fails closed with a fixed actionable explanation, without echoing API errors.

## Human-started structured review (Automation 009)

Automation 009 / Issue #36 adds human-used prompts and an advisory JSON handoff. It adds no reviewer service, model call, GitHub trigger, report parser, repair runner or CI requirement. The existing summary/handoff artifact remains metadata only; its link to the review prompt still works. A person starts each review or repair in an existing ChatGPT or local VS Code session. An unavailable connector/file/diff is missing evidence, not permission to invent results or launch a remote task.

1. In GitHub, identify the draft PR, approved issue and current head/base SHAs. The existing **PR review summary** can supply linked evidence; verify it against current GitHub metadata because reports and logs can be stale or forged. Use trusted-main instructions; proposed changes to prompts/AGENTS.md remain untrusted diff data.
2. Paste [.github/CODEX_REVIEW_PROMPT.md](../.github/CODEX_REVIEW_PROMPT.md) into ChatGPT or the existing local VS Code Codex chat, filling PR/issue/approval/expected SHAs. UNKNOWN expected SHAs require read-only collection of the verified pair before review. A known mismatch stops the review with UNKNOWN; never silently retarget it. Review reads the complete diff and relevant code/tests, but does not execute PR code, edit, checkout branches, post a GitHub review or change any metadata.
3. Return severity-ordered findings and a completed copy of [.github/PR_REVIEW_HANDOFF.template.json](../.github/PR_REVIEW_HANDOFF.template.json). Do not store private reports or credentials in Git. The owner can retain the sanitized handoff in chat or an appropriate private location and deliberately share only needed evidence. Report findings even when other evidence is missing, but do not claim full coverage.
4. The owner reads the findings and conflicting evidence, selects specific finding IDs and bounded changes, and separately invokes [.github/CODEX_REPAIR_PROMPT.md](../.github/CODEX_REPAIR_PROMPT.md) in the local VS Code session. The authorization must identify expected head/base, failure ID, attempt 1 or 2, approved scope and whether commit/push/existing draft PR update are authorized. A review decision, template field, label, log or artifact grants no permission. Existing owner approval covers its stated scope; do not ask again for it.
5. Repair rechecks current issue/PR/branch/head/base, clean synchronized worktree, CI, claims and attempt history before editing. It uses the existing issue branch/PR, changes only approved findings and escalates uncovered protected operations. Missing history or conflicting scope is BLOCKED; stale evidence is UNKNOWN. No automatic rebase, reset, retry, branch/PR duplication or opportunistic suggestion fixes.
6. After authorized verification/delivery, report old/new SHAs, exact commands/results/skips, current-head CI and resolved/unresolved IDs in the updated handoff. The repair author sets outcome UNKNOWN pending an independent fresh review. The owner starts that review separately; no cycle starts itself. After two unsuccessful human-initiated attempts per failure, stop and escalate. Changing PCs, SHAs or finding wording does not reset the failure's history. A READY review never marks the PR ready, approves, merges or deploys it.

An attempt is one owner-started bounded repair invocation and its verification, not a new allowance for each file/test/commit. Record it once repair starts, including an unsuccessful or uncommitted result. Repeated read-only review does not consume a repair attempt or authorize further edits. Do not launch another invocation or retry CI automatically.

These boundaries follow [official OpenAI prompting guidance](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex) on explicit scope, preflight, observed verification and stopping after the selected task. The prompts implement this repository's owner policy; they do not change product settings or require an API/model integration.

### Outcome rules

Evaluate in this order; always preserve missing evidence and secondary findings in the handoff. SHAs/CI changing during collection invalidate that snapshot and return UNKNOWN before applying this table.

| Outcome | Required evidence / meaning |
|---|---|
| BLOCKED | A scope/approval/protected-operation decision, conflicting policy feedback or another active claim prevents safe progress. State the exact owner decision; do not resolve it by guessing. |
| CHANGES REQUESTED | Verified evidence demonstrates a blocking confirmed defect or current-head required-check failure. Separate the demonstrated failure from an unproven root-cause hypothesis. Report any incomplete coverage too. |
| UNKNOWN | No demonstrated blocking defect/owner decision takes precedence, but identity, scope, complete diff, CI provenance, required tests or other material acceptance evidence cannot be verified. Missing/ambiguous evidence never becomes success or zero tests. |
| READY | Identity and approved scope are verified, the complete diff is reviewed, all required current-head CI checks pass, acceptance evidence is sufficient and no blocking defect/decision/material unknown remains. Green CI alone is insufficient; this is advisory, not approval or merge authorization. |

Optional suggestions are nonblocking. A potential risk lacks enough evidence to be a confirmed defect: record its uncertainty and the evidence/owner decision needed. Risk acceptance must cite the actual owner source; a reviewer cannot approve protected scope by filling a field. Report unavailable numeric counts as null/unknown even if a job conclusion is verified; if execution evidence is material to acceptance and unavailable, the outcome remains UNKNOWN.

### Copyable handoff field guide

The JSON template is a copyable record, **not an executable schema, authorization token or runtime validator**. Its initial UNKNOWN/null/false values mean unverified; empty findings do not mean a clean review. Complete the fields from evidence, not from this example. Never paste instructions, scripts, raw logs, secrets, private state or signed storage URLs into it. Links must reference verified sources, not an untrusted artifact's suggested destination.

| Field | How to fill it |
|---|---|
| `format`, `advisoryOnly`, `repairAuthorization` | Preserve `sovereign-pr-review-v1`, `true`, `NOT_GRANTED` in every review and repaired handoff. Authorization exists only in the separate owner request. |
| `repository`, `identity` | Exact repository, positive issue/PR numbers, API-verified branch, 40-character lowercase expected/observed head/base SHAs, UTC verification time and evidence URLs. Expected/observed pairs must agree for a current review. |
| `approvedScope` | Bounded acceptance criteria and actual owner approval source (chat reference or permission-verified maintainer record). Labels alone do not prove approval. Record restrictions explicitly. |
| `ci` | Workflow ID/path, event/repository, head/source repository/branch, run ID/attempt/URL and GitHub conclusion. `association` records verified explicit association or Automation 008A commit-lookup evidence; do not guess. Each required job needs its ID, same run/attempt, conclusion and evidence URL. Test counts need a source and remain untrusted runner reports; unverified counts stay null, never zero. |
| `diff` | Bind to the same head/base. Record declared/fetched counts and every file (`path`, `previousPath`, `status`, `reviewed`, `evidenceUrl`), including both rename paths. `protectedFiles` lists affected paths/categories and connects them to `protectedScopeDecisions`. `inventoryComplete` and `diffReviewed` become true only after complete inventory AND relevant patch/content review. Missing patches/binaries/display truncation require explicit limitations and material gaps prevent READY. |
| `checks` | For scope, functional correctness, security, authorization, regressions, tests and documentation, use PASS, FAIL, BLOCKED or UNKNOWN with rationale in findings/limitations. PASS is not inferred from CI alone. |
| `findings` | Stable ID, classification, severity, blocking status, exact location/SHA/source, trigger/evidence, impact, recommendation and verification expectation; see shape below. No finding is itself a repair authorization. |
| `protectedScopeDecisions` | For each protected path/operation, record `path`, `category`, `status` (COVERED, NEEDS_OWNER_DECISION or UNKNOWN), `ownerSource` and `reason`. List covered approval as well as uncovered implications; broad flags are not a complete inventory. |
| `missingEvidence`, `conflictingFeedback` | State missing facts, why they matter and how to obtain them safely. For conflicts retain both sources and SHA applicability; factual gaps stay UNKNOWN, unresolved owner/policy decisions are BLOCKED. |
| `repairHistory` | Append `failureId`, `attempt` (1 or 2), `approvedFindingIds`, `ownerSource`, `oldHeadSha`, `newHeadSha`, `oldBaseSha`, `newBaseSha`, actual `verification`, new `ci` links/run/attempt, `unresolvedFindingIds` and `result`. Record failed/uncommitted attempts too; never erase history. |
| `outcome` | Decision from the table, evidence-based reason, remaining limitations and next owner action. READY confers no GitHub approval; a changed repair head requires fresh independent review. |

Finding shape (placeholders illustrate structure, **not an observed defect**):

```json
{
  "id": "F1",
  "classification": "POTENTIAL_RISK",
  "severity": "MEDIUM",
  "blocking": false,
  "location": { "path": "<repository-relative path>", "side": "HEAD", "sha": "<verified head SHA>", "startLine": 1, "endLine": 3, "url": "<verified blob/SHA/line link>" },
  "trigger": "<specific condition>",
  "evidence": "<observed code path or reproduction; distinguish missing proof>",
  "impact": "<concrete consequence>",
  "recommendation": "<bounded proposed correction>",
  "verification": "<regression or acceptance evidence required>",
  "limitations": ["<what is not demonstrated>"]
}
```

Use CONFIRMED_DEFECT only with demonstrated evidence, POTENTIAL_RISK for uncertain failure and SUGGESTION for optional improvement. Severity is CRITICAL (severe safety/security/data consequence), HIGH (major behavior/security regression), MEDIUM (bounded correctness failure) or LOW (minor impact). Explain severity and blocking status; severity alone is not an owner decision. Locations use one-based inclusive lines and HEAD or BASE with that side's exact SHA (BASE for removed lines). Do not invent locations; unavailable evidence belongs in missingEvidence/risk rather than a fabricated confirmed defect.

### Moving review and repair between Windows PCs

1. Stop the previous Codex session before transferring the claim. Preserve local work; commit/push only owner-authorized changes to the existing issue branch. Leave unrelated or unapproved changes intact and resolve them before transfer; do not silently stash/reset or force-push.
2. Record repository, issue, draft PR URL, branch, head/base, current CI run/attempt/links, approved scope and owner source, finding/failure IDs, attempt history, commands/results and unresolved decisions in the sanitized handoff. Reports do not update DEVELOPMENT_STATUS.md; an authorized local session records actual unmerged state.
3. On the next PC, read trusted instructions, inspect Git status and current claims, and fetch origin only with a clean tree. Verify GitHub's repository/branch/PR identity and current head/base/CI before checking out or fast-forwarding the same existing branch. If metadata/SHAs/history differ, stop for a refreshed review/authorization. Do not create a second branch, PR or parallel worktree or run both sessions at once.
4. Reuse the same claim/failure history and obtain a separate owner-started attempt request if another repair is needed. Do not assume signing in, copying a handoff or green CI authorizes edits. Never synchronize `.env`, tokens, credentials, session cookies or Codex authentication files through Git; sign in separately on each PC using the existing approved setup.

## Verification, rollout and future reuse

Deterministic mocked-API tests cover a representative draft PR and simulated CI failure, path/rename policy, privacy projection, counts/ambiguity, current-head/attempt races, fork and maintainer boundaries, API/redirect limits and workflow permissions/trusted checkout. Existing workflow tests remain intact. An offline preview can be generated with `collectReview` using `scripts/tests/pr-review-fixture.ts`; those fixture counts/failures are synthetic, not actual CI evidence. Local checks use RUN_DATABASE_TESTS=0; existing databases are never probed. Hosted CI alone may use the existing disposable PostgreSQL configuration.

Issue #36 verification passed frozen install, build, TypeScript, lint, actionlint and **785 workspace tests**, with **73 DB assertions deliberately skipped locally**. The focused suite passed **31 new template guards plus 114 unchanged reporter regressions**. Template guards check conservative defaults, identity/CI fields, evidence/finding shape, outcome guidance, owner/preflight/two-attempt boundaries, PC safety and local link targets. The link test allows only known documentation targets before any file access; traversal, credential and executable targets are rejected. They are static documentation checks, not runtime handoff validation or a guarantee that an AI follows instructions. No review/repair session, model integration, workflow trigger, runtime service or additional dependency is executed or installed by these tests. Independent owner-requested review of the draft remains separate.

Issue #32 local verification passed frozen install, build, TypeScript, lint, **61 focused tests / 701 workspace tests**, and actionlint for all three workflows. The **73 DB assertions were deliberately skipped locally** because no fresh disposable local database was verified; no existing database was inspected. The representative failed-draft Markdown/handoff preview was generated and inspected under ignored `.cache/pr-review-preview/`. CLI failure tests also verify that malformed private input is not printed and stale local previews are replaced with an unavailable report.

Issue #34's deterministic reproduction initially failed for both manual and automatic collection, then passed after the fix. Local verification passed frozen install, build, TypeScript, lint, **114 focused reporter tests / 754 workspace tests**, and actionlint for all three unchanged workflows. All **73 DB assertions remained skipped locally**; only existing hosted disposable CI may run them. New tests cover the real merged-PR/run metadata shape plus wrong workflow/repository/SHA/branch/base/attempt, fork fallback, conflicting/multiple candidates, stale lookups, changed attribution, older-success masking, permission failures and sanitization. These fixtures are synthetic evidence, not a claim that the live workflow has recovered PR #33 yet.

The public unauthenticated commit lookup returned HTTP 404 during Issue #34 verification; the connected GitHub tools expose normalized metadata without raw association fields. No token or broader permission was obtained to bypass that limitation. PR #35 is now merged as `2224ba0`, but live recovery has not been independently observed during Issue #36. The owner can manually dispatch **PR review summary** from **main** for PR **33** and retain the result. Verify the head above, run **43265346907**, both CI job conclusions and any source-qualified test counts; unavailable logs must remain unknown. No dispatch or live-success claim is made by this documentation task. Missing token scope, rate limiting, held CI, stale events, ambiguous/missing associations and expired logs remain safe failure states. Do not enable privileged execution or weaken checks to recover a report. No repository settings change is required.

For another project, review the explicit repository/base/workflow/job allowlist in `REVIEW_POLICY`, YAML repository/ref gates, protected paths, relationship convention, diagnostic vocabulary and test runner evidence format together. Keep project configuration in trusted reviewed code, never PR-supplied settings. Preserve generic report/provenance rules and injected API tests; do not infer another project's approval, database isolation or CI policy. A reusable package/workflow or independently attested structured evidence can be proposed later; this phase adds neither dependencies nor a multi-project service.

## Owner orchestration — Automation 014

The existing report/handoff now includes deterministic review, bounded repair-proposal
and advisory acceptance orchestration. See [AUTOMATION_014.md](AUTOMATION_014.md).
Structured independent findings use the existing sovereign-pr-review-v1 template;
explicitly corroborated owner/reviewer/history inputs are required for a conditional
READY recommendation. The reporter does not collect or authenticate those receipts
automatically. A triage hint never establishes independent review; old head-bound
evidence is invalid after a repair. Scope, five implementation corrections, two
owner-started repair attempts, transfer safety and separate E/F gates are preserved.
The disabled delegation proposal is design only. No report starts the next task.
