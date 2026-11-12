# Persistent initial world and first map (005B.2 / Issue #22)

Child [#22](https://github.com/MightyMulligan-ops/strategy-game/issues/22) implements the owner-approved second phase of parent #19. It uses the unchanged `territory-grid-v1` generator and contracts from merged PR #21 (`e3e4a22`). Server-selected `regionSide: 5` yields 50 territories for two players and 1,050 for forty. [Generation rules and limits](WORLD_GENERATION.md) remain authoritative.

## Storage and atomic start

006B.2 / Issue #39 extends the start below for newly created, initialization-pinned lobbies: the same transaction now also stores snapshot v2, OPEN Turn 1/deadline and revision-zero unready player/history rows. Existing all-null OPEN configurations retain the original world-only path, and existing RUNNING matches are never initialized. Archive/public-map contracts and starting armies are unchanged. See [TURN_SYSTEM.md](TURN_SYSTEM.md#atomic-initial-world-turn-1-persistence-006b2--issue-39) for profile dispatch, unsupported mutations, one additive guard migration and CI-only verification. Statements below about untouched turn initialization describe the original 005B.2 boundary, superseded only for this new cohort.

One immutable `MatchWorld` row per match stores `schemaVersion`, `generatorVersion`, uint32 `seed` as BIGINT, and the complete validated initial-world JSONB payload. It retains territories, links, terrain and separate starting ownership, capitals/cities, zero-stockpile Military Supplies nodes and positions. Armies remain empty. JSONB is an initial archive, not mutable gameplay state. Per-entity references are validated by the approved Zod contract on write/read; SQL enforces match association, uniqueness, metadata and lifecycle integrity. Later mutable gameplay will need separately approved state models.

The existing lobby transaction acquires `SELECT Match ... FOR UPDATE`, then checks the authenticated host, OPEN status, at least two active players and unanimous readiness. It generates an explicit cryptographic uint32 seed, calls the approved pure generator using match-local player IDs, validates the output, inserts the archive and conditionally changes OPEN→RUNNING. Membership/readiness writers already take the same parent lock. Generation is bounded and stays inside the transaction; no remote call occurs there. Responses follow commit.

Concurrent successful starts yield exactly one STARTED and subsequent ALREADY_STARTED acknowledgements. Once RUNNING, host retries never generate, replace, repair or backfill a world. An unsuccessful attempt can compute a world before rollback; exactly one **committed archive**, not exactly one attempted computation across failures, is guaranteed. A later explicit retry may choose a new seed after a rollback. No partial world is returned. Generation/insertion/commit errors leave OPEN and preserve readiness/configuration. Current turn duration, state version, runtime pins, simulation snapshots, turns and deadlines are untouched.

## Reviewed additive SQL and rollback

`database/prisma/migrations/202611110003_initial_world/migration.sql` was generated from local before/after schemas and extended/reviewed offline. It runs transactionally and adds:

- MatchWorld table with match-ID primary key and foreign key; parent deletion cascades, but no delete endpoint is added.
- BIGINT seed range 0–4,294,967,295, version/JSONB metadata equality and a 2 MiB JSON text bound.
- Parent-row lock before world insertion and rejection of independent archive updates/deletes. Parent cascade deletion remains possible for exact owned CI fixtures.
- Deferred guards: every future OPEN→RUNNING transition must commit with a world, and an inserted world must commit with a RUNNING match. They evaluate final transaction state rather than requiring an unsafe write order.

No old rows are backfilled, no existing migration/column/check/trigger is replaced, and no Turn or GameSnapshot model changes. Previously RUNNING rows may remain without worlds; direct historical/internal RUNNING fixture creation is still allowed. The new guard specifically covers future transitions from OPEN. Existing metadata/configuration/history guards remain in force.

**Database safety:** no existing development/test/sandbox database (including port 5435) may be connected to, inspected or modified during this task. SQL application and DB integration tests occur only in newly provisioned disposable CI PostgreSQL 17. Sandbox migration needs separate explicit approval. No local server/preflight or DB command is used. Never reset, truncate or sweep existing data to make these tests pass.

Rollback must retain archives and migration history. Older application versions attempting OPEN→RUNNING without inserting a world will fail the new guard; a code-only downgrade does not restore old start behavior. Prefer a reviewed forward fix. Removing guards or dropping stored worlds requires a separate owner plan; no automatic down migration is supplied.

## Participant-only world API

`GET /api/matches/:matchId/world` accepts only a path match ID and optional exact `schemaVersion=1`. Unknown/repeated query fields and unsupported versions are rejected. The acting identity comes exclusively from the normal persisted signed session. Auth must be enabled and the account must have a registered username. Repository authorization checks **active membership in this exact match before retrieving the authoritative archive**, using a consistent repeatable-read transaction. Missing matches and outsiders/inactive members receive the same safe 404. Lobby discovery/roster visibility never grants world access.

| HTTP / body | Meaning |
|---|---|
| 200 `{schemaVersion:1, matchId, state:"NOT_STARTED"}` | Authorized member of an OPEN lobby; no world created |
| 200 `{schemaVersion:1, matchId, state:"UNINITIALIZED"}` | Authorized member of RUNNING match without an archive; no world created |
| 200 `{schemaVersion:1, matchId, state:"READY", world}` | Explicit public projection from the persisted archive |
| 400 / INVALID_REQUEST | Invalid path/query/version |
| 401 / UNAUTHENTICATED | Missing/expired/revoked session or identity |
| 403 / USERNAME_REQUIRED | Username onboarding incomplete |
| 404 / NOT_FOUND | No matching active membership or missing match |
| 429 / RATE_LIMITED | Existing per-IP limiter |
| 500 / INTERNAL_ERROR | Missing schema, invalid storage or unexpected failure; no raw details |

Errors retain the versioned lobby error envelope. Responses use no-store, no-referrer and nosniff headers. Read-only GET needs no CSRF/Origin token; the existing host-start POST still requires both. Google/Discord, session rotation/revocation, local fixture gates and rate limiting are unchanged. No public world mutation or legacy initializer exists.

Reads never initialize, repair or regenerate worlds, including unsupported/corrupt stored versions. Legacy host start retries remain ALREADY_STARTED while world GET remains UNINITIALIZED. Legacy RUNNING matches remain unchanged: no automatic or host-triggered initialization is authorized in 005B.3.

## Public projection and visibility

The owner approved **INITIAL_SHARED** visibility: all active participants may see the full initial territory layout, terrain, adjacency, ownership, capital/city markers and initial supply fixtures. This is not a fog-of-war implementation. `PublicWorldSchema`/`ReadWorldResponseSchema` are separate public contracts, constructed by an explicit allowlist mapper. They expose bounds/grid, public player IDs/usernames, territory geometry/terrain/owner/capital/city/resource summaries and links. They never expose seed, raw payload, generation settings, internal identities, auth/session data, units or the authoritative startingState object. A 2 MiB application bound also covers projected data.

The browser imports only public contracts. Shared geometry/terrain primitives live in a public-safe module; the authoritative GeneratedWorld contract and seed schemas remain in the server entry point. Future gameplay/intelligence data must not be added by spreading the archive or widening this DTO implicitly. A private LCG seed alone is not a security boundary; future visibility needs explicit new projections/policy before hidden information is introduced.

## First SVG map and verification

Active RUNNING members see View map from lobby details. `#world=<encoded matchId>` preserves map selection across page reload and browser navigation; it grants no access. The existing registered-account gate remains ahead of map loading. Back to lobbies and Refresh world are explicit, cancellable reads with safe loading/error/uninitialized states. No polling or mutation retry is added.

005B.3A / Issue #24 gives UNINITIALIZED its own accessible status panel, headed **Map unavailable for this match**. It explains that the match started before world-map support and has no saved map to display, and that refreshing will not create one. The panel uses polite, atomic announcements and retains Back to lobbies and read-only Refresh world. There is no generation, migration or backfill action. NOT_STARTED keeps its separate not-started status; access/network failures remain errors, and READY continues to show the map/inspector. Focused frontend tests cover those distinctions, explicit refresh and removal of stale READY geometry. The GET contract and existing records are unchanged.

The responsive SVG shows terrain fills/patterns, ownership borders, capital stars and a player legend. The inspector supplies text terrain/owner/city/resource/position/adjacency data. Adjacency describes geography, not movement permission. No armies, economy, gameplay actions, turn initialization or deadline runs.

### Map accessibility (005B.3B / Issue #26)

- Exactly one territory is in the Tab sequence. Click/tap focuses and selects a territory; focus selects it too. All four arrow keys select/focus the grid neighbor, with no wrapping or change at an outer boundary. Enter/Space retain selection. Tab and Shift+Tab use normal browser navigation to leave the map; unrelated keys are not intercepted.
- The map group references visible keyboard instructions. Each territory button describes its ID, one-based row/column, terrain, owner identifier/name and capital status, with `aria-pressed` for selection. A separate polite, atomic status announces only `Selected <territory ID>.` The detailed inspector is not a live region, avoiding repeated resource/adjacency narration.
- Inspect selected territory focuses the inspector heading, outside the Tab sequence. Read its details normally; Return to selected territory restores map focus and scrolls it into view. These buttons never change the world URL/hash or make requests. Keyboard selection does not automatically move focus to the inspector.
- A thick solid gold border marks selection; an inset dashed light outline marks keyboard focus. Selection persists when focus leaves. Forced-colors mode uses system Canvas/CanvasText/Highlight colors for patterns, borders, labels and outlines; it does not rely on player colors.
- Dots identify plains, diagonal lines forest and peaks hills. Stable `P1`…`P40` identifiers follow the public player-list order and appear on owned cells, in the legend and inspector. Capital stars remain; unmarked cells are neutral. Full textual descriptions remain available even when colors/patterns cannot be perceived.
- The map scrolls inside a viewport bounded to 65vh, with responsive stacking of the inspector below 900px. The SVG retains its original aspect ratio and a minimum scale giving the narrowest public cell a 48px edge. Dense maps scroll in both axes rather than shrinking every territory. Focus scrolls with nearest alignment, without animation; browser Tab navigation remains available to escape the viewport.

Focused frontend regression coverage includes all directions/boundaries, one Tab stop, Enter/Space, unconsumed Tab/Shift+Tab, pointer/focus synchronization, concise status semantics, inspector focus/return without hash changes, patterns/ownership identifiers, dense-map minimum scale and all existing world-state/error cases. Native Tab navigation, actual visibility/overflow and forced colors require browser checks rather than jsdom layout assertions.

Local verification for Issue #26 passed frozen install, build, TypeScript, lint, **26 focused / 515 workspace unit tests**. The **73 DB assertions were intentionally skipped** with `RUN_DATABASE_TESTS=0`; no local server/preflight, migration or database command was run. A static in-memory HTTP mock supplied hand-authored participant-visible DTOs to Chromium through Vite (no generator, application backend or database). At **320/390/768/1440px**, both 50- and 1,050-territory fixtures passed keyboard boundaries/escape, inspector focus/return, nearest scrolling and page-overflow checks. Forced-colors emulation, GET-only state/error/reload checks and inspected mobile screenshots also passed, with zero page errors. The temporary harness/screenshots remain ignored under `.cache/issue-26/`, reusing existing local Playwright tooling without adding dependencies. These checks do not verify real screen-reader speech or production performance.

### Manual NVDA / Edge acceptance (not yet performed)

Use a separately approved static/mock READY public-world fixture in Edge, with NVDA Speech Viewer open; use both 50 and 1,050 territories. Do not launch the real backend or access an existing database to perform this task. The local ignored Chromium harness is verification tooling, not a committed fixture runner; provide equivalent mocked public DTOs when repeating on another PC. Record Edge/NVDA versions, fixture size, Windows contrast theme and any repeated/missing speech.

1. Tab through Back to lobbies, Refresh world and Inspect selected territory into the map. Confirm one territory Tab stop and that its description includes ID, row/column, terrain, owner and capital where applicable. Read the map instructions. If NVDA browse mode consumes arrows, switch to focus mode with NVDA+Space for map navigation; do not introduce an application-wide keyboard mode.
2. Use each arrow, including top/left/bottom/right boundaries. Confirm selection follows focus, never wraps, remains visible and announces a concise selection summary. The detailed inspector must not narrate its complete contents on each arrow. Enter/Space must not scroll the page or change the selected cell.
3. From a territory, Tab to Return to selected territory and Shift+Tab back. Shift+Tab from the territory reaches Inspect selected territory. Neither direction is trapped in the map. Selection remains visibly solid; the dashed focus outline follows keyboard focus only.
4. Activate Inspect selected territory. Confirm focus moves to the inspector heading; use normal NVDA reading commands to read the separate detail list. Tab to Return to selected territory and activate it; confirm focus/visibility returns to the same cell and the `#world=...` hash is unchanged.
5. At 320/390/768/1440px (and 200% browser zoom), confirm readable owner IDs/terrain patterns, local map scrolling without page horizontal overflow, usable inspector controls and visible focus at far corners. Enable a Windows contrast theme in Edge and repeat selection, focus/return and escape checks. Confirm system-color patterns/text and the distinct solid/dashed indicators survive.
6. With mocked NOT_STARTED, UNINITIALIZED, access-denied and network-failure responses, confirm their existing distinct status/error messages, absent map/inspector and explicit refresh recovery. Legacy UNINITIALIZED must never offer initialization.

NVDA/Edge speech behavior, Windows contrast themes and the 200% zoom pass remain owner/manual acceptance checks; Chromium emulation is not a claim that they have been completed.

Local tests explicitly set RUN_DATABASE_TESTS=0. Coverage includes strict projection/private-field rejection, HTTP session/onboarding/query/error boundaries and UI controls/keyboard/loading/late-response handling. The real Chromium smoke uses the approved generator/projection with a newly created in-memory HTTP fixture through Vite: independent host/member browser contexts see identical polygons after start, refresh and hash reload; an outsider sees no map. Desktop/mobile screenshots were inspected, with no page errors or horizontal overflow at 320/390/768/1440px. This is mock-backed client verification, not a live sandbox test.

CI-only PostgreSQL tests verify deterministic persistence for 2/4/10/40 players and upper uint32 seeds, cross-client start idempotency/reload, unchanged configuration/turn state, real insertion/post-insert rollback, deferred lifecycle constraints, immutable/unique archives, legacy worldless reads/retries, active membership and real HTTP projection. Existing start-vs-ready/join/leave race tests remain and now exercise world initialization. Cleanup deletes exact IDs created by each test, never pre-existing fixtures. The shared CI report guard requires all discovered integration files/assertions to execute without skips.

Required offline checks: frozen install, build, TypeScript, unit tests, lint, schema validation and diff review. No new dependencies or workflow permissions are introduced. Functional tests do not claim production capacity at forty players; the initial layout's local balance limits remain those of 005B.1.

## Acceptance sequence (CI or separately approved owner environment only)

Do not run this against an existing local database during this task. After separate owner-approved environment preparation, use independent browser profiles with Player One/Two: create a new two-player lobby, join, ready both and host-start once. Open View map in each, compare capitals/terrain/territories, select the inspector and reload both map URLs. Check outsider denial, unchanged duration and no turn advancement. Verify a legacy RUNNING fixture shows UNINITIALIZED even after reads/host start retry; do not press an initialization/backfill button (none exists). CI performs equivalent persistence/authorization checks in its disposable service. Real Google/Discord consent and manual sandbox verification remain separate owner actions.
