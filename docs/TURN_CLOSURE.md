# Production Turn 1 closure — 006D.3 / Issue #59

This issue change is prepared for one draft PR and owner review. It does not execute movement, resolve a turn, advance to Turn 2 or authorize deployment. The task owner's explicit Issue #59 B/C+D+P grant covers implementation, additive SQL authoring, database-free task checks and unchanged hosted CI on fresh disposable PostgreSQL only. Existing-environment migrations and ready/merge/deployment remain separate decisions.

## Versioned compatibility

The composition root pins only newly created matches to `turn-closure/1`, simulation `turn-closure-v1`, tie metadata `seeded-shuffle-v1`. Runtime selection is trusted construction-time configuration, never client input. Existing OPEN and RUNNING configurations are never repinned, upgraded, repaired or backfilled. The repository constructor default remains initial-world. Every historical runtime and v1–v4 snapshot contract remains supported with its original behavior.

New snapshot schemaVersion **5**, kind `turn_closure`, has its own `turn-closure:` identity over the existing canonical JSON/hash contract. `movementDraftSnapshotId` binds the deterministically recomputed v4 predecessor; `initialArmiesSnapshotId` continues to bind v3. All six unit IDs, Infantry-specialized Lieutenant, formation membership, original Military Supplies references, capital coordinates, geographic policy and archive are unchanged. Production still uses regionSide=5. Restoration recomputes the full plan from the actual immutable archive, checks runtime/configuration/roster/clocks, replays every revision and compares every active and retired order row. Corruption fails closed, with no repair on GET.

Host start atomically inserts archive, v5 snapshot, OPEN Turn 1, each active player's unready empty revision-zero draft/INITIAL history and RUNNING status. Opening time is sampled after generation under the parent Match lock. Nothing runs a resolver or changes stateVersion=0.

## Mutation and closure transaction

Existing `GET/POST /api/matches/:matchId/turns/1/orders` continues to handle complete replacement (create/edit/reorder/clear) and stable-ID cancellation. New `POST /api/matches/:matchId/turns/1/ready` accepts exactly `{schemaVersion:1,expectedRevision,ready}`. The actor comes from the signed persisted session, registered username and active match/turn membership. No client actor, time, seed, runtime or move number is accepted. Exact Origin, session CSRF, normal rate limits, private headers and sanitized errors are retained.

All new-runtime writes serialize using the same parent-first Match row lock at ReadCommitted. Membership is checked before private metadata/locks and after any wait. Restore authoritative state and sample a safe, nondecreasing server clock under the lock. The acceptance window is `[openedAtMs,deadlineAtMs)`. Ready/Unready increments revision once, appends immutable SET_READY with complete orders and preserves order rows. Empty queues are valid. Already-held Ready values and stale revisions reject without changes. Ready blocks every edit until explicit Unready; no implicit clearing is permitted in this cohort. This deliberately supersedes the older generic fixture's implicit-reset rule only for the new runtime.

Final Ready before the deadline closes ALL_READY at the trusted observation timestamp in the same transaction. At/after deadline a lifecycle operation instead closes DEADLINE at the scheduled deadline, retaining all last committed drafts, including unready/empty queues. Earlier committed ALL_READY remains immutable. Rejected late commands return their conflict **after** committing valid observed deadline closure. Rejections before deadline leave storage unchanged. Any persistence/freeze/commit failure rolls the whole transaction back. There are no command retries or durable retry receipts: stale/uncertain results require an own GET and a new human action.

SQL guards independently check the database server deadline when appending history, recording ALL_READY and during deferred commit validation. If persistence crosses the deadline, that candidate transaction rolls back. One separate serialized deadline observation uses the database server clock, freezes only previously committed drafts and returns the rejection after closure commits; it never retries the command. Backward or unsafe trusted time fails closed.

## Frozen input and SQL protections

The existing FrozenTurnInputRecord stores a distinct strict **schemaVersion 2**, kind `turn_closure` payload: exact pinned runtime, starting snapshot/state=0, existing world reference and world seed, closed Turn 1 reason/time, canonical active player queues with final revision/Ready flag, stable orders and array order (Move 1..N). Empty queues are explicit. `worldSeed` records existing deterministic provenance; the record's resolution seed stays NULL. No new seed policy, JSON digest, resolution result, account/session/provider data or public frozen endpoint is introduced.

`202611130003_turn_closure/migration.sql` adds only functions/triggers, no model/column change, data rewrite, backfill, dependency or extension. The sole replaced historical function adds the new exact profile to lobby admission; its old cohort branches are preserved byte for byte. All historical triggers stay installed. New exact-profile guards preserve world/snapshot/roster/configuration/state identity, allow only OPEN→CLOSED Turn 1, require immutable contiguous command history and matching active queue numbering, lock Ready drafts, and reject dependencies, resolution and advancement. A deferred check requires OPEN with no frozen record, or CLOSED with exactly one payload reconstructed from durable authoritative rows. Frozen UPDATE/DELETE/reassignment/seed changes are rejected. Only full parent-match cascades can clean children. Shared triggers branch by table before table-specific NEW/OLD column access.

`202611130004_turn_closure_commit_window/migration.sql` adds one function/five deferred triggers, leaving the preceding migration file unchanged. It rejects candidate drafts/Ready/ALL_READY transactions that expire during deferred work, while permitting overdue revision-zero initialization and legitimate DEADLINE freezing. The same scoped P0059 handling rolls back the candidate and observes closure independently. CI-only delayed-commit injections verify first Ready, final Ready and a movement draft.

SQL mirrors structural/geographic validation and freezes exact rows; full canonical hash, deterministic replay and retired-row semantics are additionally verified during application restoration. Fresh-hosted migration/trigger/concurrency/rollback results must be reviewed before merge. Additive DDL still takes schema locks. Existing-environment rollout must separately apply/review the migration before deploying the composition root; an old database refuses the new profile rather than falling back.

## Observational reads and accessible client

Turn GET retains its strict v1 own-only response with authoritative OPEN/CLOSED metadata. Orders GET returns explicit **schemaVersion 2** only for the new cohort, supporting Ready and CLOSED while preserving the old v1 OPEN/unready validator. Both versions retain only own orders/route. Formation and world projections remain unchanged. All GETs are read-only consistent transactions: no clock observation, closure, write lock, initialization or repair. Host gains no opponent visibility. No individual opponent Ready flag/count, enemy draft or frozen payload is sent.

The existing Movement Queue adds native Ready/Unready buttons, authoritative status, an informational countdown, and disabled editor/reorder/cancel controls while Ready or CLOSED. Accepted dotted previews and static army markers remain inspectable. Refresh/reconnect clears and reloads private data; stale or uncertain writes reconcile with one GET and never replay POST. The independent Turn status panel refreshes on successful readiness changes and reconnect. Countdown never closes a turn. CLOSED explicitly says orders are frozen, formations have not moved and Turn 2 has not opened. Existing map keyboard/navigation behavior remains intact.

## Bounded in-process deadline observation

Auth-enabled production startup creates one worker alongside the existing app/client. It schedules an immediate persisted scan, then one non-overlapping bounded batch per configured interval. Only new-runtime RUNNING matches with overdue OPEN Turn 1 are scanned in deadline/match order. Every candidate uses the same lock/restoration/closure service; competing processes are harmless and closed candidates are no-ops. Restart catches up from durable rows without local state or another scheduler. Failures leave persisted candidates eligible for a later normal scan and emit at most one constant sanitized warning per batch, without IDs/orders/errors.

| Setting | Default | Accepted inclusive range |
|---|---:|---:|
| TURN_DEADLINE_INTERVAL_MS | 1000 | 100–60000 |
| TURN_DEADLINE_BATCH_SIZE | 20 | 1–100 |
| TURN_DEADLINE_TIMEOUT_MS | 5000 | 100–15000 |

Configuration rejects invalid/noninteger/out-of-range values before auth-enabled startup. Scans have a 5s SQL statement / 6s transaction bound; closures have configured lock/statement bounds and transaction timeout +1s. Shutdown cancels timers, stops before the next candidate, waits for the current bounded operation, then disconnects the client. SIGINT/SIGTERM close the app. Auth-disabled startup creates no database client or worker. There is no external scheduler, queue, GitHub cron, paid service or new dependency.

## Acceptance and remaining boundaries

Pure, staged-transaction, real session/CSRF mocked HTTP and React tests cover versions, readiness locks, exact boundary/precedence, late rejection commit, audit replay, rollback, privacy and reconnect. CI-only PostgreSQL cases cover 2/4/10/40 initialization, migration guards, cross-connection races, injected rollback, freeze integrity, historical isolation, bounded scans/restart and cascade. Task-side RUN_DATABASE_TESTS=0 skips these cases; it is never database verification. See DEVELOPMENT_STATUS and the draft PR for actual command/run/count evidence.

Owner decisions remain independent code review, manual keyboard/screen-reader and 40-player operational capacity review, ready/merge (E), and any existing-environment migration/deployment (F). Production operations must supply reliable server time; backward/unsafe time fails closed. Long audit histories are fully replayed under bounded transactions and may need separately approved performance work. Future 006D.4 must explicitly design consumption of frozen v2 data; no movement execution, combat, collision tolerance, leaderless-radius policy, supply processing, Turn 2 or resolution is enabled here.
