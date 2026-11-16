# Authoritative movement drafts — 006D.2 / Issue #51

Merged in [PR #52](https://github.com/MightyMulligan-ops/strategy-game/pull/52). This document describes the movement-drafts historical cohort; later creation-pinned cohorts add closure and resolution. Earlier task grants are historical, not standing authorization for new work, existing-database access, migrations or deployment.

## Cohort and snapshot compatibility

Production composition explicitly pins newly created lobbies to `movement-drafts/1`, simulation `movement-drafts-v1`. Runtime is a trusted constructor input, never a request field or lobby UI selector. Existing OPEN/RUNNING pins stay immutable. The repository default still selects its historical initial-world cohort; all old cohorts retain their behavior.

Snapshot v4 / `movement_drafts` is a distinct strict contract with a new `movement-drafts:` SHA-256 identity over canonical metadata plus the new runtime. It also binds `initialArmiesSnapshotId`, computed by the unchanged v3 army planner. All six starting units, formation IDs, member ordering, positions, policy, roster and world reference are byte-equivalent to that planner for the same config/roster/archive. There is no stored-v3 relabel, hash reuse, upgrade, backfill or repair. The `territory-grid-v1` archive still has required-empty units and production regionSide=5. Actual units/positions/source remain in the immutable initial snapshot. Restoration replays the complete expected v4 plan and compares all canonical contents, not just hash syntax.

Host start derives the v4 plan before sampling its single opening clock, then atomically stores world/snapshot/OPEN Turn 1/revision-zero empty unready drafts/INITIAL histories before RUNNING. The new profile is explicitly refused by the old generic command/resolver paths. This milestone cannot observe a deadline through a lifecycle transition, close, freeze, resolve, advance or create Turn 2.

## Commands and geographic policy

The existing MoveOrder shape is narrowed at the new production boundary: stable orderId (1..128 trimmed characters), type=move, stackId=the caller's one intact formation ID, and finite integer destination within actual map bounds. Attack, ownership/unit lists, move numbers, client budgets, runtime selectors, Ready, dependencies and unsupported fields are rejected. Ordered complete replacement handles creation, editing, reordering and clearing; cancellation references a stable order ID. Every acceptance advances revision once and keeps ready=false, even identical replacements.

Move 1..N is derived from queue order; cancellation compacts it. The route begins at the immutable formation position and each planned destination begins the next segment. Sum Euclidean segment distances using existing integer coordinates and IEEE-754 square-root arithmetic; exactly 250 is valid and any value greater than 250 is rejected, with no epsilon. An invalid candidate changes nothing. Validate ownership, intact Lieutenant/Infantry composition and leadership against authoritative snapshot data. Single leaderless radius remains unapproved; no leaderless route, mixed-stack formula, terrain/contact/encounter/combat rule or execution is introduced.

## Production API and security

`GET` and `POST /api/matches/:matchId/turns/:turnNumber/orders` support Turn 1 only. GET permits only optional schemaVersion=1; POST permits no query fields. Strict public POST bodies are:

```json
{"schemaVersion":1,"kind":"replace_orders","expectedRevision":0,"orders":[{"type":"move","orderId":"client-stable-id","stackId":"formation:<64 lowercase hex>","destination":{"x":300,"y":250}}]}
```

```json
{"schemaVersion":1,"kind":"cancel_order","expectedRevision":1,"orderId":"client-stable-id"}
```

The signed persisted session, registered username and active same-match membership determine the actor before private metadata, locks or draft retrieval. Membership is rechecked after waiting for the write lock. Host has no extra visibility. POST requires exact Origin and CSRF; existing rate limits, no-store/no-referrer/nosniff headers and sanitized errors remain. No anonymous command route is exposed when authentication is disabled.

GET is a read-only RepeatableRead transaction and observes no lifecycle clock. READY contains only public turn metadata, own unready revision/orders and own derived route (formationId, numbered segment starts/destinations/distances/cumulative values, total/range/remaining). Older supported profiles return UNSUPPORTED, legacy uninitialized returns UNINITIALIZED, OPEN returns NOT_STARTED; corrupt/unknown pins or new-profile artifacts fail closed. Existing own Turn GET and formations GET accept the validated new aggregate while retaining their v1 DTOs. The separate queue GET advertises draft availability without widening historical transport/runtime contracts.

POST returns the same strict READY projection only after commit. Error statuses: 401 authentication; 403 onboarding/Origin/CSRF; indistinguishable 404 outsider/inactive/missing; 400 strict request; 422 invalid whole route; 409 stale/missing-order/deadline/unsupported-runtime/turn/revision conflict; 429 rate; sanitized 500 storage corruption/unexpected failure. No seed, raw snapshot, hash, account/provider/session ID, other formation or enemy draft is projected.

## Transactions, history and deadline

Writes use ReadCommitted, authorize, lock the Match parent (same ordering as initialization/SQL guards), reauthorize, restore and validate authoritative aggregate, then sample the trusted server clock. This serializes competing revisions, including same-player requests; independent players' contents stay isolated, although the parent lock serializes their writes too. Acceptance window is [opening, deadline). Expired turns remain stored OPEN; failed requests never update Turn clocks or closure.

Append the complete accepted history with the strict server-scoped command, conditionally advance PlayerTurnState once, retire old active queue slots, and upsert accepted orders by stable scoped ID. Retired IDs remain as tombstones; no dependency policy is invented. Constraints and partial indexes continue enforcing unique active slots/move numbers. All writes commit or roll back together. PostgreSQL clock guards additionally reject writes that cross the deadline while persisting (SQLSTATE P0051 maps to DEADLINE_PASSED); this is not a lifecycle observation.

Restoration checks every revision 0..N, command kind/scope/expected revision and full candidate semantics; it reconstructs latest accepted orders and every active/retired row, including numbering, payload and lastRevision. Missing, duplicate, forged or inconsistent history fails closed, with no GET repair. Complete replay favors audit integrity; very long histories/queues may require separately designed performance limits later. No unapproved order-count cap is added.

There is no durable request receipt or exactly-once retry guarantee. A lost acknowledgement may follow a committed request. Clients perform one authoritative GET after an uncertain outcome or stale revision and require a fresh user action; they never automatically replay POST.

## Additive SQL authoring

`202611130002_movement_drafts/migration.sql` adds profile, structural route, initialization, immutable-artifact, mutable-draft and deferred history/queue guards. The only replaced old function admits the new profile before returning to its otherwise byte-identical old branches. Every 006D.1/historical trigger remains installed; new write permissions are limited to the exact new profile's active unready Turn 1 player draft/history/order rows before deadline. Config/world/snapshot/army/roster/Turn/state version stay immutable; orders cannot change parent or stable ID. Ready, dependencies, frozen inputs/results and Turn 2 remain forbidden. Initial completeness is still revision-zero only. Parent-delete cleanup remains cohort-specific. No Prisma model, historical SQL, dependency, CI/workflow or repository setting changes.

SQL is authored/reviewed offline only. Fresh-database migration syntax/execution, triggers, real rollback, concurrency, isolation and parent cascades remain unverified until separately authorized disposable hosted CI. Migration validation/application must precede any separately approved deployment of the new creation pin. No existing-environment migration is authorized.

## React queue and verification

Only a matching READY world and own formation can display private queue state. Native owned-formation selection and integer fields supply destinations; explicit map-choice mode rounds a clicked map point to the nearest integer input, with a keyboard selected-territory-center alternative. Ordinary map clicks/arrow/Enter navigation retain their behavior. Map choices fill fields and require a separate save. Planned dotted paths/Move labels come from accepted server data, never move the formation and add no SVG focus targets. The separate native Movement Queue lists segment/cumulative/remaining budget, edit/earlier/later/cancel/refresh controls and feedback. Unsaved edits do not change the displayed saved route.

Refresh clears private previews, pending requests abort on context changes, and late responses are ignored. Match/formation IDs and route origins are checked; access/session loss clears private context. No polling, scheduler, attack/Ready or execution controls exist. Database-free pure, transactional-injection, real-cookie mocked HTTP and frontend tests cover these boundaries; authored hosted-only integration suites remain skipped. See DEVELOPMENT_STATUS.md for actual counts, browser evidence, correction passes and limitations.

Closely spaced route labels can overlap in the SVG; exact numbered destinations and distances remain available in the separate accessible queue. This is a presentation limitation for owner review, without changing any geographic position or contact rule.
