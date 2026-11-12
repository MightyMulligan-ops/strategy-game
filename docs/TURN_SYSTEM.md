# Participant-authorized turn boundary (006A / Issue #28)

006A adds a fixture-backed HTTP/application boundary over the existing turn contracts and engine. It does not enable turns in normal Sovereign startup. There is no production turn storage adapter, persisted Turn 1 initialization, gameplay command, scheduler, frontend turn UI or database change. Authentication, lobby start, world generation/projection and legacy world UNINITIALIZED behavior remain unchanged. The separate 006B.1 pure initialization foundation is described below.

## Explicit fixture registration

`buildApp({ auth, turnFixtures: { service } })` registers the routes only after normal authentication/session/CSRF plugins. Both `buildApp` and direct route registration refuse fixture injection unless `NODE_ENV=test`. Without explicit injection the routes are absent even in test mode; without authentication they are also absent. `apps/server/src/index.ts` is unchanged and never supplies `turnFixtures`. Setting an environment variable alone cannot enable these routes.

`FixtureTurnService` receives a server-private `FixtureTurnStore` and a required trusted clock function. Its turn/command result types reuse the existing `MatchRepository` interfaces without constructing a client. The only adapter is `tests/memory-turns.ts`: a per-match Promise queue, staged state and atomic in-memory commit/rollback. It calls the existing engine and freezes inputs on closure. Tests import the already built public engine entry point; `pnpm prepare:checks` builds it. No package dependency or manifest/lockfile change is necessary. No fixture class is imported by normal startup.

## Version 1 API

| Method/path | Accepted input | Result |
|---|---|---|
| `GET /api/matches/:matchId/turn` | Optional exact `schemaVersion=1` query only | 200 `ReadTurnResponse` |
| `POST /api/matches/:matchId/turns/:turnNumber/ready` | JSON `{schemaVersion:1, expectedRevision, ready}`; no query fields | 200 `SetTurnReadyResponse` after the fixture transaction completes |

The positive-safe integer turn number must have canonical decimal spelling: no leading zero, sign, exponent or fraction. Match IDs are bounded to 128 characters. Unknown/repeated query fields, unsupported schema versions, extra body fields, invalid booleans/revisions and forged identity, time, seed, runtime-pin or order fields are rejected. No replace-orders, cancellation, movement, attack, resolution or start endpoint is added.

`ReadTurnResponseSchema`, `SetTurnReadyRequestSchema`, `SetTurnReadyResponseSchema`, path schemas and `TurnErrorResponseSchema` live beside the existing public turn schemas in `packages/shared-types/src/index.ts`. Keeping them there reuses the exact existing lifecycle/submission schemas without relocating them or introducing circular re-exports. Existing version 1 engine, world and lobby contracts are unchanged.

| Read body | Meaning |
|---|---|
| `{schemaVersion:1, matchId, state:"NOT_STARTED"}` | Authorized active participant; match is OPEN |
| `{schemaVersion:1, matchId, state:"UNINITIALIZED"}` | Authorized active participant; RUNNING match has no turn |
| `{schemaVersion:1, matchId, state:"READY", turn, own}` | Turn is available; `turn` is `TurnRecord`, `own` is `OwnTurnSubmission` |

READY means **availability**, not that the actor is Ready or that the turn is open. Use `own.ready` and `turn.status`. The response validates that both records describe the requested match and same turn. `own` contains only that actor's revision, Ready flag and orders. It contains no acting/account/player identity or other players' submissions. Own-order fixtures may contain existing move/attack intent shapes solely to test projection; there is no gameplay intake or execution.

Turn UNINITIALIZED is independent of the existing world response. A world can be READY while turns are uninitialized. Reads and failed Ready requests never create a world or turn, pin a runtime, modify a match or repair a legacy fixture. Existing legacy RUNNING worlds remain UNINITIALIZED, with no automatic or host-triggered initialization authorized.

GET is strictly observational: no clock sample, closure, write or scheduling. With no worker it can return an overdue turn's last stored OPEN status. This never extends acceptance: a well-formed authorized Ready request checks the trusted clock under the transaction boundary before applying a command.

## Authentication, authorization and errors

Reuse the normal signed, stored session, registered-username gate, private response headers, per-IP rate limit and exact Origin/session-bound CSRF protection for POST. GET needs neither Origin nor CSRF. Mock only the external OAuth provider and storage in tests; cookie/session/CSRF plugins execute normally. The 40-player fixture uses separate documentation-range remote addresses to exercise normal rate limits without disabling or raising them; `app.inject` makes no network connections.

Match authorization occurs inside the serialized fixture transaction before private projection, clock observation or mutation. The acting match-local player ID comes only from the active participant row mapped from the session account. Active turn membership is checked too when a turn exists. An outsider, inactive member, member of another match and missing match share the same 404 envelope. Public lobby discovery never grants turn access.

Responses explicitly construct `turn` and `own`; they never serialize the store, engine state, roster, snapshot, frozen queues, seed, runtime pins or other players' orders. There is no public Ready roster/count. All errors use strict `{schemaVersion:1,error}` envelopes and private headers. Raw exceptions, payloads, cookies and storage details are neither logged nor returned.

| HTTP | Errors |
|---|---|
| 400 | INVALID_REQUEST |
| 401 | UNAUTHENTICATED |
| 403 | USERNAME_REQUIRED, INVALID_ORIGIN, CSRF_REJECTED |
| 404 | NOT_FOUND |
| 409 | TURN_UNINITIALIZED, TURN_CLOSED, WRONG_TURN, STALE_REVISION, REVISION_EXHAUSTED |
| 429 | RATE_LIMITED |
| 500 | INTERNAL_ERROR |

## Revision, closure and concurrency behavior

- Reuse `set_ready` and the existing engine's fixed duration, revision and hybrid-closure rules. A draft starts unready at revision zero even when the participant was lobby-ready. Setting the same Ready value with the current revision still increments revision; this is not request-level idempotency.
- The supplied revision must match. A stale retry never overwrites a newer state. There is no durable request receipt or automatic replay acknowledgement; read the own view to recover after an uncertain response and do not blindly retry with a newly read revision.
- The fixture queue serializes same-match reads and commands. Sample time only inside it, after membership checks. Server observation time must be nondecreasing and JSON-safe; invalid clock/storage behavior fails safely and rolls back.
- The acceptance window is half-open. At the deadline, deadline closure wins over final Ready. Earlier unanimous Ready closure remains authoritative when a later command observes expiry. Disconnection never removes an active player from readiness requirements.
- Closing freezes one final input, including every active player's empty queue. State/frozen input commit together. Return success only after the fixture commit. If the engine rejects a late command, return its 409 **after** committing the observed closure rather than throwing inside the transaction and rolling it back. Malformed HTTP input/auth failures never enter this lifecycle operation.
- No resolver, next-turn opening, world mutation or gameplay processing runs. Closure is the endpoint of this slice. The mutable fixture state is lost when discarded; it supplies no durability, multi-process locking or production capacity guarantee.

## Verification and subsequent approval gates

The new contract/HTTP suites cover strict versions/fields and matched projections, session/onboarding/active-membership checks, private-order isolation, Origin/CSRF, parser/rate-limit/sanitized errors, 2/4/10/40-player readiness, stale and competing revisions, exactly one final-Ready closure/freeze, exact-deadline and late rejection, clock/commit failure rollback, unavailable states, unchanged legacy world reads and absent normal-startup routes. Existing engine/lobby/world/authentication regressions remain in the workspace suite.

All local checks explicitly set `RUN_DATABASE_TESTS=0`. Frozen install, build, TypeScript, lint and **575 workspace unit/HTTP tests** passed, including **60 new focused contract/HTTP cases**. The **73 existing DB assertions are intentionally skipped locally**; no database, server/preflight, Docker, migration, schema validation or backfill command was run. Existing CI remains unchanged and runs its established regression job only in fresh disposable PostgreSQL. No new DB suite or migration is added.

Further owner approval is needed for production adapter/wiring and atomic Turn 1 initialization, runtime pinning and world/snapshot association, durable retry receipts, retry-safe following-turn creation, deadline/restart/downtime policies and any schema/migration. Existing configuration immutability must not be weakened to fill null lobby runtime pins. Existing `GameSnapshot`/`empty-turn-v1` supports an empty world only; a generated-world-aware simulation needs an explicit versioned design. None of these decisions is implied by this fixture boundary. Movement semantics, attack rules, economy, diplomacy, research, visibility and logistics remain separate design/gameplay work.

## Pure Turn 1 initialization foundation (006B.1 / Issue #30)

This database-free slice defines contracts and pure functions only. It assigns no runtime to a real lobby, inserts no snapshot/turn and changes no startup, repository, API or database behavior. Existing legacy RUNNING worlds remain UNINITIALIZED, and no GET initializes anything. The existing approved generator is unchanged.

### Contracts and supported profile

All new contracts/constants are exported only by `@strategy-game/shared-types/server`:

- `InitialWorldRuntimeProfileSchema` / `INITIAL_WORLD_RUNTIME_PROFILE`: schemaVersion=1, ruleset `{rulesetId:"initial-world",version:"1"}`, simulationVersion=`initial-world-v1`, movementTieBreakPolicy=`seeded-shuffle-v1`. This profile authorizes initialization only. The existing provisional tie policy is metadata; initialization executes no movement ordering or gameplay.
- `InitialWorldArchiveSchema`: strict `{matchId, schemaVersion:1, generatorVersion:"territory-grid-v1", payload:GeneratedWorld}`. This is a pure envelope, not a Prisma row. Match metadata is required because the generated payload itself has no match ID. Extra fields, unsupported versions/generators and malformed payloads are rejected.
- `InitialWorldReferenceSchema`: strict `{matchId, archiveSchemaVersion:1, generatorVersion, digest}`. Digest format is `sha256:` followed by 64 lowercase hexadecimal characters.
- `InitialWorldSnapshotSchema`: a distinct schemaVersion=2, kind=`initial_world` contract with snapshot ID, ruleset/simulation metadata, version-1 configuration, canonical active roster, completedTurnNumber=0, stateVersion=0 and `worldRef`. Version 2 does not widen or replace the empty-world version-1 snapshot. The reference preserves access to the complete immutable initial archive; no partial empty-world representation is substituted.

The roster must contain 2–40 unique active players in this exact match. Player IDs match the archive's full roster. Initialization rejects inactive entries rather than silently filtering them. Snapshot player order is ascending JavaScript string/code-unit order, independent of locale, submission time or gameplay precedence. All approved archive region sizes remain accepted; this pure function does not choose or alter generation settings.

### Pure engine functions and identity

`initializeTurnOne(config, activePlayers, archive, openedAtMs, runtimeProfile?)` validates its inputs and returns `{runtimeProfile, snapshot, state}`. The optional runtime defaults to the one supported immutable profile; arbitrary or executable profiles are rejected. `state` is the existing server-private lifecycle `TurnState`: OPEN Turn 1, fixed duration, explicit opening/deadline, revision-zero/unready/empty drafts. No armies, resources, closure, frozen input, resolution or next turn is produced.

`createInitialWorldReference(archive)` hashes the complete validated archive payload, including seed, settings and all initial-world data. It reuses the engine's SHA-256 and canonical JSON helpers: object keys sort recursively; JSON primitive encoding and array order are preserved. A reordered roster input yields the same snapshot, but changing archive array order changes the reference digest. This is the existing engine encoding, not a new cross-language canonicalization standard.

Snapshot ID is `initial-world:` plus SHA-256 over canonical `{snapshot:<metadata without snapshotId>, runtimeProfile}`. It binds configuration, roster, archive reference and supported profile. Opening time belongs to the lifecycle record rather than the world-state snapshot identity: changing only the opening time changes Turn 1's clock, not the identical initial-world snapshot. Digests are content identities, not signatures or proof that a database archive exists.

`validateInitialWorldSnapshot(snapshot, archive, runtimeProfile?)` checks strict shape, roster/match/reference equality, recomputed archive digest and recomputed snapshot ID. Merely passing the reference schema proves digest syntax, not content binding. Future restoration must use the semantic validator with the actual archive. No seed/raw world payload is embedded in the snapshot or exposed by a public projection; the reference and these authoritative schemas are also server-private.

Successful outputs are deeply immutable copies. Caller-owned configuration, roster and archive objects are neither mutated nor frozen. The functions read no clock, randomness, file, environment, network or database. The trusted caller supplies integer milliseconds; safe deadline arithmetic is delegated to the existing turn constructor. Overflow, negative/fractional/nonfinite opening times and unsupported inputs fail without output. A 1ms duration remains valid; no minimum or clamp is invented.

### Unsupported operations and integration limits

`freezeTurnInput` explicitly rejects an initial-world kind/profile with `UnsupportedInitialWorldOperationError` (`code: unsupported_initial_world_operation`) before parsing/freezing input. `resolveTurn` detects that profile in snapshot, frozen input or runtime metadata and returns existing `version_mismatch` with no next state/events/result. The version-1 error/result contracts remain unchanged. Stripping the kind does not bypass the runtime-profile guard. Generic lifecycle helpers remain lifecycle operations, not evidence of world-aware resolution.

006B.1 alone added no persistence support. Owner-approved 006B.2 below adds explicit version-aware restoration and atomic initialization; snapshots are never fed into the version-1 empty-world resolver. Existing RUNNING records must never be initialized or repaired. Production 006A wiring, world-aware freezing/resolution, scheduler/recovery and Turn 2 remain separate approvals.

### Verification

With `RUN_DATABASE_TESTS=0`, build, TypeScript, lint and **640 workspace unit/HTTP tests** passed; all **73 DB assertions were skipped locally**. The focused contracts/initializer/empty-resolution run passed **86 cases**, including **65 new cases**. Coverage includes 2/4/10/40 players, supported region sizes, canonical replay, full-payload SHA-256 and digest/identity tampering, malformed inputs/versions, match/roster mismatch, deadline bounds/overflow, immutable outputs and unchanged mutable inputs, no clock/RNG reads, explicit unsupported-operation rejection and preserved empty-turn-v1 behavior.

No local database command, server/preflight or Docker startup ran. Existing Prisma Client generation during workspace checks is offline. The owner separately permitted the unchanged hosted CI database regression job against fresh disposable PostgreSQL only; no workflow, database tests, schema or migration is changed. This does not authorize access to any existing database or prove atomic persisted initialization.

## Atomic initial-world Turn 1 persistence (006B.2 / Issue #39)

Owner approval covers implementation, one additive migration and unchanged hosted CI on its fresh disposable PostgreSQL service. Existing databases, local DB tests, CI edits and new database provisioning remain prohibited. Work remains unmerged until human review.

New lobby configurations INSERT the exact INITIAL_WORLD_RUNTIME_PROFILE in existing columns; configuration schemaVersion remains 1. Creation still makes no world, snapshot, turn or deadline. The existing host-start ReadCommitted Match FOR UPDATE transaction validates host/capacity/active Ready roster, classifies pins and rejects unexpected initial artifacts/version advancement. All-null legacy OPEN configurations retain world-only start. Partial/unsupported pins fail closed. RUNNING host retries short-circuit before generation or time and never repair missing artifacts.

Generate and insert one approved regionSide=5 archive, then sample the injected trusted clock once after locking/generation. initializeTurnOne provides snapshot v2/stateVersion=0/completedTurnNumber=0 and OPEN Turn 1. Shared transaction helpers insert snapshot, turn, active unready revision-zero drafts and INITIAL history with empty orders/SQL NULL command, then set RUNNING. Success follows commit. Failures roll everything back without clearing lobby Ready or changing configuration. No internal retry occurs; a rolled-back attempt may choose another seed, while a committed start is stable.

Opening and lastObserved match; deadline is opening plus immutable duration with safe-integer validation and no clamp/minimum. A 1ms turn may be overdue at commit. No scheduler is enabled: the initialization-only runtime rejects persistence mutations, including closure, before clock reads or writes. No units, starting armies, frozen input, resolution results or Turn 2 are created. Public responses/projections are unchanged and production 006A routes remain absent.

StoredTurn explicitly distinguishes empty v1 and initial_world v2. Initial restoration validates the actual archive's metadata/seed/size and canonical digest, snapshot identity, profile/configuration/row columns, active participant and turn rosters, clocks and zero/unready/empty drafts plus initial history. Missing/corrupt data is invalid_storage, never a v1 fallback or repair. submitCommand, observeDeadline, prepareResolution, commitResolution and openFollowingTurn reject initial aggregates with private unsupported_runtime_operation before time/SQL mutation; createMatch remains an empty-runtime constructor. Engine guards remain intact. No GET initializes or closes anything.

`202611120001_initial_turn_one` adds only six functions/seventeen triggers; previous migrations, foreign keys and Prisma models remain unchanged. Null-safe guards reject partial/JSON-null profile metadata. Wholly unpinned configurations remain representable for legacy compatibility; the application creation path always supplies new pins. Deferred start/world/snapshot/turn checks require a complete matching world/snapshot/active-roster/draft/history bundle. SQL checks digest syntax and metadata; the semantic validator recomputes canonical SHA-256 (no extension). Initial records/roster/version cannot mutate after start. A quoted A-prefixed AFTER DELETE trigger removes only the deleted parent's initialization children in dependency order before existing RI cascades, preserving immediate NO ACTION foreign keys. Direct child removal while the parent exists remains forbidden. RUNNING backfill is prohibited.

Local checks use RUN_DATABASE_TESTS=0 and in-memory/generated fixtures. New PostgreSQL cases additionally require GITHUB_ACTIONS=true. Upgrade compatibility uses an exclusive rollback-only transaction in the existing disposable service: remove only this migration's DDL, seed predecessor-shaped OPEN/RUNNING fixtures, reapply the exact authored functions/triggers, verify preservation/world-only start, then roll back all fixture/DDL changes. No database/schema/container is provisioned or historical guard removed. NOWAIT contention alone has a bounded test-fixture wait; failed migration statements/assertions are not retried. Insertion-failure constraints target only owned fixture IDs and are removed in finally blocks.

Coverage includes 2/4/10/40 players, tampering, clock order/overflow, mutation refusal and empty-runtime regressions offline; hosted CI adds concurrent starts, stage rollback, NULL/partial bundles, exact rosters, migration upgrade, legacy no-backfill, removal/cascade guards and existing auth/Origin/CSRF/privacy regressions. Actual results are recorded in development status and the draft PR. No DB behavior is inferred from local fixtures, and no permission to migrate a sandbox is implied.
