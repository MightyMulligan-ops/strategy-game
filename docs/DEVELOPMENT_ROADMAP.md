# Development Roadmap

**Status:** Foundation in progress. Turn contracts and lifecycle now precede complex gameplay because simultaneous submission, hybrid closure, and durable orders are foundational dependencies.

## Guiding approach

Build vertical slices, not isolated piles of features. A vertical slice should connect player interaction, server command handling, game rules, persistence where needed, and tests.

The first playable prototype should demonstrate the strategy-game loop and include the two distinctive systems—leadership-dependent movement and basic Military Supplies. Do not spend months building an abstract engine without a playable result.

## Phase 0 — Foundation and rules audit

**Goal:** Make the repository safe and understandable for ongoing development.

- [x] Initialize pnpm workspace and TypeScript conventions.
- [x] Add frontend linting, workspace type-checking/builds, and runnable Vitest tests.
- [x] Add GitHub Actions application and PostgreSQL integration checks; document required checks for `main` (Assignment 006 / Issue #1).
- [ ] Establish a workspace-wide formatting/lint policy beyond the existing frontend checks.
- [x] Create initial web and server applications.
- [x] Automate local dependency preparation and development preflight; document Windows and two-PC setup (Assignment 005).
- [x] Establish shared turn/order contracts and server-only lifecycle package boundaries.
- [x] Add database environment configuration and `.env.example` (Assignment 004A).
- [x] Add PostgreSQL/Prisma schema, initial migration, and repository foundation (Assignment 004A; follow-up live database suite passed).
- [ ] Complete an atWar reference audit for mechanics that will be reproduced.
- [ ] Record open decisions rather than inventing formulas.
- [x] Establish GitHub Issues/PR workflow and branch conventions (Assignment 007 / PR #5, merged as `963869a`).

Assignment 007 / Issue #2 is merged: issue templates, status labels, a human-started local VS Code Codex workflow, and metadata-only synchronization. No unattended agent execution is planned. Ongoing delivery state is tracked in `DEVELOPMENT_STATUS.md`.

**Exit criteria:** A clean install, type-check, and test command work; web and server can start locally; core design docs are discoverable.

## Phase 0A — Turn contracts and lifecycle (Assignment 002)

**Goal:** Define and test simultaneous submission before implementing gameplay outcomes.

- [x] Record hybrid deadline/unanimous-Ready closure and fixed-per-match duration.
- [x] Add strict, versioned runtime contracts with distinct move and attack orders.
- [x] Test Ready/unready, order replacement/cancellation, Ready clearing after edits, and stale revisions.
- [x] Test `open -> closed -> resolving -> resolved`, exact-deadline rejection, and immutable snapshots.
- [x] Keep private drafts in the server-only engine and document unsupported edge cases.

**Exit criteria:** Contracts and lifecycle checks pass. This is a tested in-memory foundation, not a playable turn resolver, durable submission API, or offline scheduler.

## Phase 0A.1 — Empty resolution and movement-queue contracts (Assignment 003)

**Goal:** Advance a frozen empty turn reproducibly without implementing gameplay.

- [x] Add server-only snapshot, frozen input, result, rejection, and domain-event schemas with pinned version metadata.
- [x] Resolve empty turns using deterministic operational phases and stable audit IDs; reject all nonempty gameplay orders.
- [x] Derive player-relative movement numbers from existing ordered drafts and preserve stable order IDs.
- [x] Test reproducible, replaceable equal-number seeded precedence independently of execution.
- [x] Document future dotted paths/cancellation controls, Movement Queue panel, and recruitment-to-movement dependencies.
- [x] Test replay, immutable inputs/outputs, version mismatches, and malformed frozen inputs.

**Exit criteria:** Empty-turn resolution and queue-planning tests pass. Movement, attacks, dependencies, and passive systems do not execute. Phase precedence beyond move-number priority remains open.

## Phase 0B — Durable orders and turn execution foundations

**Goal:** Make the approved asynchronous model reliable before complex movement/combat work.

- [x] Add PostgreSQL/Prisma match, participant, turn, Ready, order/revision, frozen input, snapshot, and result persistence foundation (Assignment 004A).
- [x] Add partial queue uniqueness, immutable settings, atomic closure checks, and seed/result recovery primitives in migration/repository code.
- [x] Add database mapping unit tests and opt-in PostgreSQL persistence tests with a safe local development setup.
- [x] Verify the owner-applied initial test migration and pass the live PostgreSQL suite (11 tests on PostgreSQL 17.11; no schema changes).
- [ ] Add authenticated/authorized command handling and own-player draft responses.
- [ ] Expose acknowledgements only after the repository commit and define request-level idempotent retries in authenticated APIs.
- [x] Implement atomic closure/frozen inputs and idempotent empty-turn result commits in the repository (live integration suite passed).
- [ ] Add deadline scheduling and restart recovery that progress games while everyone is offline.
- [ ] Approve gameplay phase order and remaining simultaneous-order conflict rules before extending the tested empty-turn resolver.
- [ ] Exercise two-player submissions, deadline races, early Ready closure, and crash recovery.

**Exit criteria:** Durable orders and hybrid closure survive retries/restarts without client-trusted outcomes. No production capacity claim yet.

Assignment 004A supplies schema and internal storage operations, not production authentication, command APIs, scheduling, or WebSockets. Current draft contracts are unchanged. Future prerequisite storage does not decide dependency cancellation or recruitment execution. The live storage suite now passes, including scoped cleanup without weakening foreign keys; full scheduler/crash orchestration and the other unchecked work remain required before this phase is complete.

## Phase 0B.1 — Account foundation (Assignment 004B.1)

- [x] Add stable provider-independent identities, explicit Discord/Google linking, and unique initial usernames.
- [x] Add authorization-code flows with state, PKCE, Google nonce/signature checks, and minimal scopes.
- [x] Persist server-managed sessions with secure cookies, absolute expiration, logout/global invalidation, CSRF, and rate limits.
- [x] Add account-only endpoints and a minimal login/profile page; keep gameplay APIs out of scope.
- [x] Add mocked HTTP/provider tests and live PostgreSQL account/session tests.
- [ ] Verify real provider consent/callbacks with owner-supplied client credentials and production HTTPS/proxy settings.
- [ ] Decide account recovery, unlinking, renaming, session/attempt retention, and any fresh-sign-in requirement before linking.

Account authentication is implemented independently of match authorization. Phase 0B's authenticated commands, membership checks, order acknowledgements, and scheduler remain incomplete. See [AUTHENTICATION.md](AUTHENTICATION.md) for setup and the precise implemented boundary.

## Phase 0B.2A — Multiplayer lobby contracts (Issue #7)

**Scope:** Approved public lobby rules and strict versioned contracts only. Merged in PR #8 as `b0164b7`; internal persistence follows below.

- [x] Add MATCH_LOBBIES.md, public request/response schemas, and at least 40 focused contract tests.
- [x] Validate 2–40 capacity, host/roster consistency, registered-user viewer permissions, safe public projections, and Quick/Casual timing categories.
- [x] Document immutable settings, OPEN-only admission, idempotent joins, host-only start with at least two participants, and fixed membership after start.
- [x] Preserve existing authentication, turn resolution, persistence, and runtime behavior.

**Exit criteria:** Contract checks and docs pass review/CI and are merged. No working lobby API/UI or database changes are implied. Follow-up implementation must add session-bound membership authorization, atomic persistence, and command handling before real creation/join/start is exposed. Private/invite-only access, spectators, late joining, host transfer/cancellation, teams, victory/duration, and starting-country/resource rules remain future decisions.

## Phase 0B.2B — PostgreSQL lobby persistence (Issue #9)

**Scope:** Internal create/join/leave/detail/list storage only. Merged in PR #10 as `df975a2`; application of its migration to the existing development database remains unapproved.

- [x] Extend existing models with OPEN/RUNNING, nullable legacy host/metadata, immutable lobby settings, and unique account membership.
- [x] Review one additive SQL migration, preflight duplicate legacy memberships, and verify preservation on isolated PostgreSQL 17 databases.
- [x] Serialize membership/capacity/lifecycle checks on the parent Match row, support leave/rejoin, and expose only safe public projections.
- [x] Pass lobby integration tests and all existing checks, preserving account and deterministic turn behavior.

**Exit criteria:** Reviewed PR merged, with no existing records deleted or invented historical settings. No endpoints, UI, world, or Turn 1 initialization were included. All RUNNING joins, including duplicate retries, fail per owner clarification. APIs follow below; start/runtime-pin/world orchestration remains later work.

## Phase 0B.2C — Authenticated lobby REST APIs (Issue #11)

**Scope:** Five HTTP operations using existing PostgreSQL storage, persistent sessions, registered usernames and CSRF/origin enforcement. Merged in PR #12 as `5cbd901`; its implementation did not migrate existing databases.

- [x] Expose create/list/view/join/leave with session-derived identity, strict public contracts and safe HTTP error mapping.
- [x] Retain repository transactions for capacity, idempotent OPEN joining, leave/rejoin and host/RUNNING rejection.
- [x] Pass auth/CSRF/forged-input/privacy/disabled-auth HTTP tests and actual session/PostgreSQL concurrency/recovery tests.
- [x] Document API paths, migration prerequisites and shared live-suite discovery/CI report validation.

**Exit criteria:** Reviewed PR merged with all checks passing, no migration to the existing development database, and no new schema, frontend, start, world or scheduler work. See [LOBBY_API.md](LOBBY_API.md). Next slice: approved frontend/same-origin proxy integration or match-start design; no empty-world public shortcut.

## Phase 0B.2D — Sovereign lobby/account UI (Issue #13)

**Scope:** Branded login/onboarding/profile and public lobby browser using the five existing APIs, with same-origin Vite proxy and original asset relocation. Merged in PR #14 as `9a45f27`; no existing database access was included.

- [x] Browse/refresh/inspect/create/join/leave using strict public schemas, current CSRF and authoritative server recovery.
- [x] Preserve provider availability, username validation, linking/logout and callback/session behavior across Sovereign screens.
- [x] Move all original branding files unchanged to `apps/web/public/assets/branding/`; render verified emblem/wordmark with approved palette.
- [x] Pass frontend behavior tests, browser asset/layout checks and existing workspace gates; document the unapplied development migration.

**Exit criteria:** Reviewed PR merged; no backend/auth behavior/schema/migrations, existing database writes, Start action, world/Turn 1, map or deployment. Local browser verification uses mock HTTP fixtures; real-provider/live-database testing still needs separately approved preparation. See [LOBBY_UI.md](LOBBY_UI.md).

## Phase 0B.2E — Local test sign-in (Issue #15)

**Scope:** Opt-in loopback fixture sign-in and server-advertised UI, retaining sessions/CSRF and lobby authorization. Merged in PR #16 as `40c56a3`.

- [x] Fail closed outside explicit development, exact origin, loopback binding and no-proxy conditions.
- [x] Isolate two allowlisted identities from OAuth accounts; rotate normal sessions and reject fixture cookies when disabled.
- [x] Preserve normal OAuth/onboarding/link/logout/lobby behavior and pass memory/UI plus disposable-CI PostgreSQL coverage.
- [x] Document owner-only sandbox launch, inherited environment precedence and independent two-browser verification without automatic database access/preparation.

**Exit criteria:** Reviewed draft PR merged after checks/security review. Existing development/test/sandbox databases remain untouched by Codex/CI; owner manual sandbox and real OAuth verification are separate. No schema, migration, reset, gameplay, Start, merge or deployment automation. See [LOCAL_TEST_LOGIN.md](LOCAL_TEST_LOGIN.md).

## Phase 0B.2F — Lobby readiness and host start (005A / Issue #17)

**Scope:** Per-participant readiness and atomic host-only OPEN→RUNNING transition. Merged in PR #18 as `280b7fa`.

- [x] Add default-false lobby readiness without changing per-turn Ready or existing migrations.
- [x] Validate host, at least two active players and unanimous readiness under the membership lock; repeated host start returns ALREADY_STARTED.
- [x] Add strict session/Origin/CSRF-protected ready/start APIs and authoritative lobby UI, preserving authentication and membership rules.
- [x] Verify authorization, reset/rejoin/leave, races and retry behavior; preserve duration and state version without world/turn/deadline initialization.
- [x] Review offline additive SQL; test only in disposable CI; document separately approved owner-only sandbox acceptance.

**Exit criteria:** Reviewed draft PR merged after all checks. Existing databases remain untouched; sandbox SQL application is a separate owner approval. No map generation, gameplay execution, scheduler, merge or deployment is implemented. See [MATCH_LOBBIES.md](MATCH_LOBBIES.md), [LOBBY_API.md](LOBBY_API.md) and [LOCAL_TEST_LOGIN.md](LOCAL_TEST_LOGIN.md).

## Milestone 005B — Procedural world and read-only map (parent Issue #19)

The owner approved three review phases. 005B.1 merged in PR #21 as `e3e4a22`. **005B.2 / Issue #22** is approved and implemented on its feature branch; delivery stays unchecked until human merge. Parent #19 remains open.

- [x] **005B.1:** Versioned authoritative world contracts and pure deterministic generator; seeded integer geometry, adjacency/terrain, separate starting fixtures and measurable local equality; tests for 2/4/10/40 players and all supported sizes. Merged without database/API/UI/start wiring. See [WORLD_GENERATION.md](WORLD_GENERATION.md).
- [ ] **005B.2:** Immutable JSONB initial archive, guarded atomic initialization on start, participant-only allowlist API and minimal read-only SVG inspector; retry/concurrency/rollback/reload/legacy tests. In review after draft creation; see [INITIAL_WORLD.md](INITIAL_WORLD.md).
- [ ] **005B.3:** Explicit idempotent legacy initialization and remaining map/acceptance hardening. Never silently initialize existing RUNNING matches on read; separate owner authorization required.

No phase authorizes Codex to access an existing development/test/sandbox database. Any future migration must be reviewed and tested only in fresh disposable CI; manual sandbox application requires separate owner approval. World initialization does not resolve a simultaneous turn or imply gameplay execution.

## Phase 1 — Map and game shell

**Goal:** Render a navigable 2D map and establish a game session.

- [ ] Choose and document map coordinate/projection approach.
- [ ] Render original/licensed map geometry with PixiJS.
- [ ] Support pan, zoom, selection, and map layers.
- [ ] Represent countries, territories, cities, capitals, and ports.
- [ ] Add basic lobby/game configuration shell.
- [ ] Define map data format and validation.

**Exit criteria:** A player can open a local test game, inspect the map, and select a territory/city.

## Phase 2 — First core gameplay vertical slice

**Goal:** Complete a small end-to-end scenario.

- [ ] Select a country/player faction.
- [ ] Implement a small initial set of unit types and base stats.
- [ ] Recruit leaders and units from eligible nodes.
- [ ] Create stacks and split formations.
- [ ] Enforce leader ranks, one-per-rank, primary/secondary roles, and creation-time specialization selection.
- [ ] Implement leader-commanded geographic movement.
- [ ] Implement the single-infantry original-source-node movement exception.
- [ ] Integrate numbered movement queues with eligible-order execution using an explicitly pinned equal-priority policy.
- [ ] Show dotted map paths with cancellation controls and a separate Movement Queue panel.
- [ ] Approve and validate recruitment prerequisites and safe dependent-order cancellation before executing recruitment-to-movement chains.
- [ ] Implement a simple deterministic combat encounter using explicitly approved formulas.
- [ ] Add basic city income/recruitment costs.
- [ ] Persist and reload a scenario.
- [ ] Add tests for movement, leader succession, splitting, and combat modifiers.

**Exit criteria:** An internal scenario supports recruiting, organizing, moving, and fighting with illegal movement rejected by the server. It is not the first playable baseline until the basic Military Supplies work below is integrated; keep that integration in the same small scenario.

## Phase 3 — Basic Military Supplies

**Goal:** Make supply a real but manageable strategic constraint.

- [ ] Node population, generation, storage capacity, and stockpile.
- [ ] Stack supply requirement calculation.
- [ ] Departure allocation slider, defaulting to calculated requirement.
- [ ] Partial-stack movement supply allocation.
- [ ] Stack-carried inventory and consumption.
- [ ] Friendly-node replenishment.
- [ ] Adequate/oversupply/shortage states and configurable attack/defense modifiers.
- [ ] Supply overlay and clear shortage feedback.
- [ ] Split/merge rules that prevent supply-ratio exploits.
- [ ] Tests for stockpile accounting, consumption, and formation changes.

**Exit criteria:** Supply can be generated, allocated, consumed, replenished, and shown to affect attack/defense only. Together with Phase 2 and the turn foundations, this completes the first playable baseline with both core differentiators.

## Phase 4 — Core strategy systems

**Goal:** Expand the playable loop.

- [ ] Broader unit roster and recruitment constraints (including ports).
- [ ] Economy, upkeep, population, reinforcements, and capital/country rules based on audited decisions.
- [ ] Diplomacy: peace, war, alliance, teams/coalitions, and passage permissions.
- [ ] Fog of war, unit view ranges, stealth, detection, and allied visibility.
- [ ] Defense lines as geographic objects with validated crossing/attack behavior.
- [ ] Victory conditions and match lifecycle.
- [ ] Battle reports and basic playback.
- [ ] Strategies, upgrades, and auto-production as prioritized by the reference audit.

**Exit criteria:** A complete small match can be played from setup through a victory condition.

## Phase 5 — Multiplayer hardening

**Goal:** Make multiplayer reliable and fair.

- [ ] Expand the two-player scenarios established in Phase 0B to complete matches.
- [ ] Harden simultaneous resolution and approved deterministic tie-breaking across the broader gameplay systems.
- [ ] WebSocket lobby and game updates.
- [ ] Harden reconnect, idempotency, and stale-command handling beyond the foundational API.
- [ ] Expand per-player projections to the approved fog-of-war/detection rules; never expose private drafts or hidden state in earlier APIs.
- [ ] Expand abuse prevention and authorization tests introduced with command handling.
- [ ] Load tests; validate practical player capacity before claiming 40-player support.

**Exit criteria:** Multiple players can complete a match without client-trusted outcomes or information leaks.

## Phase 6 — Content, editor, and customization

- [ ] Additional eras and maps.
- [ ] Map/scenario editor.
- [ ] Custom rulesets and validated module configuration.
- [ ] Admin tools.
- [ ] Public/private/password game options and join cutoff.
- [ ] Additional game modes, rare units, advanced strategies, and quality-of-life features.

## Phase 7 — Advanced systems and scale

Potential later work:
- Strategic/operational intelligence, SIGINT, HUMINT.
- Advanced supply networks: roads, rail, sea routes, air resupply, convoys, depots, capacity, interdiction, and infrastructure damage.
- More advanced AI opponents.
- Performance optimization and larger-scale infrastructure only when measurement justifies it.

## Working cadence

For each milestone:
1. Create a focused GitHub issue with acceptance criteria.
2. Create a short-lived feature branch.
3. Ask Codex to inspect relevant docs and code before implementation.
4. Implement one coherent task.
5. Run tests/type-checks and review the diff.
6. Update docs.
7. Open a pull request and review before merging to `main`.

Avoid asking an AI coding agent to implement the entire game in one prompt.
