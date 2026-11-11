# Continuous integration (Assignment 006)

The `CI` workflow in [ci.yml](../.github/workflows/ci.yml) runs for pull requests targeting `main`, including drafts and subsequent commits, and for pushes to `main`. It has no path filters, so documentation-only PRs also receive the required checks. Each new run cancels an obsolete run for the same PR or branch; different PRs do not cancel one another.

## Jobs and checks

| Job ID | Check name | Work |
|---|---|---|
| `quality` | **Application checks** | Frozen install, full build, TypeScript checks, unit/simulation/mocked-auth tests, frontend lint |
| `database` | **PostgreSQL integration tests** | Frozen install, committed test migrations, all live integration tests, verification that every integration file executed with no skipped/pending/todo tests |

Both jobs use GitHub-hosted Ubuntu 24.04, Node.js 24, and pnpm from the root `packageManager` field (currently 12.18.0). `pnpm/action-setup` reads that pin; `actions/setup-node` caches the pnpm store using `pnpm-lock.yaml`. They install with `pnpm install --frozen-lockfile`; neither `node_modules`, Prisma output, nor the development cache is shared between jobs. All actions are pinned to full commit SHAs with version comments; review action releases before updating those pins.

The quality job deliberately skips the live database suites in `pnpm test`. The database job starts a fresh, health-checked `postgres:17` service, creates `strategy_game_ci_test`, and runs:

```sh
pnpm db:migrate:test
pnpm test:db --reporter=default --reporter=json --outputFile=.cache/ci/database-results.json
node --experimental-strip-types scripts/ci-reports.ts verify
```

`scripts/test-database.ts` and the report guard share `scripts/integration-tests.ts` to discover `*.integration.test.ts` in both `database/tests` and `apps/server/tests`. The runner forwards reporter options, validates the local `_test` URL, and explicitly enables `RUN_DATABASE_TESTS=1`. The guard matches full relative paths (including same-named lobby files), requires nonempty passed assertions, and rejects skipped, pending, todo, failed, missing or duplicate suites. Issue #11 adds seven real HTTP/session/PostgreSQL tests for 45 integration tests across four files; the guard does not freeze that count. Migrations use the existing deploy command; no schema push/reset is used. CI's fresh service/database is discarded with the runner. Local migration/integration testing must use a newly created verified isolated database after SQL review, never the development database or a reset of existing data; see [API prerequisites](LOBBY_API.md#prerequisites-and-database-safety).

The workflow uses fixed, public, **CI-only** credentials solely for that disposable service. They are not production secrets and must never be reused outside CI. It masks the connection URL/password in Actions output. No `.env`, account provider credentials, session secret, deployment token, or repository secret is supplied to PR code.

## Failure diagnostics and workflow validation

Issue #17's additive readiness migration is authorized for this fresh disposable CI service only, after offline SQL review. No existing development, test or sandbox database may be connected to, and manual sandbox migration remains separately unapproved. Local checks explicitly set `RUN_DATABASE_TESTS=0`; do not execute the generic local database commands below during this issue. The existing unchanged CI runner/report guard discovers all readiness/start tests and requires zero skipped assertions.

Initial [PR #18 CI run 25](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43092036339) passed both jobs: migration applied to disposable PostgreSQL 17, **61 integration tests across five files with zero skips** verified by the report guard, plus build/typecheck/408 unit tests/lint. A subsequent UI test for Started-filter rediscovery brings the local unit count to 409; the PR checks track each new commit. No workflow or credentials changed for readiness/start; test discovery remains dynamic.

Issue #15 adds a fifth live suite, `apps/server/tests/local-test.integration.test.ts`, with five local-fixture session/lobby/isolation/concurrency tests (50 live tests total). CI's fresh PostgreSQL service is the only DB-backed verification used for this task. Local runs explicitly use `RUN_DATABASE_TESTS=0` and memory/HTTP fixtures; no existing development/test/sandbox database is connected. The new suite refuses pre-existing reserved fixture identities rather than overwriting or cleaning them. Shared discovery/report validation continues to require every live assertion to execute without skips; no workflow or secret changes are needed.

All command steps fail on a nonzero exit code, including commands piped to `tee` (the workflow explicitly uses Bash with GitHub's `pipefail` behavior). A failing command stops the later normal checks in its job; the other job runs independently. The database report guard still runs after the integration-test command fails, when possible.

On failure, command logs are sanitized and uploaded as `application-failure-logs` or `database-failure-logs`, retained for seven days. Only the sanitized `.log` files are uploaded; `.env`, raw JSON reports, generated builds, and database dumps are excluded. Sanitization removes configured credential values and credential-bearing URLs while retaining error text. Setup failures before a log exists can be diagnosed in the Actions step logs. The existing Prisma/pg overlapping-query warning is visible in integration output and is not itself a test failure.

To validate workflow edits locally, install [actionlint](https://github.com/rhysd/actionlint/blob/main/docs/install.md) separately and run:

```powershell
actionlint .github/workflows/ci.yml
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm docker:up:test
pnpm db:migrate:test
pnpm test:db --reporter=default --reporter=json --outputFile=.cache/ci/database-results.json
node --experimental-strip-types scripts/ci-reports.ts verify
```

Use your local ignored `.env` for the local test database; do not replace it with CI settings. Reports/logs live under the existing ignored `.cache/`. GitHub's actual hosted run remains the final check of action setup, cache handling, and service-container behavior.

## Recommended GitHub configuration (owner action)

After this workflow has run, configure a branch ruleset for `main` under **Settings → Rules → Rulesets**, or a classic branch protection rule under **Settings → Branches**, as supported by the repository's plan:

1. Require a pull request before merging.
2. Require these exact check names from GitHub Actions: **Application checks** and **PostgreSQL integration tests**. GitHub may group them under the `CI` workflow in its UI. Select the observed check names after the first run; job names should stay unique across workflows.
3. Require the branch to be up to date before merging and require review conversations to be resolved.
4. Block force pushes and deletion of `main`; keep bypass permissions narrowly limited. Apply protections to administrators if that fits the owner's workflow.
5. Require one approving review when another reviewer is available; a solo maintainer cannot approve their own PR.
6. Keep auto-merge disabled. Do not enable merge queue with this initial workflow: it would also need a `merge_group` trigger.

Under **Settings → Actions → General**, allow the pinned GitHub-owned actions and `pnpm/action-setup`, keep default workflow permissions read-only, and keep the option allowing Actions to create/approve pull requests disabled. Retain approval requirements for external contributors; never send write tokens or secrets to fork workflows. This workflow uses `pull_request`, not `pull_request_target`, has only `contents: read`, disables persisted checkout credentials, and uses no self-hosted runner.

No repository settings are changed by this assignment. A repository owner must enable Actions/approve a held run if required by GitHub policy, select the required checks after they appear, and enable branch protections. Feature-branch pushes without a PR are intentionally not triggers; opening/updating the draft PR starts its checks.

Assignment 007 adds a separate, metadata-only **Issue status** workflow, documented in [CODEX_WORKFLOW.md](CODEX_WORKFLOW.md). Keep the two CI check names above as the required code checks. The metadata job uses only issue-write and PR-read permissions, never checks out PR code or invokes Codex, and requires allowing the pinned `actions/github-script` action. Keep Actions PR creation/approval disabled; draft PRs are created by the authenticated local user.

References: [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [setup-node caching](https://github.com/actions/setup-node), [pnpm setup](https://github.com/pnpm/action-setup).
