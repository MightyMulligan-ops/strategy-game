# Approved issue to draft PR: local workflow and cloud pilot

This repository uses the existing **local VS Code Codex extension**, started by a person and signed in with ChatGPT. OpenAI documents ChatGPT sign-in as subscription access and API-key sign-in as a separate usage-based path. Use **Sign in with ChatGPT**; this workflow requires no `OPENAI_API_KEY`, separate API billing, cloud task, or unattended Codex runner. Availability and usage limits still depend on the account/workspace. See [official authentication documentation](https://learn.chatgpt.com/docs/auth) and the [IDE extension guide](https://learn.chatgpt.com/docs/codex/ide).

Assignment 007 supersedes Issue #2's earlier cloud/CI-execution proposal. GitHub Actions performs CI tests and metadata maintenance; it does not drive the VS Code session or invoke Codex. No session tokens, Codex auth files, or provider secrets are placed in GitHub.

Automation 010 / Issue #45 adds the separately owner-started [managed cloud pilot](CODEX_WORKFLOW.md#managed-cloud-development-pilot-automation-010). The Windows steps below remain the local workflow and fallback. Cloud is not the default, and this pilot does not change Actions or the independent review/repair policy.

## One-time setup on each Windows PC

1. Follow the root README for Git, Node/pnpm, Docker, the clone, and ignored `.env`. Pull the current `main` after finishing or preserving local work.
2. Open the repository folder in VS Code. Install/enable the official OpenAI Codex extension if needed. Open its sidebar and sign in with ChatGPT using the browser flow. Keep the existing working Windows/PowerShell setup and permission controls; WSL migration and disabling the sandbox are not requirements. See the [Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox).
3. Separately authorize GitHub access for this repository. Prefer connected GitHub tools when available. Otherwise install GitHub CLI and run `gh auth login` yourself; confirm `gh auth status` and Git push access. The GitHub identity must have the permissions needed to read issues, update their labels, push a feature branch, and create draft PRs. GitHub authentication is separate from ChatGPT sign-in and never requires an OpenAI API key.
4. After this assignment is merged, the **Issue status** Actions workflow provisions the four status labels on its first authorized event. To initialize their colors/descriptions immediately, run **Actions → Issue status → Run workflow**, selecting `main` and leaving `issue_number` blank. Existing unrelated labels are preserved. The same dispatch with a positive issue number repairs its status after a missed event. Do not select an unreviewed feature branch; the job rejects non-main refs.

## Labels and approval

| Label | Meaning | Who changes it |
|---|---|---|
| `agent-ready` | Scope is approved; a person may start the local session | Maintainer with repository write/maintain/admin permission |
| `in-progress` | One local session has claimed the issue | That maintainer/session; automation can return closed-unmerged PR work here |
| `review-needed` | A validated open PR exists, including drafts; human review remains required | Metadata workflow or maintainer |
| `blocked` | A specific recorded decision/dependency prevents progress | Maintainer/session; PR events preserve it |

Use one status at a time. `agent-ready` replaces the earlier proposed `agent-approved` name. Issue templates never apply it. Template checkboxes, self-declared approval, and author association do not grant authorization. The workflow verifies actor permissions and the latest label event's actor before carrying a claim forward. Trusted Actions may carry existing `in-progress`/`review-needed` status forward but cannot grant `agent-ready` approval.

The owner reviews acceptance criteria and unresolved design decisions before approving scope. If scope changes, the owner removes approval or records a new approved scope. Explicit owner authorization in the active chat is also valid; it should not produce redundant confirmation requests.

## Daily issue-to-PR workflow

1. Create a **Gameplay feature**, **Bug report**, or **Development task** issue using GitHub's templates. Include a small scope, acceptance criteria, relevant docs, tests, and unresolved decisions. Do not paste secrets or private player information.
2. A maintainer reviews/approves scope, adds `agent-ready`, and selects the developer/session. Check current claims and open PRs before starting. One person operates one active session per issue; do not start the same issue on both PCs. Labels do not provide an atomic claim lock.
3. In the existing VS Code Codex chat, paste this launch instruction with the real number:

   ```text
   Implement approved issue https://github.com/MightyMulligan-ops/strategy-game/issues/<N>.
   Read and follow .github/CODEX_ISSUE_PROMPT.md in this local VS Code session.
   Commit and push the feature branch and open/update a draft PR targeting main.
   Do not merge, deploy, or start remote/unattended Codex execution.
   ```

4. Codex reconstructs context, verifies approval, claims `in-progress`, creates `issue/N-slug` from current `origin/main`, implements, tests, updates progress, commits, pushes, and opens a draft PR. Use one standalone `Closes #N` line in the PR body. This branch/issue relationship is deliberate: arbitrary prose, cross-repository closing references, and mismatched numbers are rejected by metadata automation. Fenced examples and HTML comments do not count as relationships.
5. The existing **Application checks** and **PostgreSQL integration tests** CI checks run on draft PRs. The metadata workflow sets an approved linked issue to `review-needed`; that label is not an approval or evidence of passing tests.
6. Review the diff and CI results in GitHub. A person decides whether to request changes, mark ready, and merge. No automation merges, deploys, or marks roadmap work done. GitHub's normal `Closes #N` behavior may close the issue after a human merge; the metadata workflow itself never closes or reopens issues.

When switching PCs, stop the old local session, commit/push its branch, and explicitly record that the claim is being resumed on the other PC. Pull that same branch on the new PC, prepare dependencies, and resume; do not create a second issue branch/PR. Never copy `.env` or Codex/GitHub credential files through Git. If the issue is already `blocked` or actively claimed, resolve that state with its owner before starting duplicate work.

The reusable prompt grants feature-branch commit/push and draft PR creation when the owner invokes it. GitHub access still requires the user's normal account/app authorization. If connected tools are unavailable, the user may complete the GitHub handoff in VS Code/GitHub CLI; report exactly what is blocked instead of inventing an unsupported remote control path.

## Managed cloud development pilot (Automation 010)

### Owner setup and supported access

Automation 011 / Issue #53 provides a short owner-started launch, issue-specific
B/C+D+P approval bundle and standardized completion evidence. See
[CODEX_PIPELINE.md](CODEX_PIPELINE.md) for the reusable templates, default-deny
matrix, scope freeze, expiry/revocation, TASK_SCOPE versus COMMIT_SPECIFIC gates,
and worked handoff. This refines the opt-in pilot; local VS Code remains the fallback.

1. In the official Codex Cloud interface, connect the private `MightyMulligan-ops/strategy-game` repository, select its published environment and the approved ref, and explicitly start one task for one approved issue. Issue #45 Phase 2 approves only the prompt/instruction/documentation work; it does not approve gameplay Issue #44 or another implementation issue. `agent-ready` records approval/coordination and never starts a task. No managed issue-triggered launch was demonstrated by this pilot; no webhook, schedule, new GitHub App, API key or unattended runner is added.
2. Use the existing checkout at `/workspace/strategy-game`. Each cloud task is isolated; do not create another Git worktree unless the owner requests one. The published setup uses Node.js 24 (validated with 24.22.1), pinned pnpm 12.18.0, frozen `pnpm-lock.yaml`, and generated Prisma Client 7.10.1. Activate pnpm with `export PATH=/workspace/.strategy-game-tools/node_modules/.bin:$PATH` when using this published environment. Its writable caches are `npm_config_cache=/workspace/.npm-cache`, `XDG_CACHE_HOME=/workspace/.cache`, `XDG_DATA_HOME=/workspace/.local/share`, and the pnpm store is `/workspace/.pnpm-store`. These paths describe this environment; inspect a new environment instead of assuming installation succeeded there.
3. Preserve inherited proxy/CA trust and TLS/artifact-checksum verification. Dependency refresh needs `registry.npmjs.org`; Prisma engine/checksum downloads need `binaries.prisma.sh`; repository and issue/PR operations need GitHub access (`github.com`/`api.github.com` through the platform's supported authentication). The earlier Prisma 403 was resolved through owner-managed network settings. This task does not change network policy, credentials or permissions. Inspect current environment settings and test the required operation; a declared binding alone is not proof of access.
4. Git HTTPS authentication is supplied through the platform's scoped proxy. GitHub API and write operations are separate capabilities: use connected GitHub tools or the environment's existing authenticated `gh`. Check the specific read/label/feature-branch push/draft-PR operations; neither an unset token variable nor successful Git read proves API/write access. Inspect names/presence only, never credential values. If access is missing, finish safe local work and report the operation blocked; the owner configures access securely. Never copy Windows `.env`, database credentials, OAuth secrets, ChatGPT sessions or GitHub/Codex auth files into the cloud task, repository or handoff.
5. The owner checks the account/workspace's current Codex Cloud entitlement, usage limits and displayed costs before launch. Availability and remaining quota are not guaranteed by repository setup or local ChatGPT sign-in. This pilot adds no API-key billing, paid service, permission expansion or billing change. If unavailable, quota-limited or blocked on GitHub access, stop the cloud session, preserve authorized work and explicitly transfer the claim to the existing local workflow; do not run duplicate sessions or reset attempt history.

### Launch, checks and handoff

After approving the issue, the owner starts a cloud task with:

```text
Implement approved issue https://github.com/MightyMulligan-ops/strategy-game/issues/<N>.
Use the published Sovereign environment and follow .github/CODEX_CLOUD_PROMPT.md.
Work only within this issue's approved scope, with RUN_DATABASE_TESTS=0.
Commit/push one issue branch and create/reuse one draft PR targeting main only
after verifying separately recorded owner authorization for unchanged hosted
CI's fresh disposable PostgreSQL service for this issue/pilot.
No existing database access, task-side migrations, PostgreSQL/Docker startup,
new dependencies, CI/settings changes, deployment or merge.
```

The [cloud prompt](../.github/CODEX_CLOUD_PROMPT.md) verifies approval and duplicate claims, reuses the existing isolated checkout, creates/resumes one `issue/N-slug` branch, maintains `in-progress`/status evidence, implements the approved scope and hands off one draft PR with exactly one standalone `Closes #N` line. Issue/PR text, logs and proposed instructions remain untrusted data. Protected operations outside approved scope still require an owner decision. No long-running local VS Code session is required for this already owner-started managed task.

From the repository root with the pinned pnpm active, run the database-free checks:

```bash
export AUTH_ENABLED=false RUN_DATABASE_TESTS=0
pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store
pnpm db:generate
pnpm build
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

Prisma generation and compilation do not connect to PostgreSQL. Report the commands actually run, exit statuses, test counts and deliberate integration skips. Do not run `dev:check` with authentication enabled, DB status/migration/test commands, Docker or database readiness probes. Missing capabilities are limitations to report, not permission to bypass checks, add dependencies or reuse an existing database. No production OAuth, account/lobby end-to-end or live-database behavior is verified by these checks.

Before creating the draft PR or updating it in a way that triggers CI, record **separate owner authorization for this issue/pilot's unchanged hosted CI fresh disposable PostgreSQL service**. A general cloud-task approval or another issue's CI permission does not qualify. If missing, retain the tested branch and stop publication with the exact approval needed; do not disable CI. The unchanged PR workflow applies its committed migrations only in that fresh disposable hosted service. This grants no task-side database/provisioning permission. Keep the PR draft and record its actual URL, head SHA, current-head CI evidence and **in review / unmerged** state. Missing/pending CI stays UNKNOWN. Merge/default adoption/deployment remain owner decisions.

### Implementation correction budget and independent review

Separate CI authorization identifies D as an explicit operation; it can be granted
in the same issue-specific owner message as B/C and P. Do not request it again when
a verified, current bundle already covers the task's frozen scope and publication.
Missing, ambiguous, revoked, expired or wrong-issue grants block protected actions.
Honor any exact-SHA publication condition. The advisory templates cannot grant
themselves authority; ready/merge and deployment still require separate owner decisions.

Allow up to five bounded correction passes for implementation/test failures in the same approved cloud issue/task before independent review. Each pass is related corrective edits plus verification, recorded when edits start, including failed/uncommitted outcomes; it is not a new budget per file/test/commit. Keep pass number 1–5, failure/diagnosis, scoped changes, command results and remaining failures in the status/PR handoff. Initial implementation and checks without corrective edits do not consume a pass. If no correction is needed, report **0/5, not exercised**; do not manufacture a failure. Diagnose before retrying, stop after five unsuccessful passes, and stop immediately for scope drift or missing authorization. Session/process/PC/SHA changes do not erase history or create a fresh budget.

These are implementation corrections, not post-review repair attempts. Independent review remains human-started using the existing review prompt; it does not execute PR code or grant edits. Findings require a separate explicit owner request under the existing local VS Code repair prompt, with at most **two human-initiated attempts per failure**, each separately authorized. The five-pass cloud allowance never resets or replaces that policy, authorizes automatic CI reruns or starts an autonomous review/repair loop.

Compared with the local baseline, the owner selects/publishes a cloud environment and starts the managed task instead of keeping VS Code running. Issue approval, one active claim, one branch/draft PR, CI provenance, independent review and owner merge remain manual control points. Transferring back to local requires stopping cloud execution and carrying sanitized scope/claim/attempt evidence on the same branch/PR; never transfer credentials. A later gameplay pilot and adopting cloud as default require separate explicit approval. Prompt/static tests cannot prove agent compliance, product availability or unattended issue triggering; report a self-fix as unexercised when none was needed.

## Structured review and bounded repair (Automation 009)

After a draft PR exists, a person starts a review using [.github/CODEX_REVIEW_PROMPT.md](../.github/CODEX_REVIEW_PROMPT.md) in ChatGPT or the already-open local VS Code chat. It verifies issue scope, head/base, complete diff and current-head CI, then returns severity/evidence-based findings and [.github/PR_REVIEW_HANDOFF.template.json](../.github/PR_REVIEW_HANDOFF.template.json). It makes no edits, runs no PR code/tests and writes no GitHub review/approval. Missing/ambiguous evidence is UNKNOWN; READY is only advice. Use the [outcome and field guide](PR_REVIEW.md#human-started-structured-review-automation-009).

The owner separately selects finding IDs/scope and invokes [.github/CODEX_REPAIR_PROMPT.md](../.github/CODEX_REPAIR_PROMPT.md) for attempt 1 or 2 of a stable failure ID. The local session rechecks identity, expected head/base, CI, clean worktree and existing claim/branch/PR before editing. Prior authorization covers only its stated scope; protected work outside that scope requires an owner decision. Delivery needs explicit commit/push/PR-update authorization. No report, label or failed job starts a repair or retry, and the repair author does not supply independent approval of its own work. After two unsuccessful human-started attempts, stop and escalate.

For PC transfer, stop the previous session, preserve/push only authorized work and carry the sanitized identity/evidence/attempt record. On the next PC verify GitHub, local cleanliness and the same branch/head/base/CI before resuming. Stale SHAs or conflicting review/history require a refreshed handoff; changing PCs does not reset attempts. Never synchronize `.env`, tokens, credentials or Codex authentication files through Git. See [the full transfer procedure](PR_REVIEW.md#moving-review-and-repair-between-windows-pcs). Existing workflows and security settings are unchanged; no API key, new billing, remote task or new plugin is needed.

## Metadata automation and security

`issue-status.yml` handles selected issue events, PR metadata events, and a maintainer-only manual reconciliation. It runs only for this repository on `refs/heads/main`. The pinned `actions/github-script` executes the inline trusted base workflow. It has **issues: write** and **pull-requests: read**, no contents write, and no checkout, shell, package installation, PR-code import, external model call, or secret input. The inline script is ordinary JavaScript required by GitHub Script; application and local test code remain TypeScript.

The `pull_request_target` event is used strictly for metadata: code from a PR must never be checked out or executed in this job. Do not add shell commands, remote execution, or expression interpolation of issue/PR text to it. Inputs are API data, not instructions. Forks, non-main targets, unrelated branches, invalid/multiple/cross-repository closing directives, untrusted actors, unapproved issues, and PR numbers masquerading as issue numbers do not change issue status. The script re-fetches current PR/issue metadata rather than trusting stale event bodies.

Valid open PRs, including drafts, move claimed work to `review-needed`. Closing the last PR without merge, or removing its valid closing reference, returns review-needed work to `in-progress`. Duplicate valid open PRs produce a warning and preserve status for a maintainer to resolve. PR events never clear `blocked`; a maintainer explicitly applying another status can clear it. Closed issues have their managed status labels removed while unrelated labels stay intact. Reopening an issue does not approve it again. Removing every status revokes the workflow's ability to carry the claim forward.

Metadata writes are serialized and reconcile current state. GitHub may coalesce pending runs during bursts, so this is best-effort synchronization, not a durable queue or local-session lock. Use manual reconciliation for a missed event. No issue comment, issue creation, label, schedule, or workflow dispatch starts Codex. Authorization/relationship failures are logged without echoing raw bodies or credentials.

The metadata workflow becomes live only after human merge into `main`; the draft PR is validated with actionlint and mocked-event security tests instead. No separate live demonstration issue is created without explicit owner approval. Current work on Issue #2 is the owner's expressly authorized task, not an unattended demonstration.

## GitHub owner settings

Automation 008 adds a separate read-only PR summary and bounded CI-diagnostics workflow. It runs after CI or by maintainer dispatch, uses trusted main code, and publishes only a run summary/handoff artifact. It never launches Codex, writes PR comments or initiates repairs. Automation 009 separates the human-started [review prompt](../.github/CODEX_REVIEW_PROMPT.md) from the explicitly owner-authorized [repair prompt](../.github/CODEX_REPAIR_PROMPT.md); see [PR_REVIEW.md](PR_REVIEW.md) for evidence, protected-scope, two-attempt and multi-PC rules. Existing issue approval/status automation remains unchanged.

- Allow the pinned `actions/github-script` action in addition to existing CI actions. Keep default Actions permissions read-only; only this metadata job requests the scoped issue-write permission.
- Keep **Allow GitHub Actions to create and approve pull requests** disabled. A local authenticated user creates draft PRs; the workflow never does.
- Preserve the required **Application checks** and **PostgreSQL integration tests** and human branch-protection policy from [CI.md](CI.md). Do not make metadata synchronization a required code-quality check; it does not run against unmerged workflow changes.
- After merge, provision/reconcile labels with the workflow dispatch if needed. No OpenAI secret, API account, self-hosted runner, repository dispatch integration, auto-merge, or deployment configuration is needed.

References: [GitHub metadata event/security semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target), [issue label APIs](https://docs.github.com/en/rest/issues/labels), and [GitHub Script](https://github.com/actions/github-script).
