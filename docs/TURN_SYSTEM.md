# Participant-authorized turn boundary (006A / Issue #28)

006A adds a fixture-backed HTTP/application boundary over the existing turn contracts and engine. It does not enable turns in normal Sovereign startup. There is no production turn storage adapter, Turn 1 initialization, gameplay command, scheduler, frontend turn UI or database change. Authentication, lobby start, world generation/projection and legacy world UNINITIALIZED behavior remain unchanged.

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
