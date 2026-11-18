# Europe two-player integration — Issue107

## Frozen owner scope and checkpoint 1

Owner explicitly launched Issue107 in the active November18 chat, authorizing
bounded Europe/combat integration, necessary versioned contracts and additive
offline SQL, local database-free checks, one draft publication, unchanged hosted
fresh disposable PostgreSQL CI and author/coordinator review and merge after
required checks. Independent review is waived, never claimed. No existing DB,
deployment, agents/API sessions, dependency/workflow/security/instruction edits.
Authority is task-scoped, not an exact-SHA grant; revoked or expanded scope must
be reconciled before affected operations. Full issue read at updated_at
2026-11-18T13:30:35Z; no comments/competing107 PR observed at claim.

Base2890ca9dd8b60841812a47e15a33a70dfd72ec75; branch
issue/107-europe-playtest. Map source91d2474d399071759e3119fee3c7de00a6080e36
has this exact merge base. Old issue105 checkout/history remains preserved.
Read both map documents including approved follow-up/boundary repair. Reuse
selected files deliberately; no whole-branch merge or live fixture endpoint.

Checkpoint1 allowed paths frozen before source edits:
- docs/EUROPE_PLAYTEST.md; docs/DEVELOPMENT_STATUS.md
- packages/game-engine/src/{surface-navigation.ts,server.ts}
- packages/game-engine/tests/{surface-navigation.test.ts,europe-surface.test.ts}
- packages/game-engine/src/europe-assets/{surface-mask.json,surface-manifest.json,surface-review.json}
- packages/shared-types/src/europe-map.ts
- packages/shared-types/tests/europe-map.test.ts

This checkpoint imports the repaired pure server validator and unchanged mask,
and validates geographic/display/mask conversion and source anchors. No public
barrel exports, live commands, runtime admission or changed historical schemas.
The private physical mask is never imported by browser code. Later integration
paths/contracts will be frozen before affected edits after implementation inspection.

## Pending numeric decision

Map source expressly does not define authoritative distance/range. Proposed to
owner: 100 mask units = 1 game unit; 40,000 game units/world width; retain cumulative
250 movement, contact/capture20, chronology speed1. Nearest-integer order points,
existing milli precision for combat. Mercator distances vary with latitude; no
km-per-turn claim, new leaderless radius, fog or country control. Await decision
before implementing affected gameplay. The scale-independent mask projection is
already approved source behavior. Geneva remains inland water/unavailable, never
snapped. Defense lines remain uncommitted drafts, no control/manning/effects.

## Provenance and retained histories

Natural Earth public-domain physical land/lakes at
ace5fed0eaf3c6c03c951e75b439ba8fffbc218e; mask SHA256
052b866179d2566fd37b2f22301d48c5e5fcec3f97e6e4bd806dcdc78374bfe6.
Manifest retains original prototype accuracy qualification. Selecting assets does
not certify all geographic corridors. Camera5/5, surface foundation1/5,
defense5/5 and boundary repair1/2 retained; combat A3/5+repair1/2, B5/5,
C0/5, repeating1055/5 unchanged. New107 implementation corrections0/5.

## Actual state

In progress, unmerged, no PR/CI yet. No human playtest or deployment occurred.

## Approved distance and integration checkpoint freeze

Owner answered “Approve this prototype distance policy” in the active107 chat.
100 source mask units per game unit, movement250/contact-capture20/speed1,
nearest integer order coordinates and milligame persisted positions are now
approved for Europe only. No real travel speed or leaderless radius inferred.

Integration manifest before affected edits: existing loop adapters in
packages/game-engine/src/combat-loop.ts, combat-turn.ts, combat-chronology.ts,
combat-placement.ts; new europe-playtest.ts; engine/server.ts;
packages/shared-types/src/{server.ts,index.ts,loop.ts,europe-map.ts,
movement-resolution-view.ts}; new europe-loop.ts; tests for these contracts/engine;
database/src/{loop-storage.ts,loop-repository.ts,loop-view.ts,lobby-repository.ts,
turn-storage.ts,turn-read-repository.ts,formation-read-repository.ts};
database/prisma/migrations/202611180001_europe_playtest/migration.sql;
database/tests/europe*.test.ts and europe*.integration.test.ts;
apps/server/src/{index.ts,turns/loop-routes.ts}; server/tests/europe*.test.ts and
europe*.integration.test.ts; apps/web/src/{WorldView.tsx,Formations.tsx,
LoopWorkspace.tsx}; new EuropeWorkspace.tsx and its tests; selected source
apps/web/src/europe/{camera.ts,camera.test.ts,imagery.ts,imagery.test.ts,
tile-cache.ts,tile-cache.test.ts,geography.json,overview.jpg,europe.css};
new integrated EuropeMap.tsx and its tests; docs/assets/europe-imagery-register.csv;
README.md and this document/status/runbook. No Vite preview middleware, fixtures,
naval roster, active defense effects or global map ownership imported.

Provisional scenario: two participants only; fixed seed1/regionSide5 initialization
layout, local game rectangle1000x500 projected from northwest(-7E,43.5N), using
100 mask units/game unit. Existing two generated city nodes are explicitly
scenario camps, not claimed real city anchors/country ownership. All actual camp
and spawn points must validate against pinned physical land before start.
The 138 real city markers are display context; Geneva is marked unavailable.
The scenario rectangle bounds orders; the entire Europe display is not an
assertion that every city is a playable objective. Immutable original grid archive
is initialization evidence, never drawn as current countries or territory control.

Frozen full issue body SHA256: ec027aa255531a0e90ee701a754b775f70426b76d5f46f4b8cbd5bdaeca3dadf.
The initial provisional rectangle600x300 note is superseded before runtime edits
by the final1000x500/seed1/regionSide5 checkpoint above, matching strict archive
restoration. Scenario camps are at local(240,240) and(740,240), both validated land.

## Final runtime/transport contracts

| Boundary | Europe contract | Historical contract retained |
| --- | --- | --- |
| Creation | europe-playtest/1; simulation europe-playtest-v1; runtime schema2 with exact map/projection/mask/hash/distance/scenario identities | combat-loop/1 runtime1 |
| State | schema11 europe_loop_state, content-derived loop-state identity | loop_state10 |
| Frozen | schema6 europe_loop_frozen; exact current state/profile/turn/relationships/seed identity | loop_frozen5 |
| Result / commit | europe_loop_result5 / europe_loop_commit2; same atomic successor protocol | loop_result4 / loop_commit1 |
| Participant commands/current/history | schema2 with exact profile identity; existing /loop routes and intended-turn/revision controls | strict schema1 remains supported only for its cohort |
| Formation admission | gate5 europe-playtest-v1 with profile identity | combat-loop-v1 gate4 |

Game coordinates are **scenario local**, not whole-theatre coordinates. Add the
immutable mask origin(200000, projection-Y-of43.5N), multiply local game coordinates
by100, then convert the unchanged mask frame to normalized display Mercator.
Order input rounds nearest integer game unit; ties Math.round toward positive
infinity, zero normalized. Server receives integer local coordinates only; fixed
1000x500 bounds and cumulative Euclidean250 apply. Combat stores integer millis;
conversion to mask retains fractional tenths, with no coast/land snapping. Full
segments check all boundary intersections. Both exact coast contacts and inland
water reject. No mask, domain, origin or owner is accepted from the client.

The two fixed scenario camps at(240,240) and(740,240) use permanent original spawn
IDs from the immutable initialization archive. These are synthetic camp objectives,
not moved versions of the138 real display-city anchors. The mask validates both
spawns/camps before creation and on restoration. The approved unchanged Infantry
7HP/4ATK/6DEF and Lieutenant1/1/1 and explicit existing leadership table apply.
The two directional hostile relationships are explicitly frozen; no new alliance,
fog, country ownership, territory control or source-radius policy is invented.
Destroyed players retain participation and empty Ready; no respawns or old orders.

Surface checks run during command acceptance, frozen history verification and
execution. Before a complete result, rounded encounter sites and participant
connection segments must be land-safe; camp capture relocation must remain on
land; nearest eligible survivor placement checks land and its connecting segment.
A geometry failure aborts the entire resolution, retaining CLOSED/frozen state
without casualties, ownership or successor partial writes. **Limitation:** contacts
across water, unsafe rounded sites or unavailable coast-adjacent placements fail
closed; this does not implement a new water-aware contact schedule or a bridge.
Such a frozen unsupported case needs a reviewed resolution policy; repeated worker
attempts do not make it supported. The inland camp route is the accepted human
scenario, not certification of every European corridor. Navigation accuracy is
limited by the1:10,000,000 Natural Earth physical source, independently of imagery.

Only own formations/HP/provenance/orders/current camp IDs and bounded own aftermath
are projected. Other camp ownership is undisclosed. Political borders, satellite
pixels and138 city markers confer no control. Geneva remains a display marker with
an explicit unavailable warning. The immutable grid archive is never drawn as
Europe territory ownership. Existing archive APIs remain initial-shared evidence.

## Owner runbook — fresh isolated human target, not executed here

Proposed target identity: **europe107_playtest_20261118_fresh**, a separately created,
empty isolated PostgreSQL17 environment owned solely by this test. This name is a
proposal, not evidence it exists. Do not use the inherited development, test or
sovereign_lobby_sandbox URLs/volumes. Record the actual host/port/database identity,
creation time and empty/new provenance privately before preparation. Stop if its
isolation cannot be established. No target was provisioned, connected or migrated
by this task; CI services are separate and discarded after each job.

1. Check out the merged reviewed commit recorded in the final PR evidence. Install
   pinned frozen dependencies and generate/build. Review the complete migration
   chain including202611180001_europe_playtest offline. The owner prepares only the
   identified fresh target; never schema-push/reset or migrate an inherited target.
2. Use an ignored, dedicated environment file and explicitly replace inherited DB
   variables in the owner's terminal. Verify protocol/host/port/database against
   the privately recorded fresh identity without printing credentials, using the
   fail-closed URL-selection pattern in LOCAL_TEST_LOGIN.md. Its old sandbox target
   example is **not** the target for107. Startup must not apply migrations.
3. For local-only two-browser testing, follow LOCAL_TEST_LOGIN.md's existing exact
   loopback origin, NODE_ENV=development, AUTH_ENABLED=true,
   AUTH_DEV_LOGIN_ENABLED=true, private random SESSION_SECRET and no trusted proxy.
   Those flags are human test setup, not this task's local verification flags.
   For an independently deployed environment use normal approved OAuth; deployment
   and public hosting are not part of this delivery.
4. Start the normal server/web against that owner-prepared fresh target. Open two
   independent browser profiles/sessions at the same127.0.0.1:5173 origin. Sign in
   as the two local fixtures and choose distinct usernames. Session cookies must
   be separate. Create a **two-player** lobby with a comfortable full planning
   duration, join the other session, lobby-Ready both, host Start. New production
   lobbies are creation-pinned Europe; old lobbies are never converted.
5. Open the match in both. Use Playtest area or Spain maximum zoom, select each own
   formation, and inspect six units and its current position. Camp West(240,240)
   and East(740,240) are synthetic objectives;138 display cities are not all active.
   Verify each session sees only its own roster/current ownership. Geneva must
   remain unavailable, no country-fill ownership inference.
6. In the west session, queue(480,240) and submit explicitly. A map click only fills
   coordinate fields; Add movement submits. Route display is planning, not movement.
   Try(240,0) instead from West: it is water and must reject without a revision or
   Ready change. Do not rely on satellite appearance for legality. Use Unready to
   edit an already-Ready queue; canceled drafts never become active defense lines.
7. Ready both; allow the bounded worker to resolve. Refresh current turn. Verify
   Turn2, West at(480,240), fresh revision0/empty orders/Unready and a full window.
   Queue West toward(720,240), Ready both, inspect the complete battle and own
   losses/survivors/HP/positions/camp ownership in exact Turn2 aftermath. Outcome
   depends on the frozen seed/approved combat, not a UI animation or client choice.
8. Continue empty Ready through Turn4, including the player without an army. Reload
   and reconnect; ensure no old order, selection or stale history crosses turns.
   Inspect one completed own turn at a time. Test logout/auth loss clears private
   state. A second human session is required for actual acceptance; automated
   mocked/disposable checks do not stand in for people playing.
9. Stop the application after the test; retain its isolated records if useful for
   owner review. No cleanup of inherited databases, deployment or capacity claim.

Defense drawings remain local, bounded32-point, uncommitted annotations with no
surface approval, persistence, manning, control or interception effects. Active
line frontage/control/assignment/crossing policies remain unresolved. Full-theatre
playability, naval movement/rosters, economy/recruitment/supply, victory/elimination,
40-player capacity and deployment remain outside this test.

## Complete changed-path inventory

- `README.md`
- `apps/server/src/index.ts`
- `apps/server/src/turns/loop-routes.ts`
- `apps/server/tests/europe-loop.integration.test.ts`
- `apps/web/src/EuropeWorkspace.test.tsx`
- `apps/web/src/Formations.tsx`
- `apps/web/src/LoopWorkspace.tsx`
- `apps/web/src/WorldView.tsx`
- `apps/web/src/europe/EuropeMap.test.tsx`
- `apps/web/src/europe/EuropeMap.tsx`
- `apps/web/src/europe/camera.test.ts`
- `apps/web/src/europe/camera.ts`
- `apps/web/src/europe/europe.css`
- `apps/web/src/europe/geography.json`
- `apps/web/src/europe/imagery.test.ts`
- `apps/web/src/europe/imagery.ts`
- `apps/web/src/europe/overview.jpg`
- `apps/web/src/europe/tile-cache.test.ts`
- `apps/web/src/europe/tile-cache.ts`
- `database/prisma/migrations/202611180001_europe_playtest/migration.sql`
- `database/src/formation-read-repository.ts`
- `database/src/lobby-repository.ts`
- `database/src/loop-repository.ts`
- `database/src/loop-storage.ts`
- `database/src/loop-view.ts`
- `database/src/turn-storage.ts`
- `database/tests/europe-loop.integration.test.ts`
- `database/tests/europe-migration.test.ts`
- `docs/DEVELOPMENT_STATUS.md`
- `docs/EUROPE_PLAYTEST.md`
- `docs/assets/europe-imagery-register.csv`
- `packages/game-engine/src/combat-loop.ts`
- `packages/game-engine/src/combat-placement.ts`
- `packages/game-engine/src/combat-turn.ts`
- `packages/game-engine/src/europe-assets/surface-manifest.json`
- `packages/game-engine/src/europe-assets/surface-mask.json`
- `packages/game-engine/src/europe-assets/surface-review.json`
- `packages/game-engine/src/europe-playtest.ts`
- `packages/game-engine/src/server.ts`
- `packages/game-engine/src/surface-navigation.ts`
- `packages/game-engine/tests/europe-playtest.test.ts`
- `packages/game-engine/tests/europe-surface.test.ts`
- `packages/game-engine/tests/surface-navigation.test.ts`
- `packages/shared-types/src/europe-map.ts`
- `packages/shared-types/src/index.ts`
- `packages/shared-types/src/loop.ts`
- `packages/shared-types/src/movement-resolution-view.ts`
- `packages/shared-types/src/server.ts`
- `packages/shared-types/tests/europe-map.test.ts`

## Verification observed before publication

Frozen pnpm12.18.0 install, Prisma7.10.1 generation, full build/typecheck/lint and
diff checks passed. Final full local suite:2365 passed,308 deliberate DB skips,
zero failures(109 passed/21 skipped files). Focused checkpoints72,81,40 and final
map3 tests passed as recorded in DEVELOPMENT_STATUS.md; earlier failures and all
five correction passes remain there. The compiled Node engine loaded the exact
canonical mask and admitted the scenario. Build output has a lazy Europe chunk
and approved overview, no raw mask/hash, fixture formations or preview endpoints.

New pure tests prove deterministic Turn1→4, explicit relationships, source-profile
isolation, accepted land interception/casualties, synthetic depleted capture and
provenance, water rejection at acceptance/frozen execution, fractional narrow-water
contact checks and eligible survivor placement. New UI tests cover strict profile
and bounds/privacy, late response/auth clearing, exact intended-turn commands,
138 cities, integer pointer selection versus pan and uncommitted annotations.
Existing historical, rollback/recovery/auth/CSRF tests run unchanged. New hosted
cases cover Europe two-session HTTP Turn1→4, persisted movement/battles/history,
water/profile/foreign rejection with monotonic trusted-time observation, races,
atomic rollback and new-client worker recovery. Those308 DB cases are **unrun
locally**; hosted results must be recorded separately.

A real Chrome check rendered the satellite map/Spain100% cap and own selection,
accepted a keyboard-entered mock order and observed Ready/edit lock. It used an
ignored temporary Vite fixture with explicitly mocked transport, not real auth or
DB. Its initial pointer click did not populate a destination; deterministic React
pointer tests passed after explicit jsdom pointer-capture setup. No fresh touch,
screen-reader speech, human signed-in match or capacity certification is claimed.
