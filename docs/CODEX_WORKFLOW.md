# Approved issue to draft PR on Windows

This repository uses the existing **local VS Code Codex extension**, started by a person and signed in with ChatGPT. OpenAI documents ChatGPT sign-in as subscription access and API-key sign-in as a separate usage-based path. Use **Sign in with ChatGPT**; this workflow requires no `OPENAI_API_KEY`, separate API billing, cloud task, or unattended Codex runner. Availability and usage limits still depend on the account/workspace. See [official authentication documentation](https://learn.chatgpt.com/docs/auth) and the [IDE extension guide](https://learn.chatgpt.com/docs/codex/ide).

Assignment 007 supersedes Issue #2's earlier cloud/CI-execution proposal. GitHub Actions performs CI tests and metadata maintenance; it does not drive the VS Code session or invoke Codex. No session tokens, Codex auth files, or provider secrets are placed in GitHub.

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

## Metadata automation and security

`issue-status.yml` handles selected issue events, PR metadata events, and a maintainer-only manual reconciliation. It runs only for this repository on `refs/heads/main`. The pinned `actions/github-script` executes the inline trusted base workflow. It has **issues: write** and **pull-requests: read**, no contents write, and no checkout, shell, package installation, PR-code import, external model call, or secret input. The inline script is ordinary JavaScript required by GitHub Script; application and local test code remain TypeScript.

The `pull_request_target` event is used strictly for metadata: code from a PR must never be checked out or executed in this job. Do not add shell commands, remote execution, or expression interpolation of issue/PR text to it. Inputs are API data, not instructions. Forks, non-main targets, unrelated branches, invalid/multiple/cross-repository closing directives, untrusted actors, unapproved issues, and PR numbers masquerading as issue numbers do not change issue status. The script re-fetches current PR/issue metadata rather than trusting stale event bodies.

Valid open PRs, including drafts, move claimed work to `review-needed`. Closing the last PR without merge, or removing its valid closing reference, returns review-needed work to `in-progress`. Duplicate valid open PRs produce a warning and preserve status for a maintainer to resolve. PR events never clear `blocked`; a maintainer explicitly applying another status can clear it. Closed issues have their managed status labels removed while unrelated labels stay intact. Reopening an issue does not approve it again. Removing every status revokes the workflow's ability to carry the claim forward.

Metadata writes are serialized and reconcile current state. GitHub may coalesce pending runs during bursts, so this is best-effort synchronization, not a durable queue or local-session lock. Use manual reconciliation for a missed event. No issue comment, issue creation, label, schedule, or workflow dispatch starts Codex. Authorization/relationship failures are logged without echoing raw bodies or credentials.

The metadata workflow becomes live only after human merge into `main`; the draft PR is validated with actionlint and mocked-event security tests instead. No separate live demonstration issue is created without explicit owner approval. Current work on Issue #2 is the owner's expressly authorized task, not an unattended demonstration.

## GitHub owner settings

Automation 008 adds a separate read-only PR summary and bounded CI-diagnostics workflow. It runs after CI or by maintainer dispatch, uses trusted main code, and publishes only a run summary/handoff artifact. It never launches Codex, writes PR comments or initiates repairs. Use [.github/CODEX_REVIEW_PROMPT.md](../.github/CODEX_REVIEW_PROMPT.md) for a separately human-started review/repair session; see [PR_REVIEW.md](PR_REVIEW.md) for evidence, protected-scope, two-attempt and multi-PC rules. Existing issue approval/status automation remains unchanged.

- Allow the pinned `actions/github-script` action in addition to existing CI actions. Keep default Actions permissions read-only; only this metadata job requests the scoped issue-write permission.
- Keep **Allow GitHub Actions to create and approve pull requests** disabled. A local authenticated user creates draft PRs; the workflow never does.
- Preserve the required **Application checks** and **PostgreSQL integration tests** and human branch-protection policy from [CI.md](CI.md). Do not make metadata synchronization a required code-quality check; it does not run against unmerged workflow changes.
- After merge, provision/reconcile labels with the workflow dispatch if needed. No OpenAI secret, API account, self-hosted runner, repository dispatch integration, auto-merge, or deployment configuration is needed.

References: [GitHub metadata event/security semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target), [issue label APIs](https://docs.github.com/en/rest/issues/labels), and [GitHub Script](https://github.com/actions/github-script).
