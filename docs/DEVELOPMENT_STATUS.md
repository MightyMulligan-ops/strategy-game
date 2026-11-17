# Development status

## PR #99 post-review repair — attempt 1 for COMBAT97-F1/F2 (2026-11-17, unmerged)

The owner explicitly approved the two named findings, bounded repair, regression tests and unchanged hosted fresh disposable PostgreSQL CI in the project conversation: "Approved. Do whatever it takes." This is human-initiated post-review attempt **1/2 for each finding**, separate from the original Stage A 3/5 implementation history and the unrelated clock repair. Existing branch/draft PR `issue/97-multi-force-combat` / [#99](https://github.com/MightyMulligan-ops/strategy-game/pull/99) is reused. Verified starting head `2b6847594323de25b81e8487535198b165dcfbb7`, base `53180055dabde3d406935d76592505692d864cfc`, open draft, previous exact-head CI success and no competing repair claim. Unrelated Python cache files were preserved; no reset, stash, force push, new branch/worktree or agent was used.

- COMBAT97-F1: retain seeded per-source target queues across rounds, with separate per-source/target-owner formation queues. Advance once per action and prune destroyed players/formations without restarting. Initiative queues also retain their rotation and remove eliminated entries before selecting the next start. Targeting no longer depends on the source's position in a globally rotated list.
- COMBAT97-F2: compute the intermediate damage product/division with BigInt, then convert the bounded damage result to Number. Existing unit/stat bounds, RNG streams, roles, ownership rules and historical Prototype 1A remain unchanged. Update the contract's numeric-safety explanation and use an exact-integer test oracle rather than repeat the rounded Number formula.

Regression evidence: the first eight added cases failed against the old engine (31 old cases passed), including raw3343680903/stat3526601 incorrectly yielding2745500 instead of2745499. After repair, all95 focused tests passed:41 new-engine cases including10 new regressions plus54 unchanged prototype/movement cases. Coverage includes four seeds, one-unit/odd-sized defenders, same-player formations, three hostile movers, eliminated players/formations, initiative skips, the precision counterexample and maximum leadership-adjusted stat4000002.

Final task-side checks used `AUTH_ENABLED=false RUN_DATABASE_TESTS=0`: frozen install, Prisma generation, build, typecheck, lint and diff checks all passed. Full database-free suite:2122 passed /263 skipped /zero failures,88 passed files /15 skipped files. Skips are not database verification. The local pnpm command reported11.25.0; the repository-pinned12.18.0 hosted workflow remains the final toolchain authority. No dependency/lockfile/toolchain change was made. Only the new engine, its tests, MULTI_FORCE_COMBAT.md and this evidence entry change in this repair.

Both findings are addressed by this attempt's implementation/tests, pending fresh independent review; the old review is superseded for changed source. Exact published head and final hosted CI evidence belong in the PR handoff to avoid a self-referential evidence commit. Keep outcome UNKNOWN and repairAuthorization NOT_GRANTED until a separately requested independent review. No existing database access, migrations/provisioning, paid API task, workflow/security change, ready transition, main merge or deployment is authorized or performed.

## Combat Stage A CI unblock — PR #99 (2026-11-17, unmerged)

The owner explicitly approved #97 publication/unchanged hosted fresh disposable PostgreSQL CI, then directed: 'Yes, do whatever it takes to fix this and move it forward.' This also covers the separately identified fixture repair needed to unblock the combat PR. [Draft PR #100](https://github.com/MightyMulligan-ops/strategy-game/pull/100) independently reviews the Date-only fix for Issue #98. Apply that same small test-only change here in a separate commit, without changing the five original Stage A files' engine behavior, historical prototype, workflows or runtime expiry checks. No force push, main merge or deployment.

Previous final-head CI [44124338895](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/44124338895) on a7c29d8e8ee566de8c1f4d1102083608c50328fe failed application tests while PostgreSQL passed. The unchanged main independently reproduces the ten clock failures; fixing only Date to the fixture clock restores all 27 cases. Coordinator reviewed the 376-line engine and tests and ran the combat branch plus this exact fixture fix in an isolated exported snapshot: full database-free suite 2112 passed / 263 skipped, zero failures (88 passed files / 15 skipped files). Initial exported-snapshot attempts failed to import workspace dependencies/generated Prisma output; restoring the existing dependency/build links resolved these environment errors without code changes, new dependencies or database access. Hosted exact-head CI remains required and is not inferred from local skips. Original Stage A implementation corrections remain 3/5; separate fixture implementation corrections 0/5. This is in review/unmerged, not live combat.

## Autonomous validator false-success repair — 2026-11-16 (candidate, unmerged)

Owner-authorized subscription Codex repair on `codex/validator-fail-closed`, based on `a7290ceab2e3d55924e1d144c38370a3455c2011`. PR #88's merge was confirmed in GitHub; its older review entries below are historical. Scope: reliable offline pnpm, fail-closed individual check execution, a host-owned execution receipt authenticated through Actions job outputs, publisher refusal before API calls, offline regressions and real networkless-container CI smoke. No gameplay, dependencies, existing databases, paid sessions/dispatches, spending gate, overnight queue, merge or deployment changes are authorized here. Existing local lobby edits are preserved.

The historical validator's green status was false evidence: Corepack lost access to its prepared cache after HOME changed, Bash's AND-list failure was masked by subsequent Git success, and the publisher accepted a reconstruction-only report. The repair also moves tested-workspace tree verification onto the trusted host. Details and trust limits: [SOVEREIGN_PIPELINE_REPAIR.md](SOVEREIGN_PIPELINE_REPAIR.md). Focused receipt/controller/publisher/workflow tests: 40 passed. Frozen install, build, typecheck, lint, actionlint 1.7.12 (without unavailable shellcheck/pyflakes) and diff checks passed. Fresh full database-free Windows tests: 1907 passed, 262 skipped, three known environmental failures (two Python wrappers and one Unix-socket fixture); no tests were disabled. An offline local fixture also verified nested pnpm configuration propagation.

[CI #208](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43911354344) passed on implementation head `3a9e0703531efcfac33979ed60a3ef1f17b78393`: frozen install/build/typecheck/lint, 1910 application tests passed with 262 deliberate database skips, and all 262 PostgreSQL assertions across 15 files with zero skips. The real restricted-container smoke separately completed build, typecheck, test, lint and every host tree check with networking disabled. CI corrections addressed a host-generated Python bytecode file, bounded Docker termination, and pnpm 12's implicit reinstall after workspace relocation; no tests or isolation protections were removed. [Draft PR #90](https://github.com/MightyMulligan-ops/strategy-game/pull/90) remains in review/unmerged and records exact final-head CI. Local Docker was not started; no existing database or paid session was accessed. No live end-to-end paid pilot is claimed, and the overnight queue remains disabled.

## Combat Prototype 1A review — Issue #76 / PR #88 (2026-11-16, unmerged)

The owner requested subscription Codex review/correction on the existing `issue/76-sovereign-pilot-43888968238` branch, normal hosted CI including its fresh disposable PostgreSQL service, and a ready-for-review transition only after verification. This task authorizes no paid Agents session, automatic merge, deployment or existing database access. Reviewed source: `50f9cdb1a0cad163b98b4bb98f355d9e26591e1c`; main/base: `333b9444d377af0ada119f0e3878391bcd37ed7d`. [PR #88](https://github.com/MightyMulligan-ops/strategy-game/pull/88) remains unmerged. Unrelated lobby edits stay in the original checkout.

Gameplay review found the simultaneous exchanges, persistent encounter HP, final-only healing, ATK/DEF roles, ordered overflow, protected Lieutenant removal, mutual destruction and bounded termination consistent with the restricted issue. Paired actors/unmatched-unit behavior is explicitly documented as a versioned prototype policy in GAME_DESIGN section 6; it is not approved multi-army scheduling. Combat stays isolated/server-only with no public exports or integration. Input validation now rejects proxies without invoking their traps, custom array prototypes and hidden array elements; standard Vitest imports replace the archive-only runner fallback. Added regressions cover both sides' unmatched actions, roster targeting, destruction before queued actions, partial-round wounds and maximum round bounds. Baseline focused tests: 21 passed; corrected focused tests: 26 passed. Frozen install (`--ignore-scripts`), build/client generation, typecheck, lint and diff checks passed. Full database-free Windows tests returned 1871 passed, 262 skipped and three environmental failures: two non-executable Python wrappers and the existing Unix-socket path fixture. Initial typecheck exposed an unreachable test-helper branch after assertion narrowing; removing redundant branches retained every assertion and restored the typecheck. [CI #199](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43893987809) on implementation/test head `0dab09a8c4d46c5d4fdba839b1a2c9b84de57ba3` passed both jobs: 1874 application assertions (including all 26 combat cases; 262 deliberate DB skips), build/typecheck/lint, and all 262 PostgreSQL assertions across 15 files with zero skips and successful disposable-service cleanup. The final documentation-only commit receives unchanged normal CI as well; the PR records its exact-head results and ready-for-review transition. Merge remains the owner's decision. Existing pg overlapping-query deprecation warnings remain outside this pure-domain PR. No formula or valid-input audit/version was changed. This review used two bounded local correction passes (input/test coverage, then the unreachable helper branch), separate from the autonomous implementation's one recorded fixture correction.

Historical validation caveat: the green validate job in [pilot run 43888968238](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43888968238) logged a Corepack registry-fetch failure before checks executed. Its status is not evidence of passing build/typecheck/tests. This gameplay review makes no pipeline/workflow changes; final normal PR CI is required. No paid work was requested.

## Sovereign pipeline repair — 2026-11-16 (candidate, unmerged)

The owner requested audit, tested fixes, an isolated branch/draft PR and applicable CI for Actions run 43880452526. This authorizes this repair/publication, not a new paid Agents session, automatic retries, merge, deployment or existing/production database access. The internal $45 cutoff remains removed; Platform spending controls are unchanged. Unrelated uncommitted lobby edits remain intact in the original checkout; work uses `.worktrees/sovereign-repair`, branch `fix/sovereign-hosted-pipeline`, based on `c9f41cd8cd2846102ebd929a865284ebcd728154`.

Owner-authorized read-only Platform logs show the matching hosted turn completed after the controller failed; a 46,601-byte tool result immediately before failure exceeds the old 32 KiB event limit. The exact discarded exception remains unavailable. Repaired defects: stage/status/request-ID loss, cleanup replacing primary errors, memory-only session evidence, unsupported ID-prefix assumptions, coalesced SSE rejection, dependencies preceding clean-tree replay, and missing bounded cancel/delete handling on conflict. See [SOVEREIGN_PIPELINE_REPAIR.md](SOVEREIGN_PIPELINE_REPAIR.md). The 51 mocked controller/transport/workflow tests, local build/typecheck/lint and actionlint 1.7.12 pass; no live controller request or paid session was initiated; existing Platform logs were inspected read-only. Full Windows tests returned 1845 passed, 262 skipped and three environmental failures (two missing-Python wrappers and one Unix-socket path fixture). [Draft PR #87](https://github.com/MightyMulligan-ops/strategy-game/pull/87) is open on this branch. [Linux CI #194](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43886478655) passed on implementation head `65ea2a0`: 1848 application tests passed / 262 intentionally skipped DB cases; separate PostgreSQL job verified all 262 integration tests across 15 files with no skips and cleaned up its disposable service. Build/typecheck/lint passed. A subsequent fixture/documentation-only commit will receive normal exact-head CI; see the PR checks. The prior completed hosted session is reconciled read-only, but its artifacts remain unvalidated and it was not deleted. This is in review, not a completed or live-verified milestone.

This is a short, evidence-based handoff, not a replacement for the rules or roadmap. Issue #57 baseline: latest `origin/main` at `03a122a6556f68c8e1406737602bdb89a9c50853`, including merged PR #56. Earlier issue evidence below is historical. Feature work remains unmerged even when its tests pass.

| Area | State | Evidence / limitations |
|---|---|---|
| TypeScript monorepo and app foundations | Merged | React/Vite, Fastify, package boundaries, checks; no playable game |
| Turn contracts and lifecycle (002) | Merged | Simultaneous drafts, revisions, Ready/deadline closure; no scheduler |
| Deterministic resolution foundation (003) | Merged | Empty turns and movement-queue planning; no gameplay execution |
| PostgreSQL persistence (004A) | Merged | Committed migrations, transactional repositories, live integration tests |
| Accounts and sessions (004B.1) | Merged | Discord/Google adapters, sessions, account UI; real consent/deployment verification remains separate |
| Windows startup automation (005) | Merged | Dependency preparation and preflight; shared packages require restart |
| GitHub Actions CI (006 / Issue #1) | Merged | Application and PostgreSQL checks; owner configures branch protection |
| Local issue-to-draft-PR workflow (007 / Issue #2) | Merged | [PR #5](https://github.com/MightyMulligan-ops/strategy-game/pull/5), `963869a`; local sessions and metadata-only automation |
| Lobby contracts and documentation (004B.2A / Issue #7) | Merged | [PR #8](https://github.com/MightyMulligan-ops/strategy-game/pull/8), `b0164b7`; lifecycle, privacy, capacity, deadline-overflow contracts |
| PostgreSQL lobby persistence (004B.2B / Issue #9) | Merged | [PR #10](https://github.com/MightyMulligan-ops/strategy-game/pull/10), `df975a2`; migration is not approved for the existing development DB; 21 lobby tests / 38 repository tests |
| Authenticated lobby REST API (004B.2C / Issue #11) | Merged | [PR #12](https://github.com/MightyMulligan-ops/strategy-game/pull/12), `5cbd901`; five session-bound operations, safe envelopes and 45 live tests; existing development migration remains unapproved |
| Sovereign account/lobby UI and proxy (004B.2D / Issue #13) | Merged | [PR #14](https://github.com/MightyMulligan-ops/strategy-game/pull/14), `9a45f27`; branded account/lobby UI, original assets and same-origin proxy |
| Loopback local test sign-in (004B.2E / Issue #15) | Merged | [PR #16](https://github.com/MightyMulligan-ops/strategy-game/pull/16), `40c56a3`; explicit loopback/development gates, isolated fixtures and normal sessions/CSRF/lobby authorization |
| Lobby readiness and host start (005A / Issue #17) | Merged | [PR #18](https://github.com/MightyMulligan-ops/strategy-game/pull/18), `280b7fa`; serialized readiness/host/count checks and lifecycle-only start, Open/Started discovery; no world or turn initialization |
| Pure territory world foundation (005B.1 / Issue #20) | Merged | [PR #21](https://github.com/MightyMulligan-ops/strategy-game/pull/21), `e3e4a22`; approved generator/contracts and local balance guarantees, 67 generator tests |
| Persisted initial world and SVG map (005B.2 / Issue #22) | Merged | [PR #23](https://github.com/MightyMulligan-ops/strategy-game/pull/23), `432f37b`; immutable JSONB initial archive, atomic guarded start, participant-only projection/API and SVG inspector; legacy worldless matches remain UNINITIALIZED |
| Legacy world-unavailable messaging (005B.3A / Issue #24) | Merged | [PR #25](https://github.com/MightyMulligan-ops/strategy-game/pull/25), `a76be4b`; frontend-only explanation for legacy RUNNING matches, which remain UNINITIALIZED; no automatic or host-triggered initialization is authorized |
| Read-only map accessibility (005B.3B / Issue #26) | Merged | [PR #27](https://github.com/MightyMulligan-ops/strategy-game/pull/27), `17804c5`; focused accessibility/state regressions and static-mock Chromium checks. Existing manual acceptance limitations remain in INITIAL_WORLD.md; no deferred accessibility enhancements are included in 006A |
| Participant-authorized turn boundary (006A / Issue #28) | Merged | [PR #29](https://github.com/MightyMulligan-ops/strategy-game/pull/29), `324b11b`; strict participant-authorized read/Ready fixture API and own-player projection. Requires explicit fixture injection and NODE_ENV=test; no production wiring or durable acknowledgement |
| Pure initial-world Turn 1 foundation (006B.1 / Issue #30) | Merged | [PR #31](https://github.com/MightyMulligan-ops/strategy-game/pull/31), `a63dae7`; confirmed merged in GitHub before Automation 008. Pure server-only foundation; atomic persisted initialization and production integration remain unimplemented. See TURN_SYSTEM.md; no gameplay code or contract is changed by Automation 008 |
| Read-only PR summaries / CI diagnostics (Automation 008 / Issue #32) | Merged | [PR #33](https://github.com/MightyMulligan-ops/strategy-game/pull/33), `ad1a3ff`; trusted-main read-only workflow, protected flags, sanitized diagnostics and human-started handoff. First live summary exposed missing run-to-PR associations despite successful CI run 43265346907; follow-up Issue #34 addresses evidence discovery, not failed tests. Existing CI/status automation and gameplay unchanged. See PR_REVIEW.md |
| Missing CI association recovery (Automation 008A / Issue #34) | Merged | [PR #35](https://github.com/MightyMulligan-ops/strategy-game/pull/35), `2224ba0`; confirmed merged before Issue #36. Unique read-only commit lookup, exact provenance and conservative ambiguity/fork rejection; 114 reporter tests / 754 workspace tests passed locally. Hosted CI passed both checks with 73 disposable-DB assertions and no skips. Live PR #33 reporter recovery has not been independently observed in this task; owner dispatch evidence remains separate. No gameplay or existing DB changes |
| Structured review / bounded repair (Automation 009 / Issue #36) | Merged | [PR #37](https://github.com/MightyMulligan-ops/strategy-game/pull/37), `52608c9`; prompts, advisory JSON handoff and bounded human-started repair/PC policy. Static tests guard templates, not reviewer compliance; no runtime model invocation or workflow change |
| Owner-started cloud development pilot (Automation 010 / Issue #45 Phase 2) | Merged | [PR #46](https://github.com/MightyMulligan-ops/strategy-game/pull/46), `2c860dfa74b4f5343c04ddfbf9f179bbd34c9c6f` (merge confirmed in GitHub); owner-approved cloud prompt and narrowly scoped instructions/docs. Separate owner authorization for unchanged hosted fresh disposable PostgreSQL CI was recorded in the active task chat. Local workflow and two-attempt post-review repair policy remain unchanged; later gameplay/default adoption require separate approval. Current-task verification and PR evidence follow below |
| Atomic initial-world Turn 1 (006B.2 / Issue #39) | Merged | [PR #40](https://github.com/MightyMulligan-ops/strategy-game/pull/40), `5872e85`; creation-time pins, atomic start, strict v2 restoration and pre-mutation guards, one offline-reviewed additive migration. 830 local DB-free tests and unchanged hosted CI passed; guard verified 107 disposable PostgreSQL assertions across 7 files, no skips. No existing database/sandbox migration or gameplay/production 006A wiring is authorized |
| Production read-only Turn 1 status (006C.1 / Issue #42) | Merged | [PR #43](https://github.com/MightyMulligan-ops/strategy-game/pull/43), `388032d`; dedicated authenticated GET, active-member authorization before private state, PostgreSQL read-only repeatable-read restoration and strict own-player projection. Frozen install/build/typecheck/lint, 888 local DB-free unit/HTTP/security cases (58 new), actionlint and diff/scope/secret-pattern audit passed; all 117 PostgreSQL assertions (10 new) deliberately skipped locally. [Hosted CI run 64](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43307843050) passed both checks on `e7014c8`; guard verified 117 passed integration cases across 8 files, no skips, including the new reader suite. No schema/migration/dependency/workflow/frontend changes or existing DB access |
| Read-only Turn 1 status UI (006C.2A / Issue #47) | Merged | [PR #48](https://github.com/MightyMulligan-ops/strategy-game/pull/48), `ed1b7cb1b9a08636723bb8691c2a0d6a2c486e54` (merge confirmed in GitHub); unchanged production GET, independent manual turn/world reads, strict own-player projection, absolute timestamps and session cleanup. [Owner implementation and separate hosted disposable-CI approval](https://github.com/MightyMulligan-ops/strategy-game/issues/47#issuecomment-6840432011). No turn mutations, backend/contracts/schema/dependencies/CI changes |
| Authoritative starting armies (006D.1 / Issue #49) | Merged | [PR #50](https://github.com/MightyMulligan-ops/strategy-game/pull/50), `cb088ec5e8f2c103f026760b19de7023152a7cfa`; predecessor merge confirmed before Issue #51 implementation. Historical local/publication evidence below remains a point-in-time record |
| Movement drafts (006D.2 / Issue #51) | Merged | [PR #52](https://github.com/MightyMulligan-ops/strategy-game/pull/52), `f2b8fc2f72438c8594c174bb51390c7b352f65d8`; confirmed before Issue #53. Corrective head `07a72a27edb121c57aac5ed601b125ef83cc782c` passed CI run #76: 1205 application / 191 PostgreSQL cases, zero failed and zero PostgreSQL skips; fresh service cleaned up. No existing database migration/deployment approved |
| Reusable cloud handoff and bundled approvals (Automation 011 / Issue #53) | Merged | [PR #54](https://github.com/MightyMulligan-ops/strategy-game/pull/54), `4c299af1f92fb4068d81dee432b1a5e5cfaa7272`; predecessor merge verified before Issue #55. Head `d663898aa5da1e9c25aed289bb6bc53a8e841707` passed CI #79 attempt 1: 1255 application / 191 PostgreSQL cases, zero failures/DB skips; disposable cleanup verified. Earlier draft checkpoints remain historical |
| Read-only acceptance packet (Automation 012 / Issue #55) | Merged | [PR #56](https://github.com/MightyMulligan-ops/strategy-game/pull/56), `03a122a6556f68c8e1406737602bdb89a9c50853`, verified before Issue #57; CI #82 attempt 1 passed 1294 application / 191 PostgreSQL cases, zero failures/DB skips, cleanup successful. Live hosted-format validation is a separate observation below |
| Read-only triage / exact-head review text (Automation 013 / Issue #57) | Merged | [PR #58](https://github.com/MightyMulligan-ops/strategy-game/pull/58), `1c4c1348a786c50843181ca16c61e97a56d1bcdc`; merge independently verified before Issue #59. Prior draft/CI records below remain historical |
| Production turn command APIs, scheduler | Planned | Next Phase 0B work; account authentication alone does not grant match permissions |
| Map, gameplay, leadership, Military Supplies | Planned | Rules remain in GAME_DESIGN.md; no claim of implemented gameplay |

## Update policy

1. At task start, record the issue and branch as **in progress** after verifying the approved scope and existing claim. At draft PR creation, record the real PR link and **in review / unmerged**. Record **blocked** only with the exact unresolved decision/dependency and owner action needed.
2. Update this file in every task PR when behavior, milestone progress, verification, or next steps change. Update the roadmap/rules/interfaces too when those authoritative documents are affected; status labels alone cannot change game design.
3. Record commands actually run, their results, and material limitations in the PR. Never infer test success, real OAuth verification, capacity, or completion from placeholder code, labels, or a passing unrelated check. Do not include secrets, local `.env`, OAuth URLs, or hidden player state.
4. Mark a milestone **merged** only after confirming the merge on `main`, citing the merged PR/commit. A later task can record the preceding task's confirmed merge. A feature branch may describe its own work as implemented/in review, but must not mark itself merged or automatically check roadmap items as complete before human merge.
5. Keep open design decisions explicit. Labels show coordination state; GitHub PR state and merged code are the completion evidence. A closed issue without merged implementation is not proof of delivery.
6. No GitHub workflow edits this file, creates code, starts Codex, merges, or deploys. The owner-started local session or explicitly approved cloud task maintains it, and a person reviews the change. Avoid percentages and invented completion dates.

## Automation 010 Phase 2 evidence (Issue #45)

Historical publication-time evidence follows; GitHub now confirms PR #46 and PR #48 are merged (table above). Their earlier CI approvals do not authorize Issue #49 CI.

- Approval: the owner's Phase 2 record in Issue #45 and explicit cloud-task request authorize prompt/instruction/workflow-documentation/status/tests only. The owner separately answered **Authorize disposable hosted CI for Issue #45** in this task chat before PR publication; only unchanged CI's fresh disposable service is covered.
- Prior published-environment checks (pnpm 12.18.0, Prisma Client 7.10.1, build/typecheck/lint, 888 database-free tests) are **owner-supplied setup evidence**, not tests newly run by this implementation task.
- Current-task checks passed with `AUTH_ENABLED=false` and `RUN_DATABASE_TESTS=0`: pnpm 12.18.0 frozen install (unchanged lockfile), `pnpm db:generate` (Prisma Client 7.10.1), `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` (**896 passed across 31 files; 117 live assertions across 8 files deliberately skipped**). The focused cloud/review prompt suite passed **39 tests**. `git diff --check` and the nine-file scope/credential-pattern audit passed. No workflow edits were made, so actionlint was not applicable.
- Implementation correction pass **1/5**: the initial focused run passed 38 checks and failed the existing documentation-link guard because an anchor-only link resolved to the `docs/` directory. Changed only that workflow-guide link to an explicit file-and-anchor target, without allowing directory targets or weakening assertions; re-verification passed all 39 focused checks and the full suite above. No unresolved implementation failure, synthetic defect or post-review repair. Static prompt guards demonstrate policy text only, not agent compliance or product behavior.
- Delivery: [draft PR #46](https://github.com/MightyMulligan-ops/strategy-game/pull/46) targets `main` from the sole issue branch and remains **in review / unmerged**. Current-head hosted CI evidence is pending and must be checked against the final head; pending results are UNKNOWN. No existing database access, task-side migrations, PostgreSQL/Docker, runtime/schema/dependency/CI/settings changes, merge or deployment is included. Cloud remains opt-in; a later gameplay issue and default adoption need separate owner approval.

## Next planned development slice

006C.1's production GET and Issue #47's read-only UI are merged. Issue #49 prepares initialization-only starting armies on one local branch; it remains unmerged. Production Ready/orders, world-aware freezing/resolution, durable acknowledgements and scheduling remain unimplemented and need separate approval. Parent #19 remains open; legacy RUNNING worlds remain UNINITIALIZED with no initialization authorized. No existing database/sandbox operation, gameplay, automatic merge or deployment is authorized. PR #33 reporter live recovery remains separate evidence work.

## Read-only Turn 1 UI evidence (Issue #47)

The owner explicitly approved implementation and separately authorized unchanged hosted CI using newly provisioned disposable PostgreSQL in [the approval comment](https://github.com/MightyMulligan-ops/strategy-game/issues/47#issuecomment-6840432011). Task-side checks use AUTH_ENABLED=false and RUN_DATABASE_TESTS=0; no existing database or task-side database service is used. Verification passed with pnpm 12.18.0: frozen install (lockfile unchanged), Prisma Client 7.10.1 generation, build, typecheck, lint, and **941 workspace tests across 33 files**, with **117 live DB assertions across 8 files deliberately skipped**. Initial focused execution passed 119 UI/transport/map/account tests before adding the account-expiry integration regression, which passed in the full suite. Chromium using only mocked HTTP responses passed desktop/mobile layout (1280/390px), GET-only requests, absolute timestamps, independent availability/refresh and session-expiry cleanup; screenshots remain outside Git under /tmp. No existing backend/database was started or contacted. Diff/scope/credential-pattern checks passed. CI workflows are unchanged, so actionlint is not applicable. [Draft PR #48](https://github.com/MightyMulligan-ops/strategy-game/pull/48) targets main and remains draft / in review / unmerged. Exact-head hosted CI results will be recorded in the PR handoff after observation; this publication-time snapshot does not claim CI success. Correction passes: **0/5, not exercised**; no failed check or post-review repair has occurred.

## Issue #49 cloud implementation handoff — 006D.1

State: local branch `issue/49-authoritative-starting-armies`, implementation prepared / unmerged; no PR or hosted CI initiated. The active owner request authorizes implementation, protected runtime/contracts/API/UI changes and additive SQL authoring. It explicitly prohibits migration execution, existing-database access, local PostgreSQL/Docker, dependencies/CI edits and hosted PostgreSQL CI without separate approval. Prior issue CI approvals do not apply.

See [INITIAL_ARMIES.md](INITIAL_ARMIES.md) for decisions, compatibility and migration risks. New initial-armies production creation pin is explicit; old creation callers/default, existing OPEN/RUNNING pins, old snapshots and world archive remain unchanged. No executable gameplay is enabled.

Verification: final database-free checks passed with AUTH_ENABLED=false / RUN_DATABASE_TESTS=0 (evidence below). Database-backed integration tests are authored but not executed. No existing database, migration command, PostgreSQL/Docker or database-backed server was accessed/started. Hosted CI evidence: NOT RUN (authorization absent). Publication remains blocked until separate owner approval for the unchanged hosted workflow's newly provisioned disposable PostgreSQL service for Issue #49.

Correction-pass accounting: see append-only history below; no independent PR review has started.

### Correction pass 1 (started)

Initial `pnpm build` failed (web TS1294, erasableSyntaxOnly parameter property); initial `pnpm typecheck` failed during prepare:checks (snapshot insert signatures omitted v3 union). Frozen pnpm 12.18.0 installation, standalone Prisma generation and lint passed. Pass 1 fixes those type boundaries without changing scope; subsequent build/typecheck/unit results follow. No database checks or hosted CI were started.

Pass 1 outcome: full build and typecheck passed (exit 0); `pnpm test` passed (38 files, 1064 tests; 9 database files / 158 tests skipped). Mocked Chromium passed native keyboard inspector, single map Tab stop/arrow focus, six own units, mobile scroll containment, unsupported/session cleanup and GET-only traffic at 1440x1000 / 390x844 on a pure 40-player/1050-territory fixture. Initial Playwright launch used a missing bundled executable; selecting the already installed `/usr/bin/chromium` resolved the environment path without installation/dependency edits.

### Correction pass 2 (started)

Visual inspection found the diamond outline touched the capital text; increase the centered outline to clear both capital and player labels. Add focused database-free creation-pin and derive-before-clock tests, plus a hosted-only rollback assertion for the final RUNNING transition. Scope remains initialization-only. Verification follows; database behavior remains unexecuted.

Pass 2 outcome: typecheck, affected web build and lint passed (exit 0). Full test suite passed: 39 files / 1067 tests, with 9 database files / 159 tests skipped. Mocked desktop/mobile Chromium passed again with the adjusted marker; no page errors or non-GET traffic.

### Correction pass 3 (started)

Final scope/guard review: explicitly reject reassignment out of a new-runtime parent before choosing the destination profile; old guards remain unchanged. Remove an arbitrary 100-waypoint helper input cap so cumulative distance alone controls approved eligibility (no new order-count rule), and assert a 101-zero-segment path. Add the hosted-only reassignment refusal assertion. Database validation remains unrun. Verification follows.

Pass 3 outcome: full build, typecheck and lint passed (exit 0); full tests passed (39 files / 1067 tests, 9 database files / 159 tests skipped). No unresolved database-free failure. Final accounting: **3/5 bounded correction passes used**; no independent review or post-review repair occurred.

### Final verification and delivery boundary

All commands used the published toolchain with AUTH_ENABLED=false and RUN_DATABASE_TESTS=0. Initial failures and corrections are retained above.

| Check | Final result |
|---|---|
| `pnpm --version` | Exit 0; pinned 12.18.0 |
| `pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store` | Exit 0; lockfile unchanged |
| `pnpm db:generate` | Exit 0; Prisma Client 7.10.1 generated without database access |
| `pnpm build` | Exit 0; full workspace build |
| `pnpm typecheck` | Exit 0; source and test TypeScript checks |
| `pnpm lint` | Exit 0 |
| `pnpm test` | Exit 0; 1067 passed / 159 database tests deliberately skipped, 39 passed / 9 skipped files |
| Mocked Chromium | Passed 1440x1000 and 390x844, pure 40-player/1050-territory fixture; keyboard/native inspection, map focus, marker, mobile containment, forced colors visibility, unavailable/session cleanup, GET-only traffic and no page errors |
| `git diff --check` / scope / credential-pattern review | Passed; 41 approved files, zero credential-pattern hits; no dependency, lockfile, workflow, historical SQL, Prisma model or generator edits |
| Hosted PostgreSQL CI | NOT RUN; no Issue #49 authorization, no PR initiated |

Real SQL syntax/trigger execution, transaction rollback/concurrency, read-only database isolation, migration upgrade application and parent cascade remain **unverified**. Authored hosted-only integration tests cover these boundaries where applicable; skipped tests are not database evidence. Existing databases, migrations, PostgreSQL/Docker and database-backed servers were never accessed/run. A frontend-only Vite preview served built static assets for browser checks, with every auth/API response mocked; it is stopped after verification. Screenshots and synthetic browser harness/fixtures remain outside Git under `/tmp`.

Migration risk: the new functions/triggers (including narrowly replaced old admission function) require separately approved fresh-disposable-CI execution before review/merge. Applying SQL to any real environment and deploying the creation pin require separate owner authorization and sequencing; deploy with old SQL would fail closed on new-runtime starts. Legacy and initial-world-v1 branches remain preserved, with no backfill/repin/repair. Source-radius, general movement/contact/vacating and executable runtime transitions remain future decisions and do not block this initialization-only implementation.

Delivery: one local issue branch and coherent implementation commit; not pushed, no draft PR, no hosted database CI, merge or deployment. [Issue coordination claim](https://github.com/MightyMulligan-ops/strategy-game/issues/49#issuecomment-6842346034) records the branch and boundaries. The user can review the local change now. Publication requires separate explicit owner approval for unchanged hosted CI's newly provisioned disposable PostgreSQL service for **Issue #49**, as required by `.github/CODEX_CLOUD_PROMPT.md` step 13 and the active user request.

### Changed-file inventory

- `apps/server/src/app.ts`
- `apps/server/src/formations/read-routes.ts`
- `apps/server/src/index.ts`
- `apps/server/tests/formation-read.test.ts`
- `apps/server/tests/lobby-fixture.ts`
- `apps/web/src/App.css`
- `apps/web/src/Formations.tsx`
- `apps/web/src/WorldView.test.tsx`
- `apps/web/src/WorldView.tsx`
- `apps/web/src/formation-api.ts`
- `database/README.md`
- `database/prisma/migrations/202611130001_initial_armies/migration.sql`
- `database/src/formation-read-repository.ts`
- `database/src/index.ts`
- `database/src/lobby-repository.ts`
- `database/src/turn-read-repository.ts`
- `database/src/turn-storage.ts`
- `database/tests/army-creation.test.ts`
- `database/tests/formation-read-repository.test.ts`
- `database/tests/initial-armies-fixture.ts`
- `database/tests/initial-armies-migration.test.ts`
- `database/tests/initial-armies.integration.test.ts`
- `database/tests/lobby-start.test.ts`
- `database/tests/turn-storage.test.ts`
- `docs/DEVELOPMENT_ROADMAP.md`
- `docs/DEVELOPMENT_STATUS.md`
- `docs/GAME_DESIGN.md`
- `docs/INITIAL_ARMIES.md`
- `docs/INITIAL_WORLD.md`
- `docs/TECHNICAL_ARCHITECTURE.md`
- `docs/TURN_SYSTEM.md`
- `packages/game-engine/src/army-movement.ts`
- `packages/game-engine/src/index.ts`
- `packages/game-engine/src/initial-armies.ts`
- `packages/game-engine/src/resolution.ts`
- `packages/game-engine/tests/army-movement.test.ts`
- `packages/game-engine/tests/initial-armies-fixture.ts`
- `packages/game-engine/tests/initial-armies.test.ts`
- `packages/shared-types/src/formations-view.ts`
- `packages/shared-types/src/index.ts`
- `packages/shared-types/src/server.ts`

## Issue #51 — 006D.2 local implementation handoff

Baseline: origin/main `cb088ec5e8f2c103f026760b19de7023152a7cfa`, confirmed merged PR #50 (head `536033f715887e521b85ee4cc325b7f352ed13dc`). Branch: `issue/51-movement-drafts`; local in progress / unmerged / unpublished. Prior Issue #49 status and evidence above are historical snapshots; PR #50 is now merged. Its Gate D authorization does not apply to Issue #51.

The active owner request grants Gates B/C only: implementation and additive SQL authoring. No existing or disposable database, migration execution, hosted CI, push, PR, merge, deployment, workflow/settings change or new task is authorized. No remote issue metadata is changed by this local-only task. The cloud runtime briefly restarted; readiness was awaited and the same preserved branch/worktree was verified before continuing.

Architecture review identified that generic applyTurnCommand observes/closes overdue turns; the new production adapter never calls it. A distinct strict v4 snapshot binds the new runtime and the unchanged v3 army identity. Existing immutable pins/cohorts/archives remain preserved. Queue GET/POST uses existing storage and private DTOs; no new models/dependencies or execution are introduced. Details and migration risks: [MOVEMENT_DRAFTS.md](MOVEMENT_DRAFTS.md).

Initial implementation verification pending. Correction budget for Issue #51: **0/5 used** before initial checks (Issue #49 history remains separate). PostgreSQL suites are authored and deliberately unexecuted. Exact checks, counts, corrections and final local commit evidence follow; no milestone completion is claimed before owner review/merge.

### Issue #51 correction pass 1 (started)

Initial frozen pnpm 12.18.0 install, Prisma 7.10.1 generation and lint passed. Build passed shared types, engine and web, then failed database compilation: an accidentally rewritten validator import and a replay-map active flag inferred as literal true. Pass 1 fixes only these type boundaries and verifies full build/typecheck/tests. No tests/database/CI claims are inferred from the partial build.

Pass 1 outcome: full build passed after type fixes. Full database-free suite passed (44 files / 1202 tests; 11 PostgreSQL files / 183 tests skipped). Database/server test typechecks passed separately. Full typecheck found only the new engine fixture's widened archive literals, so remains failed pending correction. No SQL/database commands ran.

### Issue #51 correction pass 2 (started)

Parse the new engine fixture's archive through its strict contract to retain literal types. Review also found that aborting a pending save through a formation refresh could leave the surviving queue component busy; reset local action state only on context-effect restart and add a late-write regression test. No POST retry or authority change. Verification follows.

Pass 2 outcome: full typecheck, lint and affected web build passed; full database-free suite passed (44 files / 1203 tests; 11 database files / 183 tests skipped). Added a scoped SQLSTATE mapping unit assertion and a hosted-only expired-SQL-window assertion during final coverage review; their next verification is recorded below. No SQL was executed.

### Issue #51 correction pass 3 (started)

Chromium's exact label lookup failed because the formation label wrapped the select and included option text. Separate the native label/select, retain the responsive field wrapper, and assert the exact label text. Rebuild and repeat mocked desktop/mobile/dense-map verification, including pointer map selection. No runtime, database or gameplay change.

Pass 3 also moves focus to the destination field after map choice (the temporary map-choice button disappears) and treats a well-shaped but wrong-origin POST acknowledgement as uncertain, requiring one authoritative GET. Added focused assertions; no mutation retry or authority widening. The SQL deadline-code unit mapping and hosted-only clock-skew test are included in final verification.

Pass 3 outcome: full build, web rebuild and full source/test typecheck passed. Mocked Chromium passed 1440x1000 / 390x844 on 40 players / 1050 territories, including six explicit CSRF-protected POST actions, pointer/keyboard map choices, stable edit/reorder/cancel, unchanged formation marker, dotted routes, one SVG Tab stop, mobile containment and no page errors. Lint rejected a ref captured by the map-choice render callback (`react-hooks/refs`); no rule was disabled.

### Issue #51 correction pass 4 (started)

Move destination focus into an effect driven by a local focus request; event callbacks pass state only. Keep the exact native label and focus regression assertions. Final build/typecheck/lint/database-free tests/browser results follow. No SQL or database check is run.

Pass 4 interim outcome: affected web build completed. During the environment restart the full suite reported 1183 passed / 22 failed / 184 database tests skipped; every failure was a 5s test timeout (plus one 10s teardown timeout) in three existing suites, with no assertion failure. Environment readiness/worktree were reverified after the owner's Resume request. Repeat unchanged checks sequentially after this concrete environment change; do not alter timeouts or assertions. This verification-only repeat consumes no additional correction pass. The final browser process handle was lost during restart, so browser evidence must be recollected on the final build.

Pass 4 resumed outcome: lint passed; unchanged full suite passed after environment readiness (44 files / 1205 passed, zero failed; 11 database files / 184 assertions skipped). This confirms the timeout-only run above remains recorded but does not represent a remaining test failure. No test timeout, assertion or workflow was changed.

### Issue #51 correction pass 5 (started — final allowance)

Final authoring review found the SQL route helper's alias x shared a name with its coordinate variable, and checking integrality after float conversion could lose fractional JSONB precision. Use a distinct entry alias, reject fractional exact numeric values before conversion, and align trimmed order-ID checks with the public contract. Author one hosted-only direct guard regression; do not execute SQL. This is within approved Gate C and changes no historical migration or gameplay rule. Final checks follow; any unresolved implementation failure after this pass requires owner review.

Pass 5 outcome: final full build and full source/test typecheck passed (exit 0). Final `pnpm test` passed **1205 tests / 0 failed / 185 deliberately skipped database assertions**, across **44 passed / 0 failed / 11 skipped files**. Final lint passed. The final mocked Chromium run passed on the final web bundle, including pointer and keyboard map choices, destination focus, six explicit scoped CSRF POST actions, stable edit/reorder/cancel, unchanged formation position, budget display, dotted routes, single SVG Tab stop, mobile scroll containment and no page errors. Manual desktop/mobile screenshots were inspected. **5/5 correction passes used; no unresolved database-free failure.** No further corrective edits or post-review repair are authorized in this task.

### Issue #51 final verification and boundaries

| Command/check | Actual result |
|---|---|
| `pnpm --version` | Exit 0, pinned 12.18.0 |
| `pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store` | Exit 0; unchanged dependency/lock files |
| `pnpm db:generate` | Exit 0; Prisma Client 7.10.1; no database connection |
| `pnpm build` | Exit 0; final full application build |
| `pnpm typecheck` | Exit 0; source and test code, including gated integration files |
| `pnpm lint` | Exit 0; no disabled rules |
| `pnpm test` | Exit 0; 1205 passed, 0 failed, 185 database tests skipped; 44 passed / 11 skipped files |
| Mocked Chromium | Passed 1440x1000 and 390x844, 40 players / 1050 territories; all API/auth responses synthetic; no existing backend contacted |
| Diff/scope/credential-pattern review | Passed; 43 approved files; zero credential-pattern hits; no dependency, workflow/settings, Prisma model, historical SQL or world-generator changes |
| PostgreSQL/migration/hosted CI | NOT RUN / NOT AUTHORIZED for Issue #51 |

Every task check used AUTH_ENABLED=false and RUN_DATABASE_TESTS=0. The interrupted timeout-only run and all correction history remain above. The frontend-only Vite static preview was stopped; its temporary browser harness, synthetic fixture, screenshots and logs remain outside Git under /tmp.

Authored but unexecuted: `database/tests/movement-drafts.integration.test.ts` (24 assertions) and `apps/server/tests/movement-drafts.integration.test.ts` (2 assertions), guarded for separately approved fresh hosted CI. They cover new initialization/restoration, multi-connection revision races, independent players, stable swaps/cancellation, per-stage rollback, expiry and SQL clock skew, exact fractional JSONB/trim validation, immutable artifacts/Ready/Turn 2 refusal, old-cohort refusal, read-only isolation/concurrent reads, parent cleanup and real persisted-session HTTP privacy. The unchanged older 159 database assertions also remain unexecuted in this task; total skipped is 185. Compilation, in-memory transaction injection and SQL inventory checks are not PostgreSQL evidence.

Runtime: new trusted creation pin `movement-drafts/1` / `movement-drafts-v1`, strict snapshot v4 `movement_drafts`, separate canonical hash plus bound v3 army snapshot identity. Army IDs, six-unit composition, coordinates, source nodes and archived world remain unchanged; no existing match is repinned or repaired. Accepted drafts alone advance own revision/history, remain unready and never update Turn/formation/world state. Queue GET/POST is session/membership scoped with POST Origin/CSRF, rate limits, private headers and safe errors; uncertain acknowledgements use GET reconciliation without POST retry. See [MOVEMENT_DRAFTS.md](MOVEMENT_DRAFTS.md) for complete contracts/decisions.

Migration `202611130002_movement_drafts/migration.sql` is authoring only: 9 functions / 20 triggers, with only the historical admission function replaced by a byte-preserving old-branch extension. All earlier immutable guards remain installed; new write permissions are scoped to the exact new runtime. No schema tables/models or existing data are rewritten. Actual SQL execution, trigger semantics, physical transaction rollback/concurrency/isolation, migration compatibility/application, driver deadline-code behavior and cascades remain unverified until separate Gate D approval. Existing-environment migration and deployment require separate authorization and correct sequencing before the new creation pin is deployed. Long audit histories have replay cost; closely spaced SVG waypoint labels can overlap, with the separate native queue providing unambiguous numbered details. No gameplay collision/contact/radius policy is invented.

Delivery: one dedicated local branch `issue/51-movement-drafts` and one coherent local implementation commit, prepared / unmerged / unpublished. **No database of any kind accessed, no migration executed, no PostgreSQL/Docker or database-backed server started, no branch pushed, no PR published, no hosted CI run, no repository settings/workflows changed and no deployment performed for Issue #51.** Stop after the implementation report and await separate owner approval for the next gate. Full changed-file inventory follows.

### Issue #51 changed files

- `README.md`
- `apps/server/src/app.ts`
- `apps/server/src/index.ts`
- `apps/server/src/turns/movement-routes.ts`
- `apps/server/tests/lobby-fixture.ts`
- `apps/server/tests/movement-draft.test.ts`
- `apps/server/tests/movement-drafts.integration.test.ts`
- `apps/web/src/App.css`
- `apps/web/src/MovementQueue.test.tsx`
- `apps/web/src/MovementQueue.tsx`
- `apps/web/src/WorldView.test.tsx`
- `apps/web/src/WorldView.tsx`
- `apps/web/src/movement-api.ts`
- `database/README.md`
- `database/prisma/migrations/202611130002_movement_drafts/migration.sql`
- `database/src/formation-read-repository.ts`
- `database/src/index.ts`
- `database/src/lobby-repository.ts`
- `database/src/movement-draft-repository.ts`
- `database/src/movement-draft-storage.ts`
- `database/src/turn-read-repository.ts`
- `database/src/turn-storage.ts`
- `database/tests/army-creation.test.ts`
- `database/tests/lobby-start.test.ts`
- `database/tests/movement-draft-fixture.ts`
- `database/tests/movement-draft-migration.test.ts`
- `database/tests/movement-draft-repository.test.ts`
- `database/tests/movement-drafts.integration.test.ts`
- `database/tests/turn-storage.test.ts`
- `docs/DEVELOPMENT_ROADMAP.md`
- `docs/DEVELOPMENT_STATUS.md`
- `docs/GAME_DESIGN.md`
- `docs/INITIAL_ARMIES.md`
- `docs/MOVEMENT_DRAFTS.md`
- `docs/TECHNICAL_ARCHITECTURE.md`
- `docs/TURN_SYSTEM.md`
- `packages/game-engine/src/index.ts`
- `packages/game-engine/src/movement-drafts.ts`
- `packages/game-engine/src/resolution.ts`
- `packages/game-engine/tests/movement-drafts.test.ts`
- `packages/shared-types/src/index.ts`
- `packages/shared-types/src/movement-drafts.ts`
- `packages/shared-types/src/server.ts`

### Issue #51 owner-authorized corrective pass 1 — local only

This append-only entry supersedes the prepublication delivery state above without erasing the original five implementation passes. The owner subsequently authorized exact publication of `914be9ec0d45968e2cd640ae51c70a8a91befdcb`; [draft PR #52](https://github.com/MightyMulligan-ops/strategy-game/pull/52) remains open/unmerged. [CI run #75, attempt 1](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43365830862) passed application checks (1205 passed / 0 failed / 185 deliberately skipped database cases) but failed PostgreSQL integration (160 passed / 25 failed / 0 skipped). All eight migrations installed in fresh disposable PostgreSQL; 25 of the 26 new cases failed, predominantly during initialization with `record "new" has no field "stateVersion"`. The disposable container/network were removed. No retry was performed.

The current owner request authorizes **one additional narrowly scoped corrective pass**, on the existing local `issue/51-movement-drafts` branch from that exact baseline, with no publication, PR update, CI, database access or migration execution. This is corrective pass **1 of this separate authorization**; the earlier **5/5 implementation passes remain exhausted**.

Diagnosis and changes: PostgreSQL resolves record fields within a Boolean expression without the assumed table-name short circuit. In `guard_movement_draft_artifact()`, split four combined conditions into explicit outer table checks and unchanged inner predicates: snapshot metadata; Turn 1 metadata; revision-zero PlayerTurnState; and revision-zero PlayerSubmissionRevision. The existing `IS TRUE`/`IS NOT TRUE` NULL handling, error text, runtime/lifecycle gates, immutability, deadline checks, locking, revision rules and transaction boundaries stay unchanged. No other migration or application code changes.

Regression authoring strengthens initialization checks for all four roster sizes (including the exact initial world, v4 snapshot, OPEN Turn 1 and empty/unready player/history rows), and adds six PostgreSQL cases covering UPDATE/DELETE refusal for MatchWorld, GameSnapshotRecord and Turn after legitimate initialization. Tests require the intended immutable-guard message and an unchanged aggregate, so an unrelated missing-column error cannot count as protection. These gated database tests must not execute in this task.

Shared-trigger static review includes the historical initial-world/initial-turn/initial-armies guards and new initialization/deferred draft guards. The four affected predicates above were the only combined table-name conditions referencing table-specific NEW fields. Other combined conditions use trigger metadata or explicitly typed configuration rows; other NEW/OLD accesses are in separate table/operation branches or use columns common to all reachable attached tables. No additional same-class defect was identified. Static review is not PostgreSQL execution evidence; fresh disposable integration verification still requires separate authorization. Editing this unmerged migration changes its checksum; do not apply it to any database where the prior version was recorded, repair migration history or use it to upgrade existing matches.

Corrective pass 1 completed with the following database-free verification. Every task check used `AUTH_ENABLED=false` and `RUN_DATABASE_TESTS=0`; database URL variables were unset for the build/test command runner. The shell initially resolved environment fallback pnpm 11.25.0; a temporary Corepack cache and native-binary shim outside Git restored pinned pnpm 12.18.0 for checks and nested scripts. The initial toolchain assertion stopped before running checks, with no source correction or test failure.

| Command/check | Actual result |
|---|---|
| `pnpm --version` | Pinned 12.18.0 verified before checks |
| `corepack pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store` | Exit 0, pnpm 12.18.0; dependency/lock files unchanged |
| `pnpm db:generate` | Exit 0; Prisma Client 7.10.1 generated without a database connection |
| `pnpm build` | Exit 0; full application build |
| `pnpm typecheck` | Exit 0; includes compilation of authored integration regression tests |
| `pnpm lint` | Exit 0 |
| `pnpm test` | Exit 0; **1205 passed / 0 failed / 191 deliberately skipped database cases**, **44 passed / 0 failed / 11 skipped files** |
| Static SQL/scope review | Passed; nine functions / twenty triggers retained; zero combined table-name/NEW-or-OLD-field conditions in migration function bodies. Reversing the four branch restructures recovers the baseline migration byte-for-byte apart from the explanatory comment |
| `git diff --check` | Exit 0 |

The six new regression cases are authored and compiled, **not executed**. The movement database suite now contains 30 cases; its unchanged live HTTP suite contains 2, for 32 Issue #51 PostgreSQL cases. All 191 workspace database cases remain deliberately skipped in this local pass. Migration application, live trigger/rejection behavior, deadline/concurrency/rollback/isolation and cascade verification on the corrective head remain unverified pending separately authorized fresh disposable hosted CI. No claim that the previous hosted failure is resolved by execution evidence is made.

Delivery is one corrective commit on the existing local branch, with only `database/prisma/migrations/202611130002_movement_drafts/migration.sql`, `database/tests/movement-drafts.integration.test.ts` and this status record changed. Its parent is the approved baseline `914be9ec0d45968e2cd640ae51c70a8a91befdcb`. PR #52 remains draft and unchanged at that baseline; its previous CI failure is still the current published result. **No database was accessed, no migration executed, no PostgreSQL/Docker or database-backed server started, no corrective commit pushed, no PR updated/created, no hosted CI run/retry initiated, no workflow/settings changed, and no merge or deployment performed in this corrective pass.** Stop after reporting the local corrective SHA and await explicit owner publication/Gate D authorization.

## Issue #53 — Automation 011 implementation

Baseline: latest origin/main `f2b8fc2f72438c8594c174bb51390c7b352f65d8`, including owner-merged PR #52. Branch: `issue/53-cloud-handoff`; **in progress / unmerged**. The previous issue's local-only/draft/failed-run records above are historical checkpoints, superseded by its authorized publication, successful CI run #76 and confirmed owner merge. Those permissions do not carry forward to this task.

Authorization: the [Issue #53 owner approval](https://github.com/MightyMulligan-ops/strategy-game/issues/53) and active owner-started request explicitly grant scoped documentation/templates/static policy tests, up to five bounded implementation correction passes, unchanged hosted fresh disposable PostgreSQL CI (including test migrations only there), and one issue branch/draft PR to main. Current owner permission was independently verified as admin. Initial issue had no assignee/comments or competing branch/PR; the owner-started [claim](https://github.com/MightyMulligan-ops/strategy-game/issues/53#issuecomment-6844555366) records this single task. Frozen approved issue body digest: `sha256:56cb93f35f99dc6d51e735b988cc53e83354ab2d9753af4fad54e080444f7113`. The digest detects later edits, not authority. No extra D/P confirmation is needed inside this valid bundle; E/F remain NOT_GRANTED.

Implementation: short issue-input launch; human and JSON advisory approval matrix with default-deny A/BC/D/P/E/F gates, frozen scope, revocation/expiry and optional exact-SHA publication; standard Markdown completion handoff; workflow/agent/guide documentation; test-only matrix examples and static safeguards. The worked PR #52 sample uses the existing read-only collector unchanged, records actual merged state, 43 files, source head/base, CI #76 attempt 1 and runner-reported counts (1205 application; 191 PostgreSQL). Missing historical frozen-spec digest/source reauthentication remains UNKNOWN rather than invented. No authority carries from that sample. No new reporter, runtime authorization consumer or privileged workflow is introduced.

Protected authoring is limited to these owner-approved instruction/documentation/template/test paths. No application/gameplay code, schema, SQL migration, dependency/lockfile, CI/workflow/settings/permission or existing reviewer/repair-prompt changes. Local VS Code fallback and separate five-pass/two-human-attempt histories stay intact. Every task check uses AUTH_ENABLED=false and RUN_DATABASE_TESTS=0; no task-side database/migration/PostgreSQL/Docker is authorized. Verification is pending. Correction passes: **0/5, not exercised** before initial checks. Actual results and one draft PR/CI evidence follow.

### Issue #53 correction pass 1 (started)

Initial pinned pnpm 12.18.0 frozen install exited 0 without dependency/lockfile changes. Initial focused checks: **88 passed / 1 failed / 0 skipped**, two passed / one failed files. The new handoff-field guard required an explicit `zero DB skips` record; the template named the no-skips execution guard without that explicit result field. Add the missing requirement to `.github/CODEX_CLOUD_HANDOFF.template.md`; keep the assertion unchanged. This is one bounded template correction, with no scope expansion or protected operation. Verification follows; original failure remains recorded.

Pass 1 outcome: focused **89 passed / 0 failed / 0 skipped**, three passed files, including **50 new Automation 011 tests**. Full database-free suite: **1255 passed / 0 failed / 191 deliberately skipped database cases**, **45 passed / 0 failed / 11 skipped files**. Pinned pnpm 12.18.0 frozen installation, Prisma Client 7.10.1 generation, full build, source/test TypeScript and lint all exited 0. Diff check and full 15-file scope/credential-pattern review passed (zero credential-pattern hits). The two existing link allowlists gained only the new known documentation targets; no assertion was removed or weakened. **1/5 bounded implementation correction passes used; no unresolved local failure.** No post-review repair was started.

### Issue #53 verification and delivery checkpoint

| Check | Actual task-side result |
|---|---|
| `pnpm --version` / `pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store` | Pinned 12.18.0; exit 0; dependency/lockfiles unchanged |
| `pnpm db:generate` | Exit 0; Prisma Client 7.10.1, no database connection |
| `pnpm build` / `pnpm typecheck` / `pnpm lint` | Each exit 0 |
| `pnpm exec vitest run scripts/tests/cloud-pipeline.test.ts scripts/tests/cloud-prompt.test.ts scripts/tests/review-prompts.test.ts` | Initial 88 passed / 1 failed, then 89 passed / 0 failed / 0 skipped after the recorded template correction |
| `pnpm test` | Exit 0; 1255 passed / 0 failed / 191 skipped; 45 passed / 11 skipped files |
| `git diff --check` / protected scope and credential-pattern review | Passed; 15 approved files only |
| Existing read-only PR collector | Real historical PR #52 sample collected successfully with exact head/base, complete 43-file inventory and CI #76/attempt 1/job counts; no new collector/privilege/workflow |
| Issue #53 hosted CI / SQL application / PostgreSQL tests | UNKNOWN at this prepublication checkpoint; only authorized fresh hosted CI may execute them |

Changed files: `.github/CODEX_CLOUD_LAUNCH.template.md`, `.github/CODEX_CLOUD_APPROVAL.template.md`, `.github/CODEX_CLOUD_APPROVAL.template.json`, `.github/CODEX_CLOUD_HANDOFF.template.md`, `.github/CODEX_CLOUD_PROMPT.md`, `AGENTS.md`, `README.md`, `docs/CODEX_PIPELINE.md`, `docs/CODEX_WORKFLOW.md`, `docs/DEVELOPMENT_ROADMAP.md`, `docs/DEVELOPMENT_STATUS.md`, `docs/examples/CODEX_CLOUD_HANDOFF_PR52.md`, `scripts/tests/cloud-pipeline.test.ts`, `scripts/tests/cloud-prompt.test.ts`, `scripts/tests/review-prompts.test.ts`.

Limitations: documentation/static test examples cannot authenticate an owner or guarantee agent compliance; the advisory JSON has no operational consumer. The sample preserves missing historical approval/digest evidence as UNKNOWN and grants nothing. The live read-only reporter, independent-review packet and local/review/repair prompts are unchanged; no UI/browser or existing-database test is needed/authorized for this documentation-only task. No dependencies, schemas, migrations or application/gameplay behavior change. No existing database access, task-side migration/PostgreSQL/Docker, deployment or merge occurred. Draft PR publication uses only Issue #53's independently verified owner B/C+D+P grant; ready/merge and existing-environment migration/deployment remain separate owner decisions. Actual PR link/in-review state and current-head CI evidence will be recorded at delivery.

### Issue #53 publication checkpoint

[Draft PR #54](https://github.com/MightyMulligan-ops/strategy-game/pull/54) targets main from `issue/53-cloud-handoff`, **in review / unmerged**, with exactly one standalone issue-closing directive for Issue #53. Initial implementation head was `790f49e0c80fbf1498c6fcde53fbe519f71eb6a2`. This required status-link follow-up changes only this document, after the successful local checks above; it is publication bookkeeping, not another implementation correction or a CI retry. The owner bundle, frozen issue body and sole claim were rechecked before publication. The unchanged CI will verify the final status-record head; any obsolete earlier run is not evidence for that head. Final source SHA, base, run/attempt/job counts, migrations and disposable cleanup are recorded in the PR/completion handoff after collection. No current-head result is inferred while pending. Correction history remains **1/5 used**, no post-review repair, no existing database/task-side migration/PostgreSQL/Docker, no ready/merge/deployment.

## Issue #55 — Automation 012 implementation

Baseline: latest origin/main `4c299af1f92fb4068d81dee432b1a5e5cfaa7272`, verified merged PR #54. Branch `issue/55-acceptance-evidence`, **in progress / unmerged**. Owner admin permission and the [Issue #55 B/C+D+P approval](https://github.com/MightyMulligan-ops/strategy-game/issues/55) were independently verified against the active owner-started request. No assignee/comment/competing issue branch or open PR existed before the single [claim](https://github.com/MightyMulligan-ops/strategy-game/issues/55#issuecomment-6844986822). Frozen issue body: `sha256:5f8056a65debf5e16d1307d3bf1444bbd0589b062edb182fb4c2c4f03247f773`. This detects edits, not authority. The named-task grant covers existing read-only reporter/formatter, handoff documentation and fixture/static tests, up to five bounded implementation corrections, unchanged hosted fresh disposable PostgreSQL CI and one issue branch/draft PR. E/F remain NOT_GRANTED; no additional D/P confirmation is needed inside this scope.

Implementation plan: derive a conservative `sovereign-pr-acceptance-v1` packet from the existing collector's metadata/two bounded log reads. Add current-main and API-corroborated synthetic-checkout parent evidence, final newest-run/base/issue rechecks, separate count/skip/migration/cleanup checks, protected-path review and unverified canonical approval-source links. Render evidence states in the existing Actions summary/report.md and bounded JSON in handoff.md. The existing workflow uploads only those paths, so this avoids YAML/artifact/privilege changes or a second reporter. Source HEAD and synthetic merge commit are distinct. No report grants acceptance, owner authentication, repairs, ready/merge or deployment.

Protected authoring is confined to diagnostic policy/formatters, fixture/static tests and related handoff/documentation. No workflow YAML, settings/permissions/triggers, dependencies/lockfile, application/gameplay/runtime/schema/migration changes or database access. Task checks use AUTH_ENABLED=false and RUN_DATABASE_TESTS=0; no PostgreSQL/Docker or task migration. Correction budget: **0/5, not exercised** before initial checks. Tests/results, complete changed-file inventory and actual draft PR/current-head CI evidence follow. New reporter behavior is not active in the trusted-main hosted reporter until owner merge; deterministic fixtures and an authorized read-only preview verify this unmerged change.

### Issue #55 initial verification checkpoint

All initial checks passed, with **0/5 correction passes, not exercised** and no post-review repair. Pinned pnpm 12.18.0 frozen install, Prisma Client 7.10.1 generation, full application build, source/test TypeScript, lint and diff/scope checks exited 0. Focused six-file policy/reporter suite: **242 passed / 0 failed / 0 skipped**, including **39 new acceptance tests**. Full database-free suite: **1294 passed / 0 failed / 191 deliberately skipped database cases**, **46 passed / 0 failed / 11 skipped files**. Every task-side check used AUTH_ENABLED=false and RUN_DATABASE_TESTS=0; database URL variables were unset. No assertion disabled, weakened or retried after failure; no failure occurred. The published environment's pinned native pnpm was used rather than the fallback version.

The new collector also produced a complete bounded read-only preview from real merged PR #54 / CI #79 attempt 1: exact source `d663898aa5da1e9c25aed289bb6bc53a8e841707`, PR base `f2b8fc2f72438c8594c174bb51390c7b352f65d8`, current main `4c299af1f92fb4068d81dee432b1a5e5cfaa7272`, all 15 historical paths, 1255 application cases and 191 PostgreSQL cases. Source/CI/counts/initialization/migration/cleanup evidence passed; **current-base checkout correctly remained UNKNOWN** because main advanced after that CI. Protected scope and owner authorization correctly remained NEEDS_OWNER_REVIEW/UNVERIFIED. This historical sample grants no authority and is not Issue #55 CI. Report/handoff/JSON previews are outside Git under /tmp; the current issue's final preview follows after its own CI. No workflow dispatch or database operation was performed.

Changed-file inventory (10): `.github/CODEX_CLOUD_LAUNCH.template.md`, `.github/CODEX_CLOUD_HANDOFF.template.md`, `README.md`, `docs/CODEX_PIPELINE.md`, `docs/DEVELOPMENT_ROADMAP.md`, `docs/DEVELOPMENT_STATUS.md`, `docs/PR_REVIEW.md`, `scripts/pr-review.ts`, `scripts/pr-review-github.ts`, `scripts/tests/pr-acceptance.test.ts`. Complete diff and credential-pattern review passed. Protected diagnostic-policy/formatter and instruction-template changes are expressly covered by the frozen Issue #55 scope and owner source above. No dependencies, SQL/schema/migration, application/gameplay/runtime, workflow YAML, settings, permissions or secrets changed. Existing transport, association, static instruction and scope tests passed unchanged.

Limitations: execution/count/checkout log markers remain untrusted runner reports; commit-parent API data corroborates metadata, not execution semantics. Owner authorization and semantic diff review always remain human decisions. Optional missing data, incomplete/truncated inventories, unavailable logs/parents, or advanced main never become PASS. JSON is bounded to 1 MiB and placed in the existing handoff.md artifact, not a new workflow output. New trusted-main hosted formatting takes effect only after an owner merge; fixture and live read-only previews validate the unmerged implementation without privileged PR execution. Current Issue #55 CI is UNKNOWN at this prepublication checkpoint. Owner-approved D covers only unchanged hosted CI's fresh disposable service and its existing test migrations. No existing database access, task-side migrations/PostgreSQL/Docker, dependencies, ready/merge/deployment or additional task occurred. Draft PR/current head/run/attempt/job/migration/cleanup evidence will be recorded in the completion handoff; E/F remain NOT_GRANTED.

### Issue #55 publication checkpoint

[Draft PR #56](https://github.com/MightyMulligan-ops/strategy-game/pull/56) targets main from `issue/55-acceptance-evidence`, **in review / unmerged**, with exactly one standalone issue-closing directive for Issue #55. Initial implementation head `1c06d522e09700967482b383fac9b348dbccc213` passed all local checks above. This required status-link follow-up changes only this document; it is delivery bookkeeping, not a correction or failed-CI retry. Owner authority/frozen scope and the sole claim were reverified before publication. The unchanged CI will verify the final head; older-head results never establish a final-head pass. Final source/base/run/attempt/jobs, counts/migrations/disposable cleanup and the current-head read-only packet preview will be recorded in the PR/completion handoff. Correction history remains **0/5, not exercised**; no post-review repair, task-side DB/migration/PostgreSQL/Docker, ready/merge/deployment or new task. New hosted reporter formatting still awaits the owner's merge into trusted main.

## Issue #57 — Automation 013 implementation

Baseline: latest origin/main `03a122a6556f68c8e1406737602bdb89a9c50853`, including independently verified merged PR #56. Branch `issue/57-review-triage`; **in progress / unmerged**. The [Issue #57 owner approval](https://github.com/MightyMulligan-ops/strategy-game/issues/57) and active owner-started request explicitly grant this frozen B/C+D+P task only. Owner current admin permission was independently verified; initial issue had no assignee/comment/competing issue branch or open PR. Sole [claim](https://github.com/MightyMulligan-ops/strategy-game/issues/57#issuecomment-6845469447); no manual label writes. Frozen body: `sha256:65348920ee493d256f4c446c8ac537f2fa1377ac25152410200d71709bd12da3`. Expiry/revocation/exclusions apply; the digest is not authority. Up to five bounded in-task corrections, one feature branch/draft PR, unchanged hosted CI with fresh disposable PostgreSQL only. E/F, post-review repair, manual workflow dispatch and other agents are not granted.

### Required first observation — Automation 012 live validation

At task start, existing reporter [run #36](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43375225884), attempt 1, was at required trusted-main SHA `03a122a6556f68c8e1406737602bdb89a9c50853` but **skipped**. Diagnostic job 131720030059 had no executed steps; the run had zero artifacts. Earlier successful reports ran before the 012 merge and cannot validate the new format. Live validation is therefore **PENDING/UNKNOWN** at this checkpoint, not passed by fixtures or local previews. No workflow was manually dispatched; the issue explicitly permits independent implementation and unchanged approved CI while this observation is pending. Recheck already-existing automatic reports later if available, retaining this history.

Implementation: derive bounded deterministic REVIEW_READY_EVIDENCE / INVESTIGATE / BLOCKED_UNKNOWN hints and reason/evidence links from the same acceptance packet, with contradictions/missing identities/evidence taking priority. An approval-shaped source is availability only, never verified authority; absent/unavailable candidates block review readiness. Protected scope and UNVERIFIED authority remain manual review even with technical readiness. One owner-copyable prompt pins PR/issue/source/base/current-main/run/attempt, states, sanitized protected paths and fixed review questions, with explicit stale-input STOP and no execution/repair/agent/merge authority. Existing workflow/artifacts/API permissions and reviewer/repair prompts remain unchanged.

Automation 009/010/011/012 merge states were independently read from GitHub PRs #37/#46/#54/#56 and verified as ancestors of this baseline. Only automation roadmap checkboxes/status were refreshed; no gameplay scope. Local checks use AUTH_ENABLED=false RUN_DATABASE_TESTS=0, no existing database/task migration/PostgreSQL/Docker/dependency changes. Initial correction history: **0/5, not exercised** before checks; no post-review repair or other task. Actual checks, file inventory, draft PR, current-head CI and final live-validation status follow.

### Issue #57 correction pass 1 (started)

Initial frozen pnpm 12.18.0 install exited 0; focused suite passed **278 / 0 failed / 0 skipped** across seven files. A subsequent synthetic adversarial reproduction used only `This issue is not owner-approved. Planning only; no approval record.` with no comments. The broad candidate phrase matcher returned candidateObserved=true / REVIEW_READY_EVIDENCE despite the denial; all authority fields remained NOT_GRANTED. Tighten candidate observation to recognizable record lines, reject explicit denial/revocation on those lines, and add four denial-source regressions. This is bounded read-only triage correction, not owner authentication or a grant parser; genuine observed sources remain UNVERIFIED. Only the collector helper, focused test file and this append-only history change in this pass. Verification follows; initial results/reproduction remain recorded.

Pass 1 outcome: focused **282 passed / 0 failed / 0 skipped**, seven files including **40 new triage tests**. The four added denial/revocation regressions now classify BLOCKED_UNKNOWN while genuine candidate records remain UNVERIFIED. Full database-free suite: **1334 passed / 0 failed / 191 deliberately skipped database cases**, **47 passed / 0 failed / 11 skipped files**. Prisma Client 7.10.1 generation, full build, source/test TypeScript, lint and diff/scope checks exited 0. **1/5 in-task correction passes used**, no unresolved local failure or post-review repair. No existing test assertion was removed or weakened; the original acceptance fixture was extracted verbatim for shared deterministic reuse.

### Issue #57 verification / publication checkpoint

Task checks used AUTH_ENABLED=false RUN_DATABASE_TESTS=0 and unset database URL variables. Pinned pnpm 12.18.0 frozen installation passed without dependency/lock changes. Focused command was `pnpm exec vitest run` for pr-triage, pr-acceptance, pr-review, pr-review-association, review-prompts, cloud-prompt and cloud-pipeline test files; initial 278 passed, then 282 passed after the recorded adversarial correction. `pnpm db:generate`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `git diff --check` all exited 0. Current Issue #57 hosted CI and final live 012 validation are UNKNOWN/PENDING before publication, not inferred from local test skips. No browser/application/database execution was needed for this CLI/reporting change.

Complete inventory (12): `.github/CODEX_CLOUD_LAUNCH.template.md`, `.github/CODEX_CLOUD_HANDOFF.template.md`, `README.md`, `docs/CODEX_PIPELINE.md`, `docs/PR_REVIEW.md`, `docs/DEVELOPMENT_ROADMAP.md`, `docs/DEVELOPMENT_STATUS.md`, `scripts/pr-review.ts`, `scripts/pr-review-github.ts`, `scripts/tests/pr-acceptance.test.ts`, `scripts/tests/pr-acceptance-fixture.ts`, `scripts/tests/pr-triage.test.ts`. Protected diagnostic/instruction-template changes are explicitly covered by the frozen approval above. Complete diff/scope/credential-pattern review passed. No workflow YAML/trigger/permission/settings, dependency/lockfile, gameplay/runtime/application/schema/migration, existing review/repair prompt or API write automation changes.

Limitations: triage is deterministic evidence guidance, not semantic code findings, owner authentication or acceptance. Candidate record observation rejects recognizable explicit denial/revocation but is not a grant interpreter; other missing/unrecognized approval sources remain blocked until manually verified. Exact-head prompt text launches nothing; source/base/main/scope/run/attempt changes invalidate reuse. Read-only previews/fixtures are not hosted live validation. Live Automation 012 must be independently observed from eligible existing trusted-main steps/artifacts, or remain pending without manual dispatch. New 013 formatting takes effect in that hosted reporter only after owner merge. Actual draft PR/current source/base/run/attempt/jobs, tests/migrations/disposable cleanup, packet triage and live-validation observation will be recorded in the completion handoff. No existing database access, task-side migrations/PostgreSQL/Docker, other agents, manual workflow dispatch, manual labels, ready/merge/deployment or additional task occurred. E/F and post-review repair remain NOT_GRANTED.

### Issue #57 publication checkpoint

[Draft PR #58](https://github.com/MightyMulligan-ops/strategy-game/pull/58) targets main from `issue/57-review-triage`, **in review / unmerged**, with exactly one standalone issue-closing directive for Issue #57. Initial implementation head `f428de7cf5880d248a542b198aaceeb0759664cf` passed local checks above. This required status-link follow-up changes only this document, not another correction or failed-CI retry. Frozen scope, owner authority and sole claim were verified before publication; no manual label writes. Final-head CI, exact source/base/run/attempt/job evidence, counts/migration/cleanup, triage preview and live 012 observation are recorded in the completion handoff. Older-head/pending/skipped reports are never final-head or live-validation proof. No manual workflow dispatch; inspect only already-existing automatic reports if available. Correction history stays **1/5**; no post-review repair, agent, database/task migration/PostgreSQL/Docker, ready/merge/deployment. Hosted 013 awaits owner merge; E/F remain NOT_GRANTED.

## Issue #59 — 006D.3 cloud task

Merged as `197345a24154df11bde14434677f48104846943c`: [PR #60](https://github.com/MightyMulligan-ops/strategy-game/pull/60), independently verified before Issue #61. Historical task branch `issue/59-turn-closure`, based on main `1c4c1348a786c50843181ca16c61e97a56d1bcdc`. The explicit owner message starting this task grants B/C + D + P in TASK_SCOPE mode for Issue #59 only: frozen implementation, additive SQL authoring, up to five bounded corrections, unchanged hosted CI/fresh disposable PostgreSQL, one branch and one draft PR. Verified owner repository permission: admin. Claim: https://github.com/MightyMulligan-ops/strategy-game/issues/59#issuecomment-6856197334. Frozen issue body SHA-256 `0ff157c45bdda09852f42d63ff9298ed9b54c85353b776bf3ad2ba07fc4c0320`. The issue's earlier Gate A-only status is superseded only by this explicit issue-specific chat grant. No expiry/revocation or competing claim was found. E/F remain NOT_GRANTED.

Initial read-only inspection confirmed merged 006D.1/006D.2 and Automation 011–013, clean checkout and no duplicate issue branch/PR/claim. New strict `turn-closure-v1` / snapshot v5 and frozen-v2 contracts preserve all old cohorts, world/armies and stateVersion=0. The new additive migration leaves historical functions/triggers intact except exact-profile start admission. See TURN_CLOSURE.md for API, persistence, worker, privacy, security and rollout details. No schema model, dependency or workflow/permission change.

Verification is in progress, with AUTH_ENABLED=false RUN_DATABASE_TESTS=0 and database URLs removed from the check subprocess environment. Frozen pnpm 12.18.0 install and Prisma 7.10.1 generation passed. PostgreSQL cases are authored but not executed in the task. Hosted CI remains pending publication; pending is UNKNOWN.

Append-only correction history:
- Pass 1/5: initial build/typecheck failed because the new engine imported Zod without a direct dependency, and subsequent compiler diagnostics identified an accidental duplicate snapshot import and an overly narrow inferred projection state. Moved command schema into existing shared-types, corrected imports and explicitly typed the projection's TurnState parameter; no dependency introduced. Re-verification: full TypeScript check passed; final build/lint/test evidence pending below. Pre-deadline rejected commands were also checked to preserve state rather than storing a clock-only write.
- Post-review repairs: none. No independent review has run, no CI retry, no new task or delegation.

No task-side database access, migration, PostgreSQL/Docker startup, existing-environment operation, merge or deployment is authorized or performed. Manual UI/capacity review, independent code review, E (ready/merge), F (migration/deployment) and future frozen-input consumption remain owner decisions.

- Pass 2/5: first full verification passed build/TypeScript/lint, with 1409 tests passed, 1 failed and 231 database cases skipped. Existing OPEN-panel assertion rejected unconditional CLOSED wording. Made closure explanation conditional, retained its original assertion, synchronized status refresh after closure observations, and strengthened frozen roster validation. Static review also found persistence could cross the deadline; added scoped SQLSTATE P0059 checks and a separate bounded deadline observation after candidate rollback (never a command retry), plus regression coverage. Re-verification pending.

Pass 2 verification: full build, TypeScript and lint passed; workspace suite passed 1410 / failed 0 / skipped 235 (44 new CI-only closure assertions plus 191 historical DB cases). Added a subsequent Fastify hook-order test with mock storage (no listener/database), which passed in a focused 32-case HTTP/worker run. A final complete check run includes that additional case; current-head hosted counts will be reported from actual CI logs, never inferred. Frozen install's Pixi skill-approval notice was left unchanged; it is not a dependency/test failure. Diff/credential-pattern inventory passed across 41 scoped files. No workflow, permissions, dependency/lockfile, Prisma model or historical migration edits. PostgreSQL tests are deliberately unrun in the task; all SQL execution and database-backed behavior remains pending fresh hosted CI.

Final task-side verification after all implementation/test edits: pnpm 12.18.0 frozen install, Prisma Client 7.10.1 generation, full build, TypeScript, lint and diff check passed (exit 0). Full suite: **1411 passed / 0 failed / 235 deliberately skipped**, 51 executed and 13 skipped integration files. New hosted-only coverage: 42 repository/SQL cases and 2 persisted-session HTTP cases; all 44 remain unexecuted locally. Correction passes **2/5**, both resolved locally; no post-review repairs. Hosted CI will apply all nine migrations only to its newly provisioned service; current-head results are UNKNOWN until observed. The new migration creates nine functions and 22 triggers and replaces only the historical start-admission function.

Publication: implementation `31d13650dcbc23dd3e1963b75f45dd2801ab0fb6` pushed unchanged; actual draft PR #60 targets main. This required status-only follow-up records the real PR URL on the same branch and triggers a fresh current-head CI run through the unchanged pull_request workflow. It is not an implementation correction or CI-job retry. Final current-head run/attempt/jobs, migrations, actual counts, cleanup and Automation 012/013 evidence belong in the PR/completion handoff after observation; pending evidence remains UNKNOWN.

- Pass 3/5: final static review after green CI #88 identified a remaining deadline crossing during deferred commit work. No failing CI was retried. Added a second narrow additive migration, `202611130004_turn_closure_commit_window` (one new function/five deferred triggers), leaving the earlier migration and all historical files unchanged. It checks the SQL deadline at deferred commit, excludes overdue revision-zero initialization and valid DEADLINE closure, and reuses P0059 rollback/independent closure. Added three CI-only delayed-commit regressions and an offline migration check. No API, gameplay or frontend scope change. Previous CI #88 attempt 1 on `c371687b05ca404596ac49c93feba42701ec365d` passed 1411 application and 235 PostgreSQL cases across 13 files; all nine then-committed migrations applied and container/network cleanup succeeded. Earlier CI #87 was superseded/cancelled by the required status-only publication; its fresh container/network cleanup also succeeded. Current-head verification pending; prior green evidence is historical after this correction.

Pass 3 database-free verification passed: TypeScript and full unit/mocked HTTP/frontend suite **1412 passed / 0 failed / 238 deliberately skipped**, 51 executed and 13 skipped DB files. The new SQL-only checkpoint leaves all compiled production sources unchanged from the prior successful build/lint. New CI-only coverage is now 47 assertions (45 repository/SQL and 2 HTTP); no database case executed locally. Migration chain now has ten files; 0004 adds only one function/five deferred triggers, ordered after completeness checks. This scoped commit updates the same draft PR #60 and will trigger a new run for its new SHA; no completed job is rerun. Implementation corrections **3/5**; post-review repairs none. No task-side database/migration operation, existing-database access, ready transition, merge or deployment.

## Issue #61 — 006D.4 owner-started cloud implementation

In review / unmerged: [draft PR #62](https://github.com/MightyMulligan-ops/strategy-game/pull/62), sole branch `issue/61-movement-resolution`; baseline latest main `197345a24154df11bde14434677f48104846943c`, owner-merged PR #60 verified. Owner Issue #61 launch grants B/C+D+P (TASK_SCOPE), additive SQL authoring, database-free checks, unchanged hosted fresh disposable PostgreSQL and one draft PR; E/F remain ungranted. Owner repository permission admin independently verified. Sole claim https://github.com/MightyMulligan-ops/strategy-game/issues/61#issuecomment-6862401003. Frozen issue digest `7954810c106817ca4fcc551f102122514d0ccbb54c44a087a3af6a296d1b115f`, plus explicit task-chat clarification: approaches stop strictly before contact on the coordinate lattice; initial contact/overlap remains in place. No new gameplay authority inferred from prose or CI.

The implementation pins new initial-v6 / frozen-v3 / result-v2 / resolved-v7 contracts and new movement-resolution-v1; all old cohorts remain unchanged. Seed source world-seed-v1 reuses the already durable server-owned uint32 archive seed, fixed in immutable frozen input. Swept-circle-lattice-v1 uses exact BigInt contact predicates, pinned seeded shuffle, path-aligned milliworld lattice stopping, and final hostile-edge components. Results and summaries stay server-authoritative; no combat, Turn 2, merge/split, new dependencies or workflow edits.

Append-only correction history (five maximum):
- Pass 1/5: initial compiler check rejected InputJsonValue assigned to restored JsonValue in the in-memory compatibility projection. Serialize the validated JSON payload explicitly; continue full runtime/UI integration and verify build/typecheck. No database accessed or SQL executed. Outcome pending.
Post-review repairs: none; no independent review, extra task or delegation.

Pass 1 outcome: TypeScript passed after the JSON projection fix and exact-optional-prop call correction.
- Pass 2/5: focused pure execution reported 24 passed / 3 failed. Equal roots produced -0, resolution identity depended on formation enumeration, and a simultaneous-contact fixture also had an initially touching defender pair. Normalize comparator zero and canonicalize formations/units/players before hashing/execution; explicitly assert both swept contacts plus the legitimate initial edge, retaining all participants. Strengthen diagonal assertions to require actual contact. Verification pending.

Pass 2 continued: re-verification passed 26/27; the strengthened third diagonal fixture was 27.85 units from the segment and correctly had no contact. Move that fixture target within the 20-unit boundary and retain the mandatory contact/on-path/outside assertions. This is the same bounded geometry correction set.

Pass 2 outcome: all 68 focused pure/storage/HTTP/frontend/migration cases passed. Frozen install, Prisma generation, build and lint passed. The earlier full run passed 1463 tests with 260 DB cases skipped (before storage tests were added).
- Pass 3/5: full TypeScript check identified an unused historical runtime import in the new integration fixture. Remove it and an unused fixture import introduced with storage tests; strengthen new SQL result identity/provenance/duplicate-formation checks during final static review. Re-run complete verification including the new tests. No historical migrations changed or SQL executed. Outcome pending.

Pass 3 final verification: pnpm 12.18.0 frozen install, Prisma 7.10.1 generation, full build, TypeScript, lint and diff check passed. Final workspace **1485 passed / 0 failed / 262 deliberately skipped** across 56 executed and 15 skipped integration files. New hosted-only assertions: 22 repository/SQL and 2 persisted-session HTTP; all 24 remain unexecuted locally. The complete new focused pure/storage/HTTP/frontend/migration subset passed earlier (68 cases), and the strengthened 28-case seed/geometry run passed. Corrections **3/5**, locally resolved; post-review repairs none. Current-head hosted CI is pending publication, never inferred from task skips or a predecessor run.

Protected scope: new movement-resolution-v1 initial v6/frozen v3/result v2/resolved v7, one additive `202611130005_movement_resolution` migration (11 new functions, one narrowly extended historical admission function, 30 triggers), server authorization boundary reuse, own-only read DTOs and UI. No dependency/lockfile, CI/workflow/permission, Prisma model or historical migration changes. Existing databases, task-side SQL/DB startup and deployment remain untouched. Actual PR URL and current-head run/attempt/job/count/migration/cleanup evidence will be retained in the final PR handoff; E/F and independent review stay owner-controlled.

Publication: implementation source `32cdb7e835d3b60e563620660f36c92010d4c128` pushed unchanged to the sole issue branch; draft PR #62 targets main. This required status-only follow-up records the real URL. Current-head hosted CI/run/attempt/job evidence will be reported in the PR/completion handoff after observation; a superseded metadata-head run is not a failed-job retry. No code-review/repair task, E/F authority or deployment is implied.

- Pass 4/5: current-head CI #92 attempt 1 (`43495470888`, head `5ac50722e959263bad6b8124d2e15f4503fff66c`) passed application checks and all eleven migrations; PostgreSQL reported 261 passed / 1 failed / 0 skipped. The sole failure was a 404 formation GET in the new HTTP fixture, which omitted FormationReadRepository registration even though production wiring includes it. Register the real fixture adapter; retain the success/privacy assertions. Read-path review also found the first hostile contact was absent from a stationary defender's own event timeline. Derive one privacy-redacted contact event from the immutable result, ordered relative to own audits; no enemy trigger order, global sequence or later-arrival count is exposed. No physics, runtime, seed, SQL or workflow change. Add projection/UI coverage and verify database-free checks before publishing one scoped new commit. No completed CI job is rerun.

Pass 4 verification: full build (including Prisma generation), TypeScript, lint and diff check passed; database-free suite 1487 passed / 0 failed / 262 intentionally skipped across 56 executed and 15 skipped integration files. The HTTP fixture and immutable-result projection regression assertions remain for unchanged fresh-disposable hosted CI. No task-side database or migration was used.

## Issue #61 — ISSUE61-REPLAY-PERFORMANCE-001, post-review repair attempt 1/2

Owner explicitly started one bounded local performance repair, attempt 1 of 2 (no previous repairs), from source `ca26322f862d3be3cd554c7f965a7c87a3063aa6`, base `197345a24154df11bde14434677f48104846943c`, existing branch/draft PR #62. Exact API/local/remote identities, clean tree, issue digest, sole claim and historical CI #93 attempt 1 were verified before edits. The original implementation history remains 4/5; it grants no post-review retry. Scope: remove redundant reconstruction and safely reuse validated immutable data while retaining full tamper detection, deterministic identities, collisions, participant privacy and lifecycle isolation. Supporting closure-storage parameter typing, targeted regression tests and performance documentation are necessary to verify the same contract. No SQL, public persistence/runtime/API contracts, gameplay, dependencies, workflows or transaction semantics may change.

Authorized delivery is LOCAL CHANGES ONLY: no commit, push, PR metadata update or hosted CI authorization is inferred from the completed implementation task. Publication/D and fresh independent review remain required. Attempt begins with the edits below; outcomes pending.

Attempt 1 verification history: first focused run passed 94 / failed 1. The warmed-cache clone-identity assertion exposed value-equal rows producing different native V8 serialization bytes (safe misses, not a tamper bypass). Replace the fingerprint with complete JSON content plus explicit native-type traversal markers; reject omitted/non-JSON values, preserve bigint/string and Date/string distinctions, and retain the clone/reuse assertion. No repair counter reset or new invocation; verification pending.

Attempt 1 outcome (LOCAL / UNCOMMITTED): pinned pnpm 12.18.0 frozen installation, Prisma generation, full build, source/test TypeScript, lint and diff check passed. Full database-free suite: **1519 passed / 0 failed / 262 deliberately skipped**, 56 executed/15 skipped files. The 32 additional regression cases cover complete-content reuse, caller immutability, 27 post-hit corruption variants, OPEN isolation/enumeration, LRU eviction, actor filtering and mandatory next-snapshot verification. An intermediate focused run passed 95/95 after the safe-miss fingerprint correction; the two later cases are included in the full 1519 result. Native-type markers/custom-serialization rejection preserve fail-closed behavior.

Fresh paired 40-player/240-unit/regionSide-5/seed-123 fixtures, same 250 and 1000 orders/player, three warmups/ten measured baseline and warm-repair calls; cold repair clears reuse each call (one warmup/five samples). Median baseline **2728.8 / 8010.8 ms**; warm repair **130.3 / 588.6 ms**; cold repair **1681.8 / 6766.2 ms**. Baseline/repair authoritative JSON result SHA-256s match exactly for both workloads. Warm targets are met; cold targets are not met, and a 20994.9 ms cold outlier is retained. No production HTTP/PostgreSQL latency or capacity claim follows from these in-memory measurements. Cold/cache-churn CPU work, memory cost, ORM/SQL/concurrency behavior and fresh independent review remain outstanding.

Failure ISSUE61-REPLAY-PERFORMANCE-001 is **partially mitigated**, not independently resolved/READY. Attempt 1/2 ends here; no attempt 2 or automatic retry is authorized. Original implementation history remains 4/5. Existing CI #93 attempt 1 is evidence for published source ca26322 only, not this uncommitted repair. No new commit/push, PR/issue metadata change, hosted CI, existing database, task-side PostgreSQL/Docker/migration, dependency/workflow change, merge or deployment occurred. Separate commit/push + unchanged fresh-disposable hosted-CI approval is required before publication; retain draft PR #62 and obtain fresh independent review of any resulting SHA.

## Issue #61 — ISSUE61-REPLAY-PERFORMANCE-001, final post-review repair attempt 2/2

Owner explicitly authorized attempt 2 of 2, local changes only, preserving Repair 1's uncommitted five-file patch and evidence (SHA-256 06a191cd45189dd617c2993b72e25e9a2dc2271131b845adc5389a226540c6d2). Expected/local/remote/PR HEAD ca26322f862d3be3cd554c7f965a7c87a3063aa6 and base 197345a24154df11bde14434677f48104846943c matched; PR #62 remains draft/open, sole claim, no unexpected changes. Original implementation history remains 4/5; Repair 1/2 was blocked before publication by warm-cache custom-toJSON/bigint masquerading. No previous publication grant carries forward.

This final attempt replaces callback-based fingerprint serialization with descriptor-checked typed traversal, rejecting unsupported hooks/proxies/prototypes before cached reuse. A narrowly necessary entry guard in turn-storage.ts selects the new runtime from data descriptors before property getters can execute; historical valid-row validators and all SQL/engine/runtime contracts stay unchanged. Focused adversarial, warm/cold, privacy, next-snapshot and paired 40-player checks follow. No commit/push/CI/migration/deployment is authorized, and no automatic third attempt is permitted. Outcome pending.

Attempt 2 inspection/verification: focused runs passed 135, then 136, then 142 cases as related coverage grew. Native-brand inspection showed prototype reassignment can disguise Map/Set/boxed/typed objects, so reject their native brands explicitly. A direct compatibility probe also showed V8 serialization admits a disguised URL that the baseline structuredClone rejects; retain the baseline structuredClone admission after the hook-free descriptor walk and discard that temporary clone. Add that exact case alongside masked native brands. This security-required admission check is deliberate even if it costs some warm-read performance; no validation is traded for a target. These are corrections inside the same final owner-started attempt, not a third invocation. Verification/benchmarks pending.

Attempt 2 full-check history: frozen install/generation/build/lint passed; initial typecheck reported two nullable-Date annotations in the synthetic shared-date regression (the fixture supplies Date, model allows null). Add non-null assertions only in that fixture test; production behavior is unchanged. Final native comparison audit also includes KeyObject/CryptoKey brand rejection alongside other serializable non-record brands. Re-run final source checks and paired repair benchmarks; no new attempt or scope expansion.

Attempt 2 final local verification: all frozen-install/generation/build/TypeScript/lint/diff checks exit 0. Full suite **1567 passed / 0 failed / 262 deliberately skipped** (56 passed/15 DB-skipped files). Repair 2 adds 48 tests beyond Repair 1, including 45 malformed-input cases each exercised cold/warm with zero input-hook calls, post-read mutation/alias boundaries and two fully valid matches sharing actor/order IDs. Standalone 15-case published-baseline/cold/warm comparison confirms the forged turn-number object is rejected invalid_storage in all three, with zero callbacks in repaired paths. Some getter/native-object cases admitted by baseline are conservatively rejected by the repaired data boundary; these are not representations produced by ordinary Prisma fetches. Initial TS2322/TS18047 fixture nullable-Date errors are corrected; no runtime behavior was changed by those annotations.

Fresh paired 40-player benchmarks, seed 123/regionSide 5/250 and 1000 orders per player: baseline medians **2549.3 / 7602.4 ms**; final warm medians **428.8 / 1736.9 ms**; cold medians **1659.9 / 9126.6 ms**. Three warmups/ten baseline and warm samples; one warmup/five cache-cleared cold samples. Final warm p95/worst **456.3 / 3882.0 ms**, cold p95/worst **1783.7 / 10424.6 ms**. Warm median targets are met; cold targets are not, and the 1000-order cold median is worse than baseline. No outlier was discarded or native admission removed to meet a target. Both authoritative JSON hashes exactly match published baseline (250: c75a4ce82d766b9889b0466cf53bd368f2a3c6bc942d10f696fca1e088a8b5cb; 1000: 653b89f6f880ba8c050b6160e1b5f000c545378804ce788c16368c01cb664301).

The known serialization bypass is locally corrected; the broader performance failure remains partially mitigated. Cold replay, input/clone cost, memory, cache churn and real concurrent HTTP/PostgreSQL behavior remain unverified/material capacity risks. Attempt **2/2 is complete**; no third repair or automatic retry is authorized. Original implementation history remains **4/5**. Current work is **UNCOMMITTED** on the existing branch; published HEAD/PR/base remain unchanged. No commit, push, PR/issue metadata update, hosted CI, database access, PostgreSQL/Docker/server, migration, dependency/workflow/permission change, merge or deployment occurred. Separate publication decision and fresh independent review are required; merge readiness stays UNKNOWN.

## Automation 014 / Issue #63 — owner-started implementation

Verified main `9a5c5f2e925c1d4d88c6a9dd9d2ed8f0f7e5c28d`; Issue #61 closed and PR #62 merged at that SHA independently confirmed. This records their disposition only; no review/repair or other operation on that predecessor is started. Owner-uploaded Automation 014 request grants Issue #63 B/C+D+P, TASK_SCOPE, up to five implementation corrections, expiry on completion/revocation/transfer. E/F remain NOT_GRANTED. Sole branch `issue/63-owner-gated-orchestration`, claim https://github.com/MightyMulligan-ops/strategy-game/issues/63#issuecomment-6868505535. Frozen issue revision `2026-11-13T22:36:06Z`, SHA-256 `636af1897d9a0e9c53641641b8c5ce34376e6999b043ee5249affa337f9ae41e`. No other claim/assignee/PR found. Scope: advisory 014A/B/C using the existing trusted-main collector and evidence contracts, and disabled future-delegation design. No workflow/permission/dependency/gameplay/runtime/schema/migration changes, automatic writes/agent launch/repair/CI retry, existing databases, task-side PostgreSQL/Docker/migrations, Ready/merge or deployment.

Initial focused checks: 94 passed / 1 failed (95). One malformed-task fixture used a syntactically valid ID, which correctly produced BLOCKED for owner/history conflict instead of the fixture's expected UNKNOWN syntax rejection. Initial scripts TypeScript reported exact-optional TS2375 for a missing candidate-observation field. **Correction pass 1/5**: make that fixture syntactically invalid (retain separate valid-but-conflicting task test), normalize absent approval observation to null, and complete the same validation boundary's per-file review/rename and CI trust/conclusion regression coverage. No policy/authority expansion; verification pending. Post-review repair history is separate and not exercised for Issue #63; prior Issue #61 failure's exhausted 2/2 history is not reset.

Correction pass 1/5 verification: **99 focused cases passed / 0 failed / 0 skipped**; scripts TypeScript exit 0. Initial exact-optional normalization and malformed fixture corrected; complete per-file rename review and CI count trust/conclusion checks are covered. Initial implementation documentation now describes the pure API's conditional trust boundary, unchanged reporter integration, synthetic end-to-end scenario and disabled version-1 delegation proposal. Full database-free verification pending.

**Correction pass 2/5** (validation inspection): retained history after an earlier transfer must not recursively demand the entire earlier snapshot chain; validate the retained snapshot's records, then compare the provided old/new arrays as exact prefixes. Add continuation-after-transfer coverage without resetting attempt counters. Reject closed/missing-triage targets before targeted prompts; keep unsupported review change requests UNKNOWN unless blocking confirmed evidence exists. Factor existing artifact rendering into a pure helper and test that 014 appends to the same artifacts without new API requests or changing the 012/013 packet. Full-check run started before this pass is retained as intermediate evidence; final checks will bind the final source.

Pass 2/5 focused verification: **104 passed / 0 failed / 0 skipped**, scripts TypeScript exit 0. The intermediate full check passed install/generate/build/typecheck/lint but reported **1665 passed / 1 failed / 262 skipped** (the pre-pass-2 99-case source): the sole failure was the existing review-documentation link allowlist rejecting the new Automation 014 guide link. **Correction pass 3/5**: add only `docs/AUTOMATION_014.md` to that guard's explicit allowed set; keep credential, `.git` and executable-path rejection unchanged. Add static coverage for disabled version-1 delegation and the new guide's conditional/manual trust boundaries. Re-run all required checks on the final source; no CI retry or post-review repair is started.

Pass 3/5 full verification: frozen pnpm 12.18.0 install, Prisma generation, full application build, TypeScript, lint and diff checks passed; **1673 passed / 0 failed / 262 deliberately skipped** (57 executed/15 DB-skipped files), including 106 new orchestration cases. Offline synthetic scenario executed and produced READY → CHANGES_REQUESTED/proposal → changed-head UNKNOWN → refreshed advisory READY, with no live review/repair/DB/CI claim. **Correction pass 4/5**: remove the repeated owner-copyable review prompt when appending 014 to the existing handoff artifact; keep one in each report/handoff and one in standalone rendering. Strengthen the existing artifact integration test to assert one prompt, without changing the 012/013 packet or collector/API requests. Final scripts TypeScript and workspace verification pending; no protected-scope expansion.

Pass 4/5 scripts TypeScript passed; full verification reported **1672 passed / 1 failed / 262 skipped**. The remaining assertion counted the serialized `triage.reviewPrompt` JSON data field as another human-copyable prompt, despite there being one text block after the rendering fix. **Correction pass 5/5 (final)**: count only fenced `text` blocks starting REVIEW_ONLY, retaining the original JSON packet and its prompt field unchanged. No production behavior changes in this pass. All five bounded implementation correction passes are now consumed; final full verification follows. No automatic sixth pass or post-review repair is authorized.

Final pass 5/5 outcome: pinned pnpm 12.18.0 frozen installation, Prisma Client generation, full application build, source/test TypeScript, lint and diff checks all pass. Workspace **1673 passed / 0 failed / 262 deliberately skipped**, 57 executed/15 DB-skipped files; the 106 new orchestration tests include exact one-copyable-text-block and unchanged 012/013 JSON packet coverage. All five correction passes are consumed. No post-review repairs were initiated; no automatic sixth pass or CI retry. Fourteen documentation/diagnostic/test files only; no application/gameplay/engine/runtime/schema/SQL/migration/dependency/workflow/permission changes. Pre-publication frozen digest, current main, sole claim and Issue #63-specific owner B/C+D+P TASK_SCOPE authority reverified. Author implementation is ready for draft publication, not independently reviewed or accepted; E/F remain NOT_GRANTED. Existing unchanged hosted CI/fresh disposable PostgreSQL is explicitly approved; task-side databases/migrations remain prohibited. Actual draft PR URL and current-head CI evidence will be recorded after creation.

Publication: [draft PR #65](https://github.com/MightyMulligan-ops/strategy-game/pull/65), branch `issue/63-owner-gated-orchestration`, implementation source `4b3668d2031bd27312ec06aa2eba044e67ef4b2e`, targeting main `9a5c5f2e925c1d4d88c6a9dd9d2ed8f0f7e5c28d`. **In review / unmerged; draft retained.** This documentation-only publication status update records the real PR URL after creation; it is not another implementation correction or CI retry. Final source/current-head hosted CI and Automation 012/013 run/attempt/job/count/migration/cleanup evidence will be captured in the owner handoff; pending evidence is UNKNOWN, never passed. The earlier implementation-head run may be superseded by this status commit under unchanged workflow concurrency; no manual dispatch/retry. Implementation budget remains exhausted **5/5**, no post-review repair. Scope/claim/current-base and active owner D/P authority rechecked for this update; E/F NOT_GRANTED.

## Automation015 Stage1 / Issue #66 — owner-started task

Stable task `issue-66-stage1-a70a98d6255b`, sole branch `issue/66-automation-015-stage1`, base main `a70a98d6255bbf8944217745aa16e7cdb7475eb3` (PR65 merged, clean tree, no competing claim/branch/PR verified). Frozen issue revision2026-11-14T01:45:03Z, SHA256 `65d41311c89507300c1497956147be1fa15b4c2eed575277c9fc3ecc9c4f6302`. Initial read-only authorization preflight stopped because the uploaded quote explicitly disavowed independent proof; no implementation occurred. The owner's subsequent direct active-chat “Owner Authorization — Automation015 Stage1” reaffirmed B/C+D+P TASK_SCOPE, and repository admin permission/scope/lifetime/no-revocation were rechecked. Expires on completion/transfer/revocation/issue closure/scope change. [Claim](https://github.com/MightyMulligan-ops/strategy-game/issues/66#issuecomment-6869749785). E/F NOT_GRANTED. Scope only015A unified evidence,015B review intake,015D consolidated owner decision; no Stage2/durable store/delegation activation, agents/review invocation, post-review repairs, workflow/permission/dependency/gameplay/schema/SQL/migration changes, existing databases, task-side PostgreSQL/Docker/migrations, automatic CI retry, Ready/merge/deployment.

Initial implementation reuses the same collector/comment response and existing012/013 packet formats. Candidate claim/task/history references remain UNVERIFIED_METADATA; missing ledgers never become zero. Review completion additionally requires reviewer/author separation, stable-task/raw-review-digest/source/head/base/CI binding and an explicitly supplied trusted synchronous provenance-verification function; receipt-shaped JSON/flags alone cannot supply it. No hosted verifier, task runner or identity service added. Consolidated text includes scoped inventory/rename origins, provenance gaps, budgets, reason codes and next owner action in existing artifacts with one review prompt.

Initial focused verification **216 passed /1 failed /0 skipped** (217), including all32 new Stage1 cases passing; scripts TypeScript exit0. **Correction pass1/5**: initialize the shared synthetic review digest before the existing fixture immutability assertion, preserving that assertion and all validation. Failure was fixture setup mutating on first use, not restoration/validation behavior. Files: scripts/tests/pr-orchestration-fixture.ts. Previous/current source is the uncommitted task tree on approved base; no published SHA yet. Full database-free verification pending. No post-review repair started; prior task counters remain separate.

Pass1/5 final verification: pinned pnpm12.18.0 frozen install, Prisma7.10.1 generation, full build, TypeScript, lint and diff checks all exit0. Full suite **1705 passed /0 failed /262 intentionally skipped**,58 executed/15 DB-skipped files; all32 new Stage1 tests and prior012/013/014 coverage pass. Four implementation correction passes remain unused; no post-review repair is authorized. Ten documentation/diagnostic/test files only; no Stage2, workflows/permissions/dependencies/gameplay/runtime/schema/SQL/migrations changed. Active direct owner reaffirmation, current admin permission, frozen scope/base, lifetime and sole claim rechecked before TASK_SCOPE publication. Draft publication/unchanged hosted disposable CI authorized; independent review/acceptance and E/F remain separate. Actual PR URL/current-head hosted evidence will be recorded after creation; pending evidence UNKNOWN.

Publication: [draft PR #67](https://github.com/MightyMulligan-ops/strategy-game/pull/67), sole branch `issue/66-automation-015-stage1`, stable task `issue-66-stage1-a70a98d6255b`, implementation source `86a9ec7671cd884a74ac0e294c570599c68b2553`, base `a70a98d6255bbf8944217745aa16e7cdb7475eb3`. **In review / unmerged, draft retained.** This documentation-only update records the actual PR URL, not another implementation correction or CI retry. Current-head unchanged hosted CI, migration/cleanup and012/013 evidence will be captured in the handoff; pending evidence UNKNOWN. An initial run may be superseded under existing concurrency by this status commit; no manual dispatch/retry. Correction history1/5 (four unused), no post-review repair, E/F NOT_GRANTED.


Post-publication correction and review record for Issue #66 / PR #67 (append-only; earlier snapshots above are historical): On HEAD `b5420a26639ad8ffe3c0c74c0ab284f31105020b`, hosted run [43544345626](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43544345626) reported application 1705 passed/262 skipped and PostgreSQL 261 passed/1 failed. A separate owner-authorized, test-only correction sorted diagnostic participant snapshots by `playerId` while retaining strict equality, commit `03846deb33d0b75838ad951d8ddf711c1986463b`. Exact-head run [43549723714](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43549723714), attempt 1, passed: application 1705 passed/262 skipped; PostgreSQL 262 passed/0 skipped; 11 disposable migrations applied, container/network removed. No manual CI retry. The test-only correction is a separately authorized post-publication correction; classification against the original 1/5 implementation ledger is not independently authenticated and must not be treated as a reset or a verified remaining budget.

A subsequent Codex technical assessment (self-disclosed prior implementation author, **not independent-review provenance**) identified confirmed blocking `ISSUE66-JOB-ID-SET-001`: two differently named job records could reuse one observed job ID and matching URL, omitting the other observed ID. Owner's current-chat authorization covers narrowly scoped validator/regression/history repair on this existing draft branch and unchanged hosted CI, without merging/deployment or privileged workflow changes. Repair attempt 1 of at most 2 for this failure ID: enforce distinct reported IDs and exact observed-ID coverage, and add synthetic duplicate-ID-and-URL regression. This entry is a contemporaneous report of the intended correction; its commit SHA and CI result must be verified from GitHub after publication. A separate genuinely independent exact-head review is still required; E/F remain NOT_GRANTED.

## Issue #74 — own-formation map inspection, owner-started cloud task

Stable task `issue-74-ui-5565124`, sole branch `issue/74-select-own-formation`, base `c8b2795911899f8ffdfbd8152aab825914a53e91`. Owner's active-chat Issue #74 launch explicitly grants B/C, D (unchanged hosted fresh disposable PostgreSQL CI) and P (one branch/draft PR) in TASK_SCOPE mode. Frozen issue body revision `2026-11-14T17:26:50Z`; snapshot SHA256 `d428cf614f11de6cbd4c49d1d8fd8f67a3be9824b175f5f86242b595dd15a2c1` (indented JSON plus newline containing repository, issue, original revision, title and exact body). [Sole task claim](https://github.com/MightyMulligan-ops/strategy-game/issues/74#issuecomment-6881510203); no competing assignees/comments/branches/open PR before claim. The prefetch checkout was `5565124`; fetching advanced main before creating the branch. Authority verified against the direct active owner request, not issue prose/labels; expires on task completion/transfer/revocation/closure/scope change. E/F NOT_GRANTED. No task-side databases/credentials/migrations/PostgreSQL/Docker, backend/contracts/gameplay/dependencies/workflow/security/permission changes. Independent review and post-review repairs are not launched.

Initial implementation adds an accessible own-marker control linked to one collapsible existing roster, focus/selected styling, Escape/return interaction, versioned authoritative position and supported pending flag. Same-match successful refresh/reconnect preserves selection; failure/unavailable/match/session changes clear it and canceled reads cannot restore data. Destination picking remains separate. Initial focused run: **126 passed / 1 failed / 0 skipped** (3 files); new selection/lifecycle/destination tests passed. Failure `ISSUE74-INSTRUCTIONS-ASSERTION`: an existing test expected the old one-map-stop instruction text. **Correction pass 1/5 started**: update that assertion to verify the new honest marker Tab instructions, clear retained selection if a refreshed READY formation changes identity, and finish account-transition coverage. Old source is the uncommitted initial task tree on the approved base; no published SHA. No independent review or post-review repair has occurred. Full database-free verification and visual smoke test pending.

Pass 1/5 outcome: focused **127 passed / 0 failed / 0 skipped** before the two additional logout cases; Prisma generation, workspace build and TypeScript exit 0. Full validation stopped at lint (3 `react-hooks/refs` errors); full suite not yet run. `ISSUE74-REF-PROP`: lint tainted the inspection object when a mutable React ref was passed inside it. **Correction pass 2/5 started**: expose a stable callback ref instead of passing the mutable object, preserving focus behavior and lint rules. Approved files: Formations.tsx (callback type/registration), tests if needed; source remains uncommitted on approved base. No post-review repair or hosted retry. Browser smoke fixture is synthetic and scratch-only; visual result pending.

Pass 2/5 outcome: lint still failed (4 `react-hooks/refs` errors); callback propagation kept the containing render-prop object ref-tainted. Build/typecheck/test after this edit were not run because the check sequence stopped. **Correction pass 3/5 started** (`ISSUE74-REF-PROP`, same diagnosis): replace cross-render-prop ref plumbing with a stable useId marker ID and look up/focus that element only in the close event handler. The heading ref remains internal. No lint suppression or rule changes. Source remains uncommitted; full verification follows. Scratch-only browser harness module resolution was also adjusted; no dependency/configuration file in the product was changed.

Pass 3/5 outcome: lint, workspace build and TypeScript exit 0. Full suite **1724 passed / 2 failed / 262 deliberately skipped**, 57 passed/1 failed/15 DB-skipped files. Both failures `ISSUE74-LOGOUT-HARNESS` are new logout tests: App's existing successful logout calls `window.location.replace('/')`; the unit harness mocks that function and therefore never tears down the page. Focused diagnosis reproduced **50 passed / 2 failed / 0 skipped**. **Correction pass 4/5 started**: assert the actual logout redirect, explicitly emulate page teardown/rebootstrap in that harness, then verify aborted formation read, ignored late response and signed-out screen. Only App.test.tsx changes; product authentication behavior stays unchanged. No source commit yet; old/new SHA remain the approved base plus uncommitted task tree. No post-review repair/hosted retry. Final-source Chromium visual smoke and accessibility-tree inspection passed at 1280/768/390 px with pointer interior, Tab/arrows/Enter/Space/Escape, focus return, no horizontal page overflow, forced colors/reduced motion and zero page errors; screenshots inspected. Real assistive-technology speech output remains an independent manual review limitation.

Pass 4/5 final outcome: focused **129 passed / 0 failed / 0 skipped** (3 files); full workspace **1726 passed / 0 failed / 262 intentionally skipped** (58 executed/15 DB-skipped files); lint, TypeScript and diff checks exit 0. Frozen install, Prisma generation and full build also exit 0; the build binds the unchanged final product source (pass 4 modified only the logout tests). All task checks used `AUTH_ENABLED=false RUN_DATABASE_TESTS=0`, Node24.22.1, published pnpm12.18.0. Nineteen new frontend regressions pass. No database verification is claimed from skips. Correction history **4/5**, one unused; no independent review/post-review repair or transfer. Manual interventions: toolchain PATH activation from the published guide, scratch browser module-resolution setup, and four documented bounded correction passes; no further owner permission needed. Scratch scripts/screenshots/logs excluded from publication.

Publication preflight: exact issue body unchanged, open issue, sole Task ID claim, no competing PR/branch, full six-file diff reviewed, no protected-path/dependency/generated/secret changes; current main remains `c8b2795911899f8ffdfbd8152aab825914a53e91`. Exact issue-body SHA256 `f344655f0d4caabd1bceccee1b7ede4cd5252ab3e3615bf6f0a174c317229498` is retained separately from the canonical snapshot digest above for comparison with the existing reporter. Active owner B/C+D+P TASK_SCOPE grant remains current, within scope and lifetime, without revocation. Prepared for one draft PR; actual URL/current source and unchanged hosted CI/Automation 014 handoff follow. **In review / unmerged**, not a completed milestone; E/F NOT_GRANTED.

Publication: [draft PR #75](https://github.com/MightyMulligan-ops/strategy-game/pull/75), sole branch `issue/74-select-own-formation`, implementation source `c2d8d7cf356b44a3d1cabc9377446d32b1239fd4`, base `c8b2795911899f8ffdfbd8152aab825914a53e91`. **In review / unmerged; draft retained.** This documentation-only scoped update records the real PR URL after creation, not an implementation correction or CI retry. Current clean task branch/full six-file diff, unchanged frozen issue, sole claim, current base and active owner D/P TASK_SCOPE authority rechecked before publishing this update. The initial run may be superseded by the final status commit under unchanged workflow concurrency. Final source/run/attempt/jobs/counts/migration/cleanup and Automation 012/013/014 evidence will be recorded in the PR completion handoff; pending evidence UNKNOWN. Correction history remains **4/5**, no post-review repair or transfer. No task-side DB operations, merge, deployment or automatic retry; E/F NOT_GRANTED.

## Issue #74 / PR #75 — post-review repair `ISSUE74-FOCUS-REFRESH-001`, attempt 1/2

Owner's active-chat “Sovereign — Issue #74, Post-Review Repair 1/2” explicitly authorizes evaluation/reproduction and the smallest frontend focus-refresh repair, relevant database-free checks and this status update, **LOCAL CHANGES ONLY**. Expected/observed source `3098a431c8aa3f29eb3f456ddacdd2e0add3d3c2`, base/current main `c8b2795911899f8ffdfbd8152aab825914a53e91`, sole existing branch `issue/74-select-own-formation`, [draft PR #75](https://github.com/MightyMulligan-ops/strategy-game/pull/75). Clean synchronized tree, unchanged frozen Issue #74 body digest `sha256:f344655f0d4caabd1bceccee1b7ede4cd5252ab3e3615bf6f0a174c317229498`, sole existing task claim, no conflicting repair history/competing work verified before edits. Original implementation ledger **4/5 retained unchanged**; independent review ends that loop. This is separately owner-started post-review attempt **1/2**, previous attempts none as attested in the active request and consistent with retained records. Finding source: owner's independent read-only ChatGPT project review; original classification is a potential accessibility risk by code inspection, not independently browser-reproduced. The repair author does not claim independent-review provenance.

Existing published-source CI [43622680219](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43622680219), unchanged workflow414147274 / `.github/workflows/ci.yml`, same-repository PR75/source branch/head, attempt1 success; Application job132531641121 and PostgreSQL job132531641343 both success. Previously corroborated reporter counts1726 passed/262 DB skips and262 PostgreSQL passed/zero skips remain source-bound UNTRUSTED_RUNNER_REPORT evidence, **not verification of this uncommitted repair**. Existing [Automation014 handoff](https://github.com/MightyMulligan-ops/strategy-game/pull/75#issuecomment-6881716598) retained. No new hosted run is authorized.

Attempt1/2 started: reproduce focus removal using a deferred formation read in the existing WorldView tests and a synthetic browser fixture; only then correct Formations.tsx if confirmed. Approved local files: Formations.tsx, WorldView.test.tsx and this status file. No new branch/worktree/PR or GitHub metadata update; no commit/push, hosted CI/retry, database/credentials/PostgreSQL/Docker/migrations, backend/gameplay/contracts/dependencies/workflows/security-policy change, ready/merge/deploy. No second repair invocation is authorized. Result/new source currently UNCOMMITTED; checks pending; fresh independent review required afterward.

Attempt1 reproduction confirmed before product edits: focused deferred-read regressions **2 failed / 0 passed / 63 filtered skips** (exit1), demonstrating reconnect loses the focused details heading and manual refresh does not retain predictable focus. Author-run real Chromium independently of jsdom reproduced **focus on document.body in both reconnect and keyboard-activated manual refresh**, zero page errors; successful same-formation responses still preserve selection. This is author reproduction, not independent review. Root cause: refresh removes the focused details subtree; manual refresh disables its focused button; no stable focus destination is assigned.

Smallest correction: make the existing, named formation section programmatically focusable (`tabIndex=-1`, no extra normal Tab stop), and focus it **before** clearing private data/disabling controls only when current focus is already inside that panel. It remains mounted during loading/error/success. No completion-time focus restoration is scheduled, so intentional focus changes during the read are preserved; external focus at refresh start is untouched. Selection/abort/session logic is unchanged. Regression coverage includes reconnect/manual fallback, focus moved elsewhere before/during refresh, failed reads and superseded reads, plus existing Escape/return/keyboard/logout/match tests. Still attempt1/2; no automatic second invocation. Full verification pending.

Attempt1/2 verified outcome — **LOCALLY REPAIRED, UNCOMMITTED**: six new regression cases pass; focused command `pnpm exec vitest run apps/web/src/WorldView.test.tsx apps/web/src/MovementQueue.test.tsx apps/web/src/App.test.tsx` exit0, **135 passed / 0 failed / 0 skipped**, 3 files. Full `pnpm test` exit0, **1732 passed / 0 failed / 262 intentionally skipped**, 58 executed/15 DB-skipped files. `pnpm install --frozen-lockfile`, `pnpm db:generate` (Prisma7.10.1), `pnpm build`, `pnpm typecheck`, `pnpm lint` and `git diff --check` all exit0; published Node24.22.1/pnpm12.18.0, `AUTH_ENABLED=false RUN_DATABASE_TESTS=0` throughout. No dependency/lock changes or database verification claimed from skips. Synthetic real Chromium before/after confirmed both reconnect and keyboard-manual refresh now keep focus on the stable named “Your formations” region and preserve selection. Accessibility-tree region name/focused state corroborated; Escape/Space/return controls and intentionally moved external focus passed, zero page errors. Browser fixture/server stopped and scratch evidence moved outside the checkout. Real screen-reader speech, other browser/assistive-technology combinations and independent acceptance remain unverified.

Repair history: `ISSUE74-FOCUS-REFRESH-001`, owner-started attempt **1/2**, previous attempts none; original finding CONFIRMED by author regressions/browser reproduction, locally corrected and verified; no locally unresolved instance of that finding observed. Old/published HEAD `3098a431c8aa3f29eb3f456ddacdd2e0add3d3c2`; new repair HEAD **null / UNCOMMITTED** (actual Git HEAD unchanged); old/new PR base `c8b2795911899f8ffdfbd8152aab825914a53e91`. Changed files only Formations.tsx, WorldView.test.tsx and this status file. No commit/push/PR/comment/label update, hosted CI/retry, second repair attempt, database/migration, ready/merge/deploy. Existing published CI/report remain unchanged and cannot verify these local edits. Original implementation history **4/5 unchanged and closed by independent review**, not reused as a repair allowance. Updated review handoff decision **UNKNOWN pending fresh independent review**; repairAuthorization/E/F remain **NOT_GRANTED**. The active-chat grant covers only this completed local attempt, not publication or another attempt. Stop after this handoff; preserve these uncommitted edits and append-only histories.

Publication authorization for the completed attempt1/2: owner's subsequent direct active-chat request explicitly authorizes committing/pushing **only** these three completed files on the existing branch and updating draft PR75, with unchanged hosted CI using its fresh disposable PostgreSQL service. It supersedes the earlier LOCAL CHANGES ONLY delivery restriction for this completed repair; it does not start another repair attempt, renew implementation corrections, broaden scope or authorize CI retries/agents/E/F. Pre-publication expected/local/remote source `3098a431c8aa3f29eb3f456ddacdd2e0add3d3c2` and base/current main `c8b2795911899f8ffdfbd8152aab825914a53e91` match; only the authorized three-file unstaged delta exists, no staged/untracked/unrelated work or competing PR/claim. Full patch reviewed; product/test SHA256 `2d8ceb689f06061fbe2b143d4a4fec5b28d7374f3b441fd91db860cecab34e12` exactly matches the retained successful local verification. No product/test edits or redundant test run during publication. Document-only publication authority recorded here; prior local-only snapshots above remain append-only history. One scoped commit/push will publish the completed attempt; new source SHA, current-head CI/run/attempt/jobs/counts and existing Automation014 report will be recorded in the PR publication handoff. Pending hosted evidence UNKNOWN. PR remains **draft / in review / unmerged**, implementation4/5 history closed, repair1/2 retained, fresh independent review still required; E/F NOT_GRANTED.

## Issue #79 — autonomous development infrastructure (2026-11-14)

Owner explicitly authorized infrastructure implementation, ordinary offline corrections, tests, dedicated branches and draft PR publication; **no paid API calls**, merge, deployment or existing database access. Separate Issue #79 branch adds pure offline scope/admission/manifest/publication policy functions and 13 synthetic Node test cases plus design documentation. Local Node 22 test command `node --experimental-strip-types --test scripts/tests/codex-automation-policy.test.ts` passed 13/13 before GitHub publication. This is **not** an authenticated owner-grant verifier, actual Git tree reconstruction, isolated worker, trusted GitHub publisher or live integration. Hosted CI, independent review and any actionlint evidence are pending/unknown; draft PR remains unmerged. Paid execution/E/F NOT_GRANTED.

Issue #79 follow-up offline validator increment: added `scripts/codex-proposal-replay.py` (credential-free temporary Git-index patch reconstruction) and `scripts/tests/codex-proposal-replay.test.py` (9 synthetic Git cases). Author-run `python scripts/tests/codex-proposal-replay.test.py -v` passed 9/9 before publication. This tool **does not authenticate supplied scope, establish agent process isolation or publish a PR**. Published-head CI and independent review remain separate. Paid execution/E/F NOT_GRANTED.


## Issue #79 — owner-started security continuation, 2026-11-14

The active owner request in Work names PRs #78/#80 and Issue #79 and expressly authorizes implementation, testing, commits, draft PR publication and paid Codex execution subject to existing safeguards and the $45 operational cutoff. This supersedes earlier NOT_GRANTED paid-authorization snapshots for the requested safe first pilot; it does not satisfy technical admission or grant merge, deployment, database access, permission expansion, or safeguard bypass. Existing history above remains unchanged.

Review of published PR80 source `95673367eac186afc500d428bb4d6f5e6f2b892a` reproduced admission accepting absent revocation/competing-claim observations, publication accepting NaN counts, and null manifest validation throwing TypeError. Original Python fixtures passed 9/9 but did not cover these findings. Owner-started bounded correction pass 1 in this continuation corrects these findings with strict boolean/count checks, malformed manifest rejection, summary secret-pattern checks, bounded regular single-link artifact reads, ignored-source rejection, path/type validation and reconstructed Git tree SHA output. Existing 5/2 histories are not reset; no automatic repair or paid retry is introduced. This is author validation of the new changes, not independent certification.

Affected source/tests: scripts/codex-automation-policy.ts, scripts/codex-proposal-replay.py and their three test files. Local Node 24.22.1 / Python 3.12.14: Python unittest 18/18 passed; Vitest 4.0.0 with compatible Vite 7.1.12, AUTH_ENABLED=false RUN_DATABASE_TESTS=0: 19/19 passed (18 policy tests plus one wrapper executing 18 Python fixtures); strict targeted tsc 6.0.3 passed. The temporary test-tool install is outside the repository; no package or lockfile change is published. An initial temporary Vitest/Vite 7.3.8 combination failed before collecting tests (getBuiltins RPC mismatch); selecting Vite 7.1.12 corrected that local harness. Initial targeted tsc lacked repository ESM metadata; restoring exact published package.json resolved it. No full local repository build/CI or actionlint claim.

Reviewed pre-change CI: PR78 run 43634935997 and PR80 run 43635341414 both report completed/success for Application checks and PostgreSQL integration tests. PR80 run metadata binds source 95673367eac186afc500d428bb4d6f5e6f2b892a, base 4ac5fca5941f89612f813ed6059610bcacb9da5d, attempt1 and workflow .github/workflows/ci.yml. These are historical after this correction publishes, not new-head evidence. No CI retry was dispatched.

Paid pilot remains BLOCKED: Platform usage redirected to sign-in; secure authentication recorded the user's Google selection, then automatic browser approval review denied observation of accounts.google.com as a separately unauthorized authentication origin. No retry or workaround. Current spend/hard enforcement could not be verified. GitHub's pinned upstream action.yml independently confirms both CLI and proxy are npm-installed from the codex-version input, which PR78 leaves blank; their resolved package integrity remains unverified. Authenticated admission, durable claim/ledger, worker termination/log confidentiality and trusted isolated publisher are not implemented. PR78 remains unchanged and literal-false disabled. No paid API call, production/existing DB access, merge or deployment initiated. Current-head hosted CI and independent review must be checked separately after publication.


## Issue #79 — durable controller/gateway/publisher candidate continuation (2026-11-14)

Owner's active Work request explicitly says to proceed with all steps necessary, carrying forward implementation/testing/commits/draft PRs and conditional first-paid-pilot authority under the $45 cutoff and existing safeguards. No merge/deployment/production or existing database access, security bypass or additional services are granted. The existing PR80 branch is retained. Starting source `391e02a638b351c169c7f850098ff2964cdbe6e7`, base/current main `4ac5fca5941f89612f813ed6059610bcacb9da5d`. PR78 remains unchanged and disabled.

Added five TypeScript modules: codex-run-control (durable-budget/run/publication state machine), codex-github-control (fixed-origin HTTPS, Git-ref CAS ledger and live owner/grant/source collector), codex-responses-gateway (bounded model-only Unix gateway/transport), codex-proposal-publisher (signed validator receipt, complete tree comparison and one-shot draft publication), codex-runtime-preflight (reviewed-binary/namespace probe). Added four matching test suites and rewrote the pipeline/review handoff documents to describe actual delivered and missing integration. No dependency/lockfile, workflow, permission, gameplay, database, migration or deployment file changed. No live ledger, grant comment, signing identity, worker, publisher write or model request was created by running these modules; tests use synthetic credentials/transports and in-memory fixtures. The operational publication below uses the already authorized connected GitHub path for this infrastructure PR only.

Correction history is preserved from the prior recorded 1/5; no reset. Pass2/5: initial new-suite verification found the host prohibits Unix socket listening (EPERM); the fixture now records an explicit environmental skip rather than inferring a pass, and scope/runtime-proof checks were tightened. That verification exposed an expired-price test with stale runtime evidence instead of the expected expiry reason. Pass3/5 corrected that fixture's time binding: 47 passed, one environmental skip. Pass4/5 strengthened matching of ledger run/scope/budget, private socket parents and final grant checks; addressed the identical-commit CAS race with a unique commit nonce and an explicit same-run-ID concurrency regression. Functional suites: 49 passed, one skip; applying the full repository TypeScript strictness then exposed exact-optional/indexed-access errors. Pass5/5 corrected absent fetch-body handling, explicit matched-file narrowing and known test-fixture indexing/optional-parent types. Final targeted tsc6.0.3 using all relevant repository strict flags exited0; six relevant Vitest suites exited0 with 49 passed, one skipped (50 total). The Python wrapper executes 18 passing replay fixtures. No unresolved functional test failure remains locally, but the runtime integration is explicitly unverified. The five-pass implementation allowance is exhausted; no automatic additional corrective loop, post-review repair or CI retry is authorized by these test outcomes.

Runtime evidence: direct Bubblewrap invocation failed network-namespace setup with Operation not permitted. The new structured preflight, run on Node24.22.1 using transform-types with a diagnostic fingerprint of installed bwrap (not an independently approved production toolchain manifest), returned `{available:false,reason:namespace-isolation-unavailable}`. Strip-only TS diagnostics initially failed because parameter properties require compilation or transform-types; the corrected diagnostic command succeeded in reporting unavailable isolation. The real Unix-socket test is skipped locally only on EPERM; it must run without skips on a compatible executor before activation. Docker/Podman absent. OPENAI_API_KEY/GITHUB_TOKEN/GH_TOKEN presence-only checks show absent; no secret/env file or browser credential was read, copied or transferred.

The browser previously established approximately $0.11 spent in Strategy Game: Sovereign and saved a $45 enforced project limit. Provider enforcement can lag; this is not a strict ceiling. New integer micro-USD reservations retain full run/request allowances on all ambiguous outcomes, but authoritative initial billing/rate evidence, exclusive project routing and actual key binding remain unverified. No production price card/ledger has been initialized.

LIVE ACTIVATION BLOCKED: a compatible isolated executor; reviewed immutable runtime/toolchain; actual worker/bridge/exporter/validator/termination lifecycle; trusted runtime-verifier wiring; secure project-key binding and price/billing intake; trusted signer enrollment and exact-head independent security review are still required. The modules are component implementations, not an end-to-end deployed runner. Do not substitute mocked proof callbacks, a green CI result or this author's tests for those requirements. No paid pilot, existing DB access, merge or deployment occurred. Publishing this candidate triggers only the unchanged owner-authorized hosted CI; new-head run evidence must be checked independently.


## Issue #79 — owner-authorized scoped GET fixture correction (2026-11-15)

The active owner request “Do whatever is necessary to make this work” follows the concrete request to authorize the GET fixture correction after the recorded five-pass limit. It authorizes this narrowly scoped exception: one extra correction for ISSUE79-GATEWAY-GET-FRAMING-001, evidence/status update, commit to the same branch/draft PR and unchanged hosted CI. Original 5/5 history remains intact; this is an explicit owner exception, not a reset, automatic retry or independent security acceptance. Existing paid/security/$45/E/F boundaries remain unchanged.

Starting source 09626923dd42e4cc239ce7a8ebc2a4e9f05675be and base/main 4ac5fca5941f89612f813ed6059610bcacb9da5d rechecked. The single test change omits the body for GET and retains the POST JSON body: req.end(method === 'POST' ? '{}' : undefined). Both existing security assertions remain unchanged, including HTTP403 and constant error JSON; no gateway/production/policy logic changed. The pre-edit local fixture blob was verified against the published blob 72c705e565214d8cfc33209ff6a199af37fb51bc; all seven controller/validator source modules match published Git blob hashes.

Local Node24/Vitest4.0.0/Vite7.1.12: six targeted suites, 49 passed and one skipped out of 50; Python wrapper executed 18 passing replay fixtures. The Unix fixture remains skipped locally because Work denies listening; the unchanged hosted job is needed for actual execution. Targeted tsc6.0.3 using the repository strict flags exited0. Temporary test tools were restored after workspace maintenance; no repository dependency or lockfile change.

A fresh sandbox preflight still returns namespace-isolation-unavailable; the diagnostic binary fingerprint is not independent production toolchain approval. No runtime privilege, network policy, credential, live ledger, signer or paid worker change was attempted. PR78 remains unchanged and disabled. New-head hosted CI must be checked after publication; the previous run154 failure is historical evidence for the repaired fixture, not current-head evidence. The runtime/credential/billing/signing integration and independent security-review blockers remain.


## Issue #94 / existing draft PR #93 — CI isolation and non-paid ledger bootstrap

Owner-started subscription Codex task, isolated worktree on existing
`chore/overnight-ledger-bootstrap`; original source
`b9fcb6dc70ce49dc1b5934c8634bdce88a379eac`, main/base
`02deba5e3e295f88f5cf600142b7035a42664b63`. Active owner request explicitly covers
CI reliability/test-runner changes, bootstrap workflow completion, documentation,
publication and bounded fresh disposable PostgreSQL CI. Owner account current admin
permission verified; sole Issue94 claim recorded. Frozen issue body SHA256
`97c320b88b3b38867b7433a3d47586d2e7f7512bd30b7f1e3bdcb18d494bdd66`.
[Draft PR93](https://github.com/MightyMulligan-ops/strategy-game/pull/93) remains
**in review / unmerged**. Original failed run43995211222 attempts1/2 (260/2 each)
remain recorded. No failed job was silently retried or treated as success.

Shared-schema fixture DDL and intentional5.1-second deferred transactions overlapped
across Vitest files. Serialize integration files only; retain explicit concurrent
connections, all262 assertions, existing timing limits and the no-skip guard.
Bootstrap uses existing App/store, strict manual owner/main/attempt/confirmation,
independent key pin, disabled empty unsigned config, verified empty readback and
safe audit. No schema/migration/gameplay/dependency/production transaction or CI
workflow changes. Only the bootstrap workflow is refined within approved scope.
See CI.md for evidence/limitations and OVERNIGHT_QUEUE.md for the merged-only,
separately owner-authorized bootstrap procedure.

Issue94 correction pass1/5: initial focused run170 passed/6 failed/0 skipped.
The new config regression expected explicit retry0 but Vitest represents default
no-retry as undefined; assertion now uses its documented default. New bootstrap
fixtures intercepted App token minting but not the returned transport; intercept
both synthetic HTTP boundaries, with per-test restoration. No valid credentials
or paid provider calls were used. Original PR91 history5/5 and separately authorized
OVERNIGHT-REPORT-001 exception1/1 are unchanged; Issue94 is its own explicitly
owner-started CI/bootstrap task, not a reset of those histories.

Current checks and exact-source hosted evidence will be reported in the same PR
handoff and Issue94 after publication. Operational bootstrap remains NOT_RUN;
ledger absent at inspection; config disabled. Variable/secret metadata403 and App
installation401 leave live pin/credential/installation verification pending.
No task-side database/PostgreSQL/Docker/migration, settings changes, paid session,
queue activation, merge or deployment is authorized or performed.

Issue94 correction pass2/5: full script TypeScript found Vitest public declarations
omit two runtime fields used by the new CLI/config assertions. Assert parsed CLI
fileParallelism and resolved maxWorkers, and match reporter object shape without
unsupported property access. Focused runtime behavior was already passing176/0/0.
Added three post-create readback regressions (unavailable/corrupt/non-exact empty
state) to ensure creation success alone is never reported as bootstrap completion.
No production or timeout changes. Final verification follows in PR/issue evidence.

Final task-side checks, Node24.22.1/pnpm12.18.0 with AUTH_ENABLED=false and
RUN_DATABASE_TESTS=0: frozen install, Prisma7.10.1 generation, full build, full
TypeScript, final script TypeScript, lint, actionlint1.7.12 and whitespace checks
passed. Actionlint optional shellcheck/pyflakes integrations disabled (tools not
installed); workflow analysis itself passed. Final focused7 files:179 passed,
0 failed,0 skipped. Final full suite:2082 passed,0 failed,262 intentional database
skips across102 files. Includes32 new bootstrap and3 new runner regressions.
No skip is database verification. Real isolated validator smoke and262 PostgreSQL
cases remain hosted-only; pending evidence UNKNOWN until final-source CI completes.
Correction history2/5, no post-review repair; previous failures remain above.

## Issue #97 — owner-started Combat 1B Stage A (2026-11-17)

State: `issue/97-multi-force-combat`, local implementation / unmerged. Verified
current main/base `53180055dabde3d406935d76592505692d864cfc`, clean original
checkout, no competing #97 branch/claim/open PR; existing unrelated PRs preserved.
[Claim](https://github.com/MightyMulligan-ops/strategy-game/issues/97#issuecomment-6952741232).
The explicit owner launch in this task chat grants Stage A gameplay implementation,
database-free checks and a feature-branch commit in the existing cloud checkout,
using Codex subscription capacity only. No agents, new worktree or paid API task.
Scope frozen to Issue 97 body revision 2026-11-17T15:31:34Z; UTF-8 body plus final
newline SHA256 `5989e54aa6ae66d24f1fc21b92c8fbd173c13257c7eedaeb37d4a32030bdc13e`.
Only the two new engine/test files, MULTI_FORCE_COMBAT.md, relevant GAME_DESIGN.md
combat section and this status entry are authorized. Exact contract is recorded
in MULTI_FORCE_COMBAT.md; no later parent/child issue edit expands this freeze.
Approval expires at task completion/transfer/issue closure or explicit revocation;
none was observed at launch. This is an evidence record, not a standing grant.

The owner explicitly answered the two policy questions in this chat: retain the
provisional LCG32 floor-scaled 1..stat damage under the new version; clamp modified
ATK/DEF to at least 1; reject incomplete/asymmetric/non-transitive alliances; and
return a recoverable technical failure without partial results on exhaustion,
retrying the same frozen input with a larger budget. Missing specialization/unit
balance remains caller-supplied rather than invented. Primary rank values retain
the established table. No movement, persistence, UI, server wiring, capture writes,
DB/schema/migration, dependencies, workflows/security/auth, billing/key/config,
deployment or historical replay changes. Issue 95's signed scope is unchanged.

D (unchanged hosted fresh disposable PostgreSQL CI) is **NOT_GRANTED for #97**:
no pre-existing approval/comments were found, and the launch explicitly requires
holding publication without that separate issue-specific grant. Prepare one draft
PR handoff; retain the local commit and hold push/PR creation. E/F remain
NOT_GRANTED. Hosted CI is NOT_RUN/UNKNOWN; no database verification is claimed.

### Implementation corrections (append-only)

Initial focused run: 79 passed, 1 failed across 3 files (26 new engine cases plus
unchanged prototype/movement cases). Failure: same-player formation incoming
rotation repeated an army across rounds. Diagnosis: rotating the army order and
also advancing its initial selection cursor by round cancelled the intended
rotation for two armies. Pass 1/5 begins: remove the duplicate round offset from
target-player/formation cursors; retain the independently rotated encounter order.
No assertion is weakened. Initial targeted TypeScript/generation results and
pass verification follow below. No independent review or post-review repair.

Initial targeted engine typecheck exited 1: relationship literal widened to string
and a narrowed leader union was not retained inside a callback. Both are corrected
in pass 1 with explicit literal typing and a captured specialization; no rule or
validation relaxation. Frozen pnpm 12.18.0 install and Prisma 7.10.1 generation
exited 0. All checks use AUTH_ENABLED=false / RUN_DATABASE_TESTS=0.

Pass 1 focused verification passed 80/80 across 3 files; targeted engine TypeScript
exited 0. Full workspace checks are running. Author contract inspection identified
an additional casualty-order edge before completion: initially wounded ordinary
units must precede intact ordinary units, and packet overflow should rotate armies
after each killed unit rather than exhaust one entire army first. Pass 2/5 begins:
correct those two allocation details in the new module and add explicit fixtures.
Pass 1 history is retained; no independent review or history reset.

Pass 2 focused verification passed 83/83 across 3 files (29 new cases,54 unchanged
prototype/movement cases), including wounded-input priority, overflow rotation and
the encounter-wide 2048-unit bound. Tightened the final leader-death strength test
to require the death/survival result explicitly rather than conditionally assert.
The earlier workspace build/typecheck/lint each exited 0, but overlapped pass 2 edits;
final-source checks will be repeated sequentially for unambiguous provenance.

Intermediate full verification: build/typecheck/lint exit0. Full `pnpm test`
exited 1:2101 passed,10 failed,262 intentional DB skips (87 passed files,1 failed,
15 skipped). This run overlapped pass 2 edits and is not final-source certification.
All 10 failures are in unchanged scripts/tests/overnight-production.test.ts.
Concrete cause: overnight-fixture.ts fixes now at 2026-11-17T03:30Z and the manifest
end at 07:30Z; QueueSessionProvider.createSession uses real Date.now() against that
deadline (less 120 seconds), already expired at this task's 15:48Z verification.
It fails before mock session creation, so dependent publication/cleanup assertions
also fail. No provider network request or paid task was launched by these synthetic
transport fixtures. These files match main and are outside the five-path scope;
no fixture clock, provider, timeout, assertion or test-selection change is made.
Final checks retain this limitation rather than calling it a green full suite.

Pass 2 also adds explicit mutual-destruction/no-transfer and 2048-unit/40-player
boundary fixtures, and a 2049-unit rejection fixture. The encounter-wide ceiling
was already present; a duplicate bound check introduced during inspection was
removed before final verification. No numerical balance defaults are added.

### Final task-side verification and draft handoff

Final product/test source SHA256:
- multi-force-combat.ts: `163c520b061b1902e371500c7d8e9d5abfb0f490a8988efab99f99d9b71bc9ce`.
- multi-force-combat.test.ts: `009e7a953c96d71a96fceb5bf92ed33ff4fa9113a82ef642fd39a26462fa5185`.

Node24.22.1, pinned pnpm12.18.0, Prisma7.10.1, Vitest4.1.12; all commands use
AUTH_ENABLED=false / RUN_DATABASE_TESTS=0. Real final results:

| Command | Exit / result |
|---|---|
| `pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store` | 0; 474-entry supply-chain check, unchanged lockfile |
| `pnpm db:generate` | 0; client generation only, no DB connection |
| `pnpm exec vitest run packages/game-engine/tests/multi-force-combat.test.ts packages/game-engine/tests/combat.test.ts packages/game-engine/tests/movement-resolution.test.ts` | 0;85 passed,0 failed,0 skipped,3 files (31 new +54 unchanged) |
| `pnpm build` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm lint` | 0 |
| `pnpm test` | 1;2103 passed,10 failed,262 intentional DB skips;87 passed/1 failed/15 skipped files,103 total |
| `git diff --check` and staged diff/scope review | 0; exactly the five approved paths |

The final full failure is the same10 unchanged overnight-production fixture cases
diagnosed above; no Stage A/prototype/movement case failed. Full-suite acceptance
is therefore **NOT GREEN**. No existing database, PostgreSQL/Docker startup,
provisioning, migrations, live provider/API coding request or CI retry was used.
Database cases are unverified; skips do not establish database correctness.
Workflow files are unchanged, so actionlint is not applicable. There is no UI
change requiring browser verification. Numeric inputs and capacity ceilings are
not a production load certification. Budget-ceiling exhaustion requires future
execution-capacity recovery; this slice does not persist mid-battle checkpoints.

Final implementation correction accounting: **2/5 used**, scoped failures corrected;
no independent review or post-review repair. The unrelated suite failure remains
outside scope, not silently skipped/fixed or a reset of the correction history.
No remaining Stage A gameplay decision was silently chosen: the four actual policy
choices have explicit owner answers; missing balance tables remain caller inputs.
Leadership eligibility and specialization balance still require authoritative
caller configuration before any later runtime integration.

Publication state: **local commit only, unmerged; push and PR creation HELD**.
Issue97 body is unchanged from the frozen snapshot; current main was rechecked as
`53180055dabde3d406935d76592505692d864cfc`. PR88 was independently confirmed merged
as `a7290ceab2e3d55924e1d144c38370a3455c2011`; its historical code remains intact.
PR96 is still draft/unmerged and grants nothing for this issue. No competing97
PR/remote branch or separate #97 disposable-CI approval was found on recheck.
Current-head hosted workflow/run/attempt/job IDs, test counts, migration/cleanup
and independent-review packets are all NOT_RUN/UNKNOWN. No PR URL exists.

One prepared draft PR handoff (not published): title **Combat 1B Stage A: pure
multi-force engine and deterministic tests**, branch `issue/97-multi-force-combat`
targeting same-repository main. Its body will contain exactly one standalone
`Closes #97` directive, the five-file inventory, frozen scope/owner and policy
answers, final verification table, 2/5 history and the unrelated full-suite failure.
Remaining owner actions: separately authorize unchanged hosted fresh disposable
PostgreSQL CI for #97 before publication; handle the stale overnight fixture in a
separately scoped repair; arrange independent review. No merge/deploy is granted.
The exact retained commit SHA is in the task completion/issue handoff, avoiding a
self-referential commit ID in this file. Historical status content is preserved.

Pass3/5: the first staged diff check caught one extra blank line at the end of the
new source file (untracked files had not been covered by the earlier unstaged diff
check). Remove only that blank line, then rerun the complete staged whitespace and
five-path inventory checks. This is whitespace-only; the85 focused cases and full
functional checks above remain applicable, with no behavior/test/assertion change.
Final correction accounting supersedes the earlier point-in-time2/5: **3/5 used**.

Final source SHA256 after whitespace cleanup: `3e89566021e98b2131565880a3084ac848f759775b9474849c5c0c6f2dea96cc`.

### Issue #97 publication continuation — November 17

The owner's active continuation explicitly authorizes pushing exact implementation
commit `a9a05ddbf18f60c09f1429d9e7553e29f95c018a`, opening its one draft PR and running
unchanged hosted CI with fresh disposable PostgreSQL. Approval source: the owner's
November17 project-chat answer to that exact publication/CI question, “Yes, do
whatever it takes to fix this and move it forward,” explicitly confirmed by the
current owner request. Necessary #97 status/evidence documentation updates within
the original five paths are covered. This supersedes the earlier missing-D hold
for this issue only, not the retained failure/correction history. No ready, merge,
deploy, existing-DB, workflow/dependency, additional agent/task or paid API grant.
[Publication authorization record](https://github.com/MightyMulligan-ops/strategy-game/issues/97#issuecomment-6953825707).

Rechecked clean same workspace/branch/head, same current main/base
`53180055dabde3d406935d76592505692d864cfc`, complete five-path diff, sole paused claim
and no existing #97 PR/remote branch. Pushed the exact approved implementation
commit unchanged, then opened [draft PR #99](https://github.com/MightyMulligan-ops/strategy-game/pull/99)
from `issue/97-multi-force-combat` to same-repository main: **in review / unmerged**.
This append-only evidence update is a separate status-only descendant commit;
implementation/test files remain byte-identical to the owner's approved SHA.
Correction history remains **3/5**; publication documentation is not another
implementation correction or post-review repair. No amend, rebase or fixture fix.

The coordinator independently reproduced all10 overnight-production failures on
unchanged main and reports all27 tests pass with Date fixed to
2026-11-17T03:30:00Z. This is owner/coordinator-supplied corroboration, not a new
execution by this continuation. The separate fixture-only repair stays outside
this branch. The actual local full result remains2103 passed/10 failed/262 skipped;
no red result is concealed and no failed workflow will be automatically rerun.
Prior frozen-install/generation/build/typecheck/lint and85 focused passes remain
applicable to unchanged product/test bytes. This status-only delta receives diff
and exact-scope checks; no redundant functional test run is claimed.

At this publication snapshot, CI discovery has not yet returned an associated run;
final-head hosted workflow/run/attempt/job evidence is PENDING/UNKNOWN, not a pass.
The task completion/PR handoff will record the actual final head and observed runs
without another status commit solely to embed its own SHA. Independent review,
existing-database rollout and later movement/persistence/UI stages remain separate.

## Issue #101 — Stage B integration (owner-started November17)

In progress on issue/101-combat-turn-integration, base
`cefad2e50b175a957cbc168a432e19815ce1a3dc`. Clean checkout/remote main and PR99 merge
verified; old issue97 branch preserved, repaired Stage A source taken from main.
No competing claim/PR. Frozen specification and contract: COMBAT_TURN.md; body-plus-
newline digest `33368d0c5c0b7ac8d2bc048e677dd93ae67f748e99671167838785c1a570064a`.
Active owner launch explicitly covers Stage B, offline additive SQL, DB-free checks,
one PR/publication, unchanged hosted disposable PostgreSQL CI and self/coordinator
review and merge after required checks. Independent review waived; never label
self-review independent. No existing DB/provisioning/migration execution, deployment,
paid API sessions, extra agents/tasks, dependencies/security/workflow changes.
Provisional chronology, gathering/placement, explicit FFA versus explicit alliance
configuration, roster stats and privacy boundary are frozen before source edits in
COMBAT_TURN.md. New task corrections0/5; Stage A3/5 and post-review repair1/2 remain
separate historical records. Authority ends on task completion/transfer/revocation;
no broader subsequent-step permission is inferred. Actual checks/evidence follow.

Stage B initial frozen install and Prisma generation exit0. Initial workspace
build failed at Formations.tsx: the new own-survivor DTO has a readonly units array,
while the existing map callback expects a mutable array type. Pass1/5 begins:
adapt that private render boundary without weakening the new DTO, then verify
source/test types and the new chronology/persistence fixtures. Initial SQL-authoring
helper also had a Python quoting typo before emitting any migration; correct that
scratch generator in this same bounded pass. No SQL has been executed locally.

Pass1 verification: frontend/build boundary corrected, but database TypeScript
found an unreachable repeated combat-kind comparison in frozen-input selection.
New engine scenarios:12 passed/4 failed;3 failures compared canonical survivor
ordering with initial per-owner ordering, and one exposed a real survivor-membership
permutation leak. Pass2/5 begins: canonicalize initial/final membership, remove the
unreachable comparison, and isolate the new aftermath transport at its own endpoint
so historical resolution types/semantics remain unchanged. Continue the initial
new storage/HTTP/SQL/UI fixtures in this bounded integration pass; no old tests are
removed or weakened. Source/engine failures and results are retained above.

Pass2 full build exit0. Focused engine/storage/static migration run:28 passed,
9 failed. Eight contact/storage cases failed because the historical strict movement
eligibility helper correctly rejects new HP/stat fields; diagnostic direct restore
identified the boundary (not a DB error). One40-player scenario exceeded Vitest's
5000ms default: relationship equivalence validation repeatedly scanned the complete
matrix inside the cubic triple check. Pass3/5 begins: project only legacy member
fields when the explicitly versioned new cohort reuses that helper, and index
relationships for constant-time lookup without changing mechanics or raising
existing timeouts. Canonical membership fixes from pass2 remain. The new SQL's
explicit FFA matrix check receives an equivalent direct canonical comparison to
avoid repeated JSON scans. No old helper/schema is widened. Add remaining initial
integration/HTTP/UI fixtures; full verification follows. No local SQL execution.

Pass3 build exit0; focused5 files48/48 passed, including durable replay, six-stage
transaction rollback injection, strict migration admission preservation, authenticated
own-only HTTP and reconnect/UI cleanup. Full TypeScript then found two unused test
imports (one reported before pnpm stopped the dependent graph). Pass4/5 begins:
remove these imports; author self-review also found that a losing participant's
non-own capture recipient must be labelled opponent, not ally, and that PostgreSQL
NULL comparisons need explicit missing-HP/coordinate/type rejection. Correct these
within the approved mechanics, add hostile-recipient and forged-bundle regressions,
make destroyed/leaderless own-unit inspection accurate, and exclude pending allied
relocations from occupied placement candidates. This is author review, not independent
review. The remaining pass allowance is retained for diagnosed verification failures.

Pass4 build/lint exit0; full tests2167 passed/5 failed/283 skipped. Four
historical WorldView assertions exposed an unstable formation prop (extra reads
and lost map-pick state); the prototype entry-point guard caught an unintended
combat export. Typecheck exit1 identified private fixture imports across package
boundaries and a public repository result mistaken for an internal stored row.
Pass5/5 begins: memoize the formation adapter, use a separate server-only engine
entry point (package export only; no dependencies/lockfile changes), use public
HTTP DTO fixtures and internal DB-row loading in their owning packages, and
remove PL/pgSQL variable/SQL-alias ambiguity found during author review. Preserve
all historical assertions and record final full verification. No local SQL runs.

Pass5 results: frozen install and db:generate exit0 (initial task setup); final
build/typecheck/lint each exit0. Focused7 files140/140 passed. Full database-free
suite:93 files passed,17 deliberately skipped;2172 tests passed,283 deliberately
skipped,0 failures (2455 total). AUTH_ENABLED=false and RUN_DATABASE_TESTS=0
throughout local verification. Staged git diff --check exit0, including new files.
35 files implement the new cohort; no historical combat/prototype source or tests,
workflow/security instructions, dependencies or lockfile changed. The engine package
adds only a separate server export. Author self-review covered complete staged
scope, raw-audit transport exclusion, deterministic replay, placement failure and
atomic rollback. This is not independent review. All5/5 implementation correction
passes are used; Stage A's3/5 and1/2 histories remain separate. Any unresolved
implementation failure after hosted CI requires escalation, not another hidden pass
or automatic workflow retry.

Publication checkpoint: verified origin/main remains cefad2e50b175a957cbc168a432e19815ce1a3dc;
only this task's claim is present, no competing #101 PR. Active TASK_SCOPE owner
authorization in this launch covers this exact task's eventual feature head, draft
PR and unchanged hosted fresh disposable PostgreSQL CI, plus merge after required
checks. Additive migration202611170001_combat_turn is offline-authored only: no
local SQL/database access occurred. Hosted migration application, real transaction
rollback/concurrency/restart and signed-session SQL HTTP tests remain PENDING.
SQL structural guards complement strict application semantic replay; shaped hashes
are not proof. No Stage C, Turn2, capacity certification or deployment is claimed.
Current state: feature implementation committed for draft publication; unmerged.

Publication observed: [draft PR102](https://github.com/MightyMulligan-ops/strategy-game/pull/102),
base main cefad2e50b175a957cbc168a432e19815ce1a3dc, first published implementation
4cda67eb415196e7170bd4cc2f082fca23ce301e. In review/unmerged; this appended
status-only commit records the real handoff URL. Exact final-head hosted CI and
any observed merge evidence will be retained in PR102's conversation. No failed
workflow is rerun; final-source publication is not a reset of5/5 passes.

## Issue #103 — owner-started Stage C (November17)

Stage B PR102 is observed merged as249b6e4aa0d5a14ec7fd54ba95c118fc692f8b73;
#101 completed. CI44162233401 passed2172 application and283 SQL tests, zero SQL
skips, including new migration and successful disposable cleanup. Its earlier
publication snapshots above remain historical. Stage B5/5 and Stage A3/5 plus
post-review1/2 remain intact. This UI/acceptance task starts0/5, not a Stage B repair.

Clean checkout, current main, no competing103 claim/PR; existing97/101 branches
preserved. Branch issue/103-combat-aftermath from verified main above. Issue103
body-plus-newline SHA256 eb1b867ecc6e967e910d5af6beb44bbbda7deb6c51607093fc5edbba515312b1.
The explicit owner launch grants bounded implementation/tests, TASK_SCOPE feature
publication/draft PR, unchanged hosted fresh disposable PostgreSQL CI, author/
coordinator review and merge after required checks; independent review waived.
Authority lasts this task unless revoked/transferred; no future-task standing grant.
No additional agents, paid API tasks, existing DB access/startup/provisioning/
migration execution, dependencies/security/workflow changes or deployment.

Eight-path gap scope and acceptance map frozen before edits in COMBAT_TURN.md.
Combined losses versus individual survivor membership/final positions are an
explicit existing transport limit; no new fields or enemy inference. Reuse shipped
recovery/privacy/SQL evidence; add only UI/state/stale-response acceptance gaps.
Currently in progress/unmerged; checks and new-task correction history follow.

Initial frozen install and db:generate exit0. Initial focused acceptance:130/130
passed across5 files. Completing the initial acceptance set with immediate
render-boundary privacy (before the next match fetch starts) yields131/131 passed;
an additional stored wounded-survivor fixture distinguishes5/7 from7/7 HP, with
its verification pending the full run. These are
synthetic UI fixtures, not played city assaults. No corrective source edits or
failed checks so far:0/5, not exercised. Build passed; full checks still running.

Stage C verification: frozen install and db:generate exit0; full pnpm build,
typecheck, lint and test each exit0. Full suite2201 passed,283 deliberate DB skips,
0 failed (93 passed files/17 skipped). Focused5 files131 passed; final aftermath
suite29/29 includes wounded-survivor5/7 HP and immediate render-boundary privacy.
Final web build/typecheck and lint rechecked after completing initial copy/fixtures;
all exit0. Staged diff check includes the new component. Implementation corrections
0/5, not exercised; no failed assertions removed, no recovery tests reimplemented.
Author self-review, not independent review: complete eight-path scope, strict
transport unchanged, native disclosure/Escape/focus handling, no opponent-derived
inference, archived ownership, and aborted-response suppression reviewed.

Publication gate: owner launch explicitly covers this #103 TASK_SCOPE feature
head/publication and unchanged hosted fresh disposable PostgreSQL CI, as well as
merge after required checks; no additional approval is needed for covered steps.
Current main remains249b6e4aa0d5a14ec7fd54ba95c118fc692f8b73; no competing claim/PR.
Hosted CI for this task is pending, not inherited from Stage B. The A/B/C evidence
map is in COMBAT_TURN.md; #89 remains open until observed Stage C completion.
Eight changed paths only; no transport, SQL, gameplay, dependency, security or
workflow changes. Human browser/gameplay playtesting, Turn2, Europe map and
existing-environment rollout/deployment remain separate. Feature remains unmerged.

Publication observed: [draft PR104](https://github.com/MightyMulligan-ops/strategy-game/pull/104),
base249b6e4aa0d5a14ec7fd54ba95c118fc692f8b73, implementation
43e475aae3eaf99254d1ab5945dbaf5574d71120. In review/unmerged at this checkpoint.
This status-only commit records the real URL; exact final-head CI/observed merge
and parent89 acceptance disposition follow in the PR conversation/handoff, without
self-referential SHA commits or retrying failed workflows. Stage C history0/5 intact.
