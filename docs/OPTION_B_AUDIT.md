# Option B repository audit — 2026-11-15

## Decision and scope

Use GitHub Issues → one owner-started Codex task → one draft PR → existing GitHub Actions CI and independent review → owner-controlled merge. Keep the game, GitHub/CI and Codex/API; defer custom Stage 2 ledger services, multi-agent review orchestration and auto-merge. Preserve the security properties rather than requiring every proposed custom component. No proposed change grants execution authority.

Audit baseline: main `4ac5fca5941f89612f813ed6059610bcacb9da5d`. Inventory covered all **7 open issues, 4 open draft PRs, 39 branches, 4 main workflow files**, all Markdown documentation and issue/PR templates at that baseline, plus changed-file inventories and workflow candidates in the open PRs. The initial inventories fit in one 100-item page each; the recursive tree was not truncated. This is a repository/workflow cleanup audit, not independent certification of every security implementation or a gameplay code audit. [#82](https://github.com/MightyMulligan-ops/strategy-game/issues/82) tracks the cleanup review; [#79](https://github.com/MightyMulligan-ops/strategy-game/issues/79) remains worker delivery tracking.

PR #81 changed during the audit: initial observed head `520540565c8361137dc0f24218ffa2350bbb26df`, later `9cf91681429a01e12ede7136090ba86b6e54115b`, with base temporarily observed as main. Do not change its code/base or treat prior `6757694…` CI as evidence for these heads. Refresh live identity before further work. Branch inventory below is the initial frozen snapshot, not a claim that a changing branch stayed there.

## Issues: disposition of every initially open item

| Item | Disposition | Reason / retained work |
|---|---|---|
| [#64](https://github.com/MightyMulligan-ops/strategy-game/issues/64) cold movement capacity | Keep open, unchanged | Measured performance limitation remains; no invented production SLO or permission to restart exhausted repairs. |
| [#68](https://github.com/MightyMulligan-ops/strategy-game/issues/68) Stage 2 ledger/delegation | Closed, not planned, explanatory comment | Custom Stage 2 delivery track superseded by Option B. No implementation-complete claim. |
| [#70](https://github.com/MightyMulligan-ops/strategy-game/issues/70) orders/Ready progression | Keep open; residual-scope comment | PRs #48/#52/#60/#62 already delivered portions; residual attack legality, no-op policy and future turn progression need design. Preserve backlog; do not duplicate/reimplement shipped slices. |
| [#71](https://github.com/MightyMulligan-ops/strategy-game/issues/71) legacy initialization | Keep open, unchanged | Legacy initialization/acceptance is still an owner decision; no automatic backfill or GET mutation. |
| [#76](https://github.com/MightyMulligan-ops/strategy-game/issues/76) Combat 1A | Keep open, unchanged | Distinct pure two-formation gameplay scope; not delivered by automation candidates. |
| [#77](https://github.com/MightyMulligan-ops/strategy-game/issues/77) earlier worker design | Closed, not planned, explanatory comment | Duplicate delivery tracking consolidated into #79. Security acceptance criteria retained; #78 is preserved. |
| [#79](https://github.com/MightyMulligan-ops/strategy-game/issues/79) issue worker | Keep open; retitled and current-direction preface plus consolidation comment | Single worker-delivery tracker. Conditional prior pilot authority does not establish technical readiness or authorize a cleanup-triggered paid run. |

## Pull requests: disposition of every initially open item

| PR | Disposition | Finding |
|---|---|---|
| [#69](https://github.com/MightyMulligan-ops/strategy-game/pull/69) Stage 2 | Closed without merge; branch retained | Actual diff is 13 files including ledger/PostgreSQL adapter, SQL, admission tests and an offline preflight, despite stale design-only PR prose. Superseded architecture; preserve all source/history. Its branch adds an older smoke variant that should not replace main's working preflight. |
| [#78](https://github.com/MightyMulligan-ops/strategy-game/pull/78) manual worker | Keep draft/open | Three-file candidate contains a literal-false paid-job guard. Distinct fail-closed work; not proven obsolete. Audit comment clarifies the earlier #77 closing reference is historical and confers no authority; #79 owns delivery. |
| [#80](https://github.com/MightyMulligan-ops/strategy-game/pull/80) trusted controller | Keep draft/open | Distinct budget/admission/gateway/validator/publisher controls. Do not remove security logic merely because custom infrastructure is deferred. Compare/select the minimum implementation under #79 before any merge. |
| [#81](https://github.com/MightyMulligan-ops/strategy-game/pull/81) hosted adapter | Keep draft/open; no audit edits | Actively changing stacked work incorporates #80 and adds hosted request/artifact/stream/admission/source tooling. Not demonstrated obsolete. Its historical dependent-base claims must be refreshed against live API state. |

Closing #68/#69 or #77 is administrative consolidation, not security acceptance, gameplay delivery, paid activation or deletion. No branches were deleted. No merges, deployments, workflow dispatches, CI reruns, existing-database operations, billing/credential changes or paid calls were initiated by this audit.

## Workflows: keep the permission boundaries

| Workflow | Current behavior / decision |
|---|---|
| [ci.yml](../.github/workflows/ci.yml) | Retain unchanged. PR/push checks on main, contents read, pinned actions, frozen install, application checks and fresh disposable PostgreSQL integration with zero-skip guard. Never replace this with advisory reporting. |
| [issue-status.yml](../.github/workflows/issue-status.yml) | Retain unchanged. Metadata-only events and restricted write scope; trusted inline script, actor checks, no checkout/dependency install/model call. Labels are not launch authority or an atomic worker lock. |
| [pr-review.yml](../.github/workflows/pr-review.yml) | Retain unchanged. Trusted-main read-only CI evidence/reporting; no PR-code execution with write credentials, AI review launch, repair or auto-merge. |
| [automation-015-codex-smoke.yml](../.github/workflows/automation-015-codex-smoke.yml) | Preserve manual integration test. Separate draft cleanup pins the action at verified upstream v1 commit `bdf19a4a223ec2549a3e2274a0cf61556bc07675`, updates the obsolete Stage 2 prompt to Option B and rejects reruns. Existing repo/main/owner guards, contents read, nonpersisted checkout credentials, 12-minute timeout, drop-sudo/read-only profile and secret preflight remain. No smoke run is requested. |
| #69 automation-015-preflight.yml | Superseded offline Stage 2 workflow, never promoted to main by this audit. Keep its branch archive. |
| #78 codex-manual-worker.yml | Unmerged and hard-disabled. Do not remove literal false during cleanup. |
| #81 sovereign-cloud-preflight.yml | Unmerged offline-only candidate; no environment secret or paid launcher. Do not activate or promote it during cleanup. |

Do not combine metadata writes, model credentials, PR-code execution and trusted review collection into a single privileged job. There are only four workflows on main, with distinct purposes and authority. Removing the evidence/security separation would not be a justified cleanup.

The smoke action pin is verified against upstream annotated tag v1 → commit using GitHub's Git data API and action.yml at that commit; the tag is unsigned. This removes mutable-tag drift only. CLI/proxy installation versions and integrity are still unresolved for a live worker; a full action pin is not a fully immutable toolchain or a cost bound. Runtime billing, isolation, authenticated source/grant, cancellation and independently reviewed publication gates remain mandatory under #79. The existing smoke job is not a paid coding worker or proof of a strict $45 ceiling.

## Branches: complete initial inventory

GitHub comparison uses merge-base history, not semantic patch equivalence. Most merged branches were squash-merged and still appear diverged with unique commits. A merged PR association alone does not prove every current branch change is disposable; retain them instead of deleting uncertain work. No force-push, branch retarget or branch deletion is part of this cleanup.

| Branch | Snapshot head | Disposition | Comparison to main |
|---|---|---|---|
| [chore/development-startup-automation](https://github.com/MightyMulligan-ops/strategy-game/tree/chore/development-startup-automation) | `f02cb856ddd0` | PR [#3](https://github.com/MightyMulligan-ops/strategy-game/pull/3) merged; retain historical branch | diverged; +1/−39 |
| [chore/github-actions-ci](https://github.com/MightyMulligan-ops/strategy-game/tree/chore/github-actions-ci) | `be46950271e5` | PR [#4](https://github.com/MightyMulligan-ops/strategy-game/pull/4) merged; retain historical branch | diverged; +1/−38 |
| [ci/automation-015-first-codex-smoke](https://github.com/MightyMulligan-ops/strategy-game/tree/ci/automation-015-first-codex-smoke) | `1f611355dd72` | PR [#72](https://github.com/MightyMulligan-ops/strategy-game/pull/72) merged; retain historical branch | diverged; +1/−6 |
| [fix/automation-015-codex-secret-preflight](https://github.com/MightyMulligan-ops/strategy-game/tree/fix/automation-015-codex-secret-preflight) | `d32b7c19bb04` | PR [#73](https://github.com/MightyMulligan-ops/strategy-game/pull/73) merged; retain historical branch | diverged; +2/−5 |
| [issue/2-codex-workflow](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/2-codex-workflow) | `fb813f8a2b84` | PR [#5](https://github.com/MightyMulligan-ops/strategy-game/pull/5) merged; retain historical branch | diverged; +2/−37 |
| [issue/7-lobby-contracts](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/7-lobby-contracts) | `525137bc6489` | PR [#8](https://github.com/MightyMulligan-ops/strategy-game/pull/8) merged; retain historical branch | diverged; +3/−36 |
| [issue/9-lobby-persistence](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/9-lobby-persistence) | `70ff1a8d45c5` | PR [#10](https://github.com/MightyMulligan-ops/strategy-game/pull/10) merged; retain historical branch | diverged; +2/−35 |
| [issue/11-lobby-rest-api](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/11-lobby-rest-api) | `f889ed4d1a21` | PR [#12](https://github.com/MightyMulligan-ops/strategy-game/pull/12) merged; retain historical branch | diverged; +2/−32 |
| [issue/13-sovereign-lobby-ui](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/13-sovereign-lobby-ui) | `abaebf164cae` | PR [#14](https://github.com/MightyMulligan-ops/strategy-game/pull/14) merged; retain historical branch | diverged; +2/−31 |
| [issue/15-local-test-sign-in](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/15-local-test-sign-in) | `9918840eee0e` | PR [#16](https://github.com/MightyMulligan-ops/strategy-game/pull/16) merged; retain historical branch | diverged; +2/−30 |
| [issue/17-lobby-readiness-start](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/17-lobby-readiness-start) | `5ac3d6e78593` | PR [#18](https://github.com/MightyMulligan-ops/strategy-game/pull/18) merged; retain historical branch | diverged; +5/−29 |
| [issue/20-deterministic-world-generator](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/20-deterministic-world-generator) | `3251477f33f4` | PR [#21](https://github.com/MightyMulligan-ops/strategy-game/pull/21) merged; retain historical branch | diverged; +2/−28 |
| [issue/22-persistent-world-map](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/22-persistent-world-map) | `58a7753a7c73` | PR [#23](https://github.com/MightyMulligan-ops/strategy-game/pull/23) merged; retain historical branch | diverged; +2/−27 |
| [issue/24-legacy-world-unavailable](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/24-legacy-world-unavailable) | `63b1da5f346d` | PR [#25](https://github.com/MightyMulligan-ops/strategy-game/pull/25) merged; retain historical branch | diverged; +3/−26 |
| [issue/26-map-accessibility](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/26-map-accessibility) | `c03298b16185` | PR [#27](https://github.com/MightyMulligan-ops/strategy-game/pull/27) merged; retain historical branch | diverged; +2/−25 |
| [issue/28-participant-turn-boundary](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/28-participant-turn-boundary) | `415f4993a63d` | PR [#29](https://github.com/MightyMulligan-ops/strategy-game/pull/29) merged; retain historical branch | diverged; +2/−24 |
| [issue/30-pure-turn-initialization](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/30-pure-turn-initialization) | `89574dd77996` | PR [#31](https://github.com/MightyMulligan-ops/strategy-game/pull/31) merged; retain historical branch | diverged; +2/−23 |
| [issue/32-pr-review-diagnostics](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/32-pr-review-diagnostics) | `9f59b9652189` | PR [#33](https://github.com/MightyMulligan-ops/strategy-game/pull/33) merged; retain historical branch | diverged; +2/−22 |
| [issue/34-ci-evidence-association](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/34-ci-evidence-association) | `9c0c2365469c` | PR [#35](https://github.com/MightyMulligan-ops/strategy-game/pull/35) merged; retain historical branch | diverged; +2/−21 |
| [issue/36-structured-pr-review](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/36-structured-pr-review) | `3f1079fbee74` | PR [#37](https://github.com/MightyMulligan-ops/strategy-game/pull/37) merged; retain historical branch | diverged; +3/−20 |
| [issue/39-atomic-turn-one](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/39-atomic-turn-one) | `facd05b47527` | PR [#40](https://github.com/MightyMulligan-ops/strategy-game/pull/40) merged; retain historical branch | diverged; +3/−19 |
| [issue/42-read-only-turn-status](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/42-read-only-turn-status) | `35af42fa5882` | PR [#43](https://github.com/MightyMulligan-ops/strategy-game/pull/43) merged; retain historical branch | diverged; +3/−18 |
| [issue/45-codex-cloud-workflow](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/45-codex-cloud-workflow) | `2277f72650a5` | PR [#46](https://github.com/MightyMulligan-ops/strategy-game/pull/46) merged; retain historical branch | diverged; +2/−17 |
| [issue/47-read-only-turn-status-ui](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/47-read-only-turn-status-ui) | `440264cd1e23` | PR [#48](https://github.com/MightyMulligan-ops/strategy-game/pull/48) merged; retain historical branch | diverged; +2/−16 |
| [issue/49-authoritative-starting-armies](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/49-authoritative-starting-armies) | `536033f71588` | PR [#50](https://github.com/MightyMulligan-ops/strategy-game/pull/50) merged; retain historical branch | diverged; +1/−15 |
| [issue/51-movement-drafts](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/51-movement-drafts) | `07a72a27edb1` | PR [#52](https://github.com/MightyMulligan-ops/strategy-game/pull/52) merged; retain historical branch | diverged; +2/−14 |
| [issue/53-cloud-handoff](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/53-cloud-handoff) | `d663898aa5da` | PR [#54](https://github.com/MightyMulligan-ops/strategy-game/pull/54) merged; retain historical branch | diverged; +2/−13 |
| [issue/55-acceptance-evidence](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/55-acceptance-evidence) | `5809c341a84f` | PR [#56](https://github.com/MightyMulligan-ops/strategy-game/pull/56) merged; retain historical branch | diverged; +2/−12 |
| [issue/57-review-triage](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/57-review-triage) | `746415eba813` | PR [#58](https://github.com/MightyMulligan-ops/strategy-game/pull/58) merged; retain historical branch | diverged; +2/−11 |
| [issue/59-turn-closure](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/59-turn-closure) | `d62cffdb6275` | PR [#60](https://github.com/MightyMulligan-ops/strategy-game/pull/60) merged; retain historical branch | diverged; +3/−10 |
| [issue/61-movement-resolution](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/61-movement-resolution) | `9d1942a14a87` | PR [#62](https://github.com/MightyMulligan-ops/strategy-game/pull/62) merged; retain historical branch | diverged; +4/−9 |
| [issue/63-owner-gated-orchestration](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/63-owner-gated-orchestration) | `459fb5cc1176` | PR [#65](https://github.com/MightyMulligan-ops/strategy-game/pull/65) merged; retain historical branch | diverged; +2/−8 |
| [issue/66-automation-015-stage1](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/66-automation-015-stage1) | `87c17988e2b9` | PR [#67](https://github.com/MightyMulligan-ops/strategy-game/pull/67) merged; retain historical branch | diverged; +6/−7 |
| [issue/68-automation-015-stage2-design](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/68-automation-015-stage2-design) | `b1cd10802a82` | Superseded #69; retained archive | diverged; +23/−6 |
| [issue/74-select-own-formation](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/74-select-own-formation) | `71173bd78719` | PR [#75](https://github.com/MightyMulligan-ops/strategy-game/pull/75) merged; retain historical branch | behind; +0/−1 |
| [issue/77-manual-codex-worker](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/77-manual-codex-worker) | `74fa2b30d09a` | Open candidate; preserve | ahead; +6/−0 |
| [issue/79-autonomous-codex-pipeline](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/79-autonomous-codex-pipeline) | `0ddf03ab5e9a` | Open candidate; preserve | ahead; +17/−0 |
| [issue/79-hosted-agents-adapter](https://github.com/MightyMulligan-ops/strategy-game/tree/issue/79-hosted-agents-adapter) | `520540565c83` | Open candidate; preserve | ahead; +44/−0 |
| [main](https://github.com/MightyMulligan-ops/strategy-game/tree/main) | `4ac5fca5941f` | Baseline; keep | — |

## Documentation: complete Markdown inventory

Correct stale merged/unpublished claims in README, roadmap and the army/draft/closure/resolution/turn/UI guides, using GitHub merged metadata (PRs #48/#50/#52/#60/#62/#75). Prepend a current development snapshot while retaining the full historical status/attempt/grant evidence. Clarify that local/Cloud prompts do not use API keys, while the separate merged manual Actions smoke does. Keep disabled delegation prose as deferred reference. Two existing static documentation-link test allowlists add exactly `docs/OPTION_B_AUDIT.md`; their path validation, file checks and rejection assertions stay unchanged. No gameplay rules, auth/CSRF, SQL, dependencies, AGENTS instructions, review templates or metadata code are removed or weakened.

| Document | Review disposition |
|---|---|
| [.github/CODEX_CLOUD_APPROVAL.template.md](../.github/CODEX_CLOUD_APPROVAL.template.md) | Retain scope, prompt, review and authorization controls |
| [.github/CODEX_CLOUD_HANDOFF.template.md](../.github/CODEX_CLOUD_HANDOFF.template.md) | Retain scope, prompt, review and authorization controls |
| [.github/CODEX_CLOUD_LAUNCH.template.md](../.github/CODEX_CLOUD_LAUNCH.template.md) | Retain scope, prompt, review and authorization controls |
| [.github/CODEX_CLOUD_PROMPT.md](../.github/CODEX_CLOUD_PROMPT.md) | Retain scope, prompt, review and authorization controls |
| [.github/CODEX_ISSUE_PROMPT.md](../.github/CODEX_ISSUE_PROMPT.md) | Retain scope, prompt, review and authorization controls |
| [.github/CODEX_REPAIR_PROMPT.md](../.github/CODEX_REPAIR_PROMPT.md) | Retain scope, prompt, review and authorization controls |
| [.github/CODEX_REVIEW_PROMPT.md](../.github/CODEX_REVIEW_PROMPT.md) | Retain scope, prompt, review and authorization controls |
| [.github/pull_request_template.md](../.github/pull_request_template.md) | Retain scope, prompt, review and authorization controls |
| [AGENTS.md](../AGENTS.md) | Retain scope, prompt, review and authorization controls |
| [README.md](../README.md) | Status/direction correction proposed |
| [apps/web/README.md](../apps/web/README.md) | Retain product, security, runtime and setup contracts |
| [apps/web/public/assets/branding/README.md](../apps/web/public/assets/branding/README.md) | Retain product, security, runtime and setup contracts |
| [database/README.md](../database/README.md) | Retain product, security, runtime and setup contracts |
| [docs/ATWAR_REFERENCE.md](../docs/ATWAR_REFERENCE.md) | Retain product, security, runtime and setup contracts |
| [docs/AUTHENTICATION.md](../docs/AUTHENTICATION.md) | Retain product, security, runtime and setup contracts |
| [docs/AUTOMATION_014.md](../docs/AUTOMATION_014.md) | Status/direction correction proposed |
| [docs/AUTOMATION_015_CODEX_SMOKE_TROUBLESHOOTING.md](../docs/AUTOMATION_015_CODEX_SMOKE_TROUBLESHOOTING.md) | Retain product, security, runtime and setup contracts |
| [docs/CI.md](../docs/CI.md) | Retain evidence and CI/security instructions |
| [docs/CODEX_PIPELINE.md](../docs/CODEX_PIPELINE.md) | Status/direction correction proposed |
| [docs/CODEX_WORKFLOW.md](../docs/CODEX_WORKFLOW.md) | Status/direction correction proposed |
| [docs/DELEGATION_POLICY_PROPOSAL.v1.md](../docs/DELEGATION_POLICY_PROPOSAL.v1.md) | Status/direction correction proposed |
| [docs/DEVELOPMENT_ROADMAP.md](../docs/DEVELOPMENT_ROADMAP.md) | Status/direction correction proposed |
| [docs/DEVELOPMENT_STATUS.md](../docs/DEVELOPMENT_STATUS.md) | Status/direction correction proposed |
| [docs/GAME_DESIGN.md](../docs/GAME_DESIGN.md) | Retain product, security, runtime and setup contracts |
| [docs/INITIAL_ARMIES.md](../docs/INITIAL_ARMIES.md) | Status/direction correction proposed |
| [docs/INITIAL_WORLD.md](../docs/INITIAL_WORLD.md) | Retain product, security, runtime and setup contracts |
| [docs/LOBBY_API.md](../docs/LOBBY_API.md) | Retain product, security, runtime and setup contracts |
| [docs/LOBBY_UI.md](../docs/LOBBY_UI.md) | Status/direction correction proposed |
| [docs/LOCAL_TEST_LOGIN.md](../docs/LOCAL_TEST_LOGIN.md) | Retain product, security, runtime and setup contracts |
| [docs/MATCH_LOBBIES.md](../docs/MATCH_LOBBIES.md) | Retain product, security, runtime and setup contracts |
| [docs/MOVEMENT_DRAFTS.md](../docs/MOVEMENT_DRAFTS.md) | Status/direction correction proposed |
| [docs/MOVEMENT_RESOLUTION.md](../docs/MOVEMENT_RESOLUTION.md) | Status/direction correction proposed |
| [docs/PR_REVIEW.md](../docs/PR_REVIEW.md) | Retain evidence and CI/security instructions |
| [docs/TECHNICAL_ARCHITECTURE.md](../docs/TECHNICAL_ARCHITECTURE.md) | Retain product, security, runtime and setup contracts |
| [docs/TURN_CLOSURE.md](../docs/TURN_CLOSURE.md) | Status/direction correction proposed |
| [docs/TURN_SYSTEM.md](../docs/TURN_SYSTEM.md) | Status/direction correction proposed |
| [docs/WORLD_GENERATION.md](../docs/WORLD_GENERATION.md) | Retain product, security, runtime and setup contracts |
| [docs/examples/AUTOMATION_014_SYNTHETIC.md](../docs/examples/AUTOMATION_014_SYNTHETIC.md) | Retain explicitly historical/synthetic evidence |
| [docs/examples/CODEX_CLOUD_HANDOFF_PR52.md](../docs/examples/CODEX_CLOUD_HANDOFF_PR52.md) | Retain explicitly historical/synthetic evidence |

The #79 title/body now puts Option B first while retaining the full previous evidence. Since its issue body changed, any scope digest or source-bound grant must be refreshed before future execution; this does not reset earlier attempt budgets. #69's body also corrects its stale design-only inventory while preserving the old description. #78's comment redirects tracking without touching its disabled source.

Issue templates (bug, gameplay-feature, development-task and config), the PR template and JSON approval/review templates are retained. Their narrower local/manual launch wording grants no unattended authority. Earlier milestone exclusions remain scoped to historical cohorts; they must not be read as instructions to undo later merged features. The status log retains earlier counts as history rather than presenting them as current test totals.

## Verification and limits

Read-only GitHub enumeration, per-branch comparison, full PR changed-path inventory, main workflow review and source/tag resolution were performed. Branch-protection read returned integration permission HTTP403; ruleset listing returned HTTP403 with a GitHub plan/visibility message. The branch metadata endpoint reports main `protected:false`, protection `enabled:false`, status-check enforcement `off` with empty contexts. Treat this as a security configuration finding; the detailed administration endpoint remains inaccessible, so full policy/rules configuration cannot be independently inspected. Repository metadata reports auto-merge disabled. No setting was changed. An owner should verify enforcement in GitHub settings; do not weaken visibility or make the private repository public as a workaround.

Local dependency installation/test tooling was unavailable: pnpm's Corepack shim could not resolve registry.npmjs.org. No full build/unit suite or actionlint success is claimed. Focused source/link/boundary checks are recorded in the cleanup PRs; unchanged hosted CI runs normally on draft publication and must be inspected against each actual head/base. Author checks and CI are not independent security certification. No production or existing test database is touched; only the existing hosted disposable PostgreSQL CI is used by publication.

Focused pre-publication checks passed: 43 relative audit-file links resolve, initial Markdown-only documentation scope, complete old development-status body retained, unchanged manual trigger/permissions/concurrency/secret references/summary and timeout in the smoke candidate, preserved owner/repository/main/read-only/drop-sudo guards, first-attempt gate present, and every workflow action is full-SHA pinned. These are static source checks, not actionlint, a paid smoke execution or runtime-isolation proof.

## Cleanup CI correction history

[Initial #83 CI43792588880](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43792588880), source `2c762be46e4b83d4fd67d003c9f2e57d4739102a`: build/typecheck passed; 1,730 application tests passed, two static documentation-link tests failed, 262 deliberate database skips; lint did not run. Disposable PostgreSQL job passed. The new audit file was absent from both explicit link allowlists; the pipeline guide additionally introduced an external Markdown issue link into a local-only link fixture.

Bounded correction pass **1/5**: add only `docs/OPTION_B_AUDIT.md` to those two existing test allowlists and use plain issue text for the new pipeline-guide tracker reference. Retain every path resolution, membership, existence and forbidden-path rejection assertion. No broad directory allowlist, bypass or runtime authority change. Record the old failed run; do not rerun it or reset history. The changed commit triggers normal existing CI and needs fresh results. Final scope: 14 Markdown files plus two existing static test files. No gameplay/runtime code changes.
