# Development status

This is a short, evidence-based handoff, not a replacement for the rules or roadmap. Issue #49 baseline: latest `origin/main` at `ed1b7cb1b9a08636723bb8691c2a0d6a2c486e54`, including merged PR #48. Feature work remains unmerged even when its tests pass.

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
| Authoritative starting armies (006D.1 / Issue #49) | Implementation prepared / unmerged | One local issue branch; strict v3 snapshot, creation-pinned runtime, own-only formation map and additive SQL authoring. No executable gameplay or database/CI execution; see handoff below |
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
