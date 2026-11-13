# Development status

This is a short, evidence-based handoff, not a replacement for the rules or roadmap. Issue #51 baseline: latest `origin/main` at `cb088ec5e8f2c103f026760b19de7023152a7cfa`, including merged PR #50. Feature work remains unmerged even when its tests pass.

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
| Movement drafts (006D.2 / Issue #51) | Prepared locally / unmerged | Dedicated local branch; Gates B/C only. No database access, migration execution, hosted CI or publication; current evidence follows below |
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
