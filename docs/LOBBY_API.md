# Authenticated public lobby REST API (004B.2C / Issue #11)

The Fastify server exposes five operations backed by the existing PostgreSQL `LobbyRepository`. They use persistent account sessions and registered usernames. The [Sovereign frontend](LOBBY_UI.md) now integrates these operations. Match start, world initialization, Turn 1, deadlines and scheduling remain future work; Issue #13 changes no backend behavior/schema/migrations.

## Prerequisites and database safety

Authentication must be enabled and configured as described in [AUTHENTICATION.md](AUTHENTICATION.md). The auth and lobby repositories share one Prisma client; the server disconnects it on app close and startup failure. Tests inject repositories through `buildApp` without opening a network listener. When authentication is disabled, all lobby routes are absent (404), even if a repository is supplied to the builder.

The target database must already have the three committed migrations, including `202611110001_lobby_persistence` from merged PR #10. **That migration has not been approved for the owner's existing development database. Do not run `pnpm db:migrate`, Prisma deploy/push/reset, or test fixtures against that database as part of this assignment.** Missing database/schema services produce sanitized errors; startup never applies migrations. Any existing-database rollout needs a separate owner-controlled SQL/conflict review.

For live verification, create a new PostgreSQL 17 instance with fresh storage, loopback-only access and a new `_test` database. Verify its provenance, role/database identity, and zero existing user tables before setting process-local `TEST_DATABASE_URL` and `DATABASE_URL` to that instance. Review committed SQL first, then run `pnpm db:migrate:test`, `pnpm test:db --reporter=default --reporter=json --outputFile=.cache/ci/database-results.json`, and `node --experimental-strip-types scripts/ci-reports.ts verify`. Never infer isolation merely from a `_test` suffix. This task used a new container with tmpfs storage and no existing volumes/binds; both pre-existing Compose databases were untouched.

Fastify serves the API on loopback port 3001 in local development. Vite now forwards both `/auth` and `/api` through the same browser origin. REST clients retain auth cookies and the configured mutation Origin; the frontend obtains a current CSRF token before each explicit lobby POST. No CORS exemption or cross-origin credential fallback is added. Deployment must forward both paths through the configured HTTPS origin; this assignment performs no deployment. Existing development/test databases remain untouched, with the lobby migration still unapproved there.

## Requests and responses

All response envelopes contain `schemaVersion: 1` and validate against the shared public schemas. All POST bodies are strict JSON objects and require numeric `schemaVersion: 1`. Unknown fields, including account/host/player IDs, roles, scenario/era selectors, or settings overrides, are rejected. Mutations accept no query parameters.

| Method / path | Input | Success |
|---|---|---|
| `POST /api/lobbies` | `CreateLobbyRequest`: `{ "schemaVersion": 1, "settings": { "name": "My lobby", "playerCapacity": 10, "turnDurationMs": 300000, "visibility": "PUBLIC" } }` | 201 `CreateLobbyResponse`: `{ schemaVersion, lobby }`; OPEN, creator is sole participant/host |
| `GET /api/lobbies` | Optional `schemaVersion=1`, `status=OPEN\|RUNNING`, `durationCategory=QUICK\|CASUAL\|UNCATEGORIZED` | 200 `ListLobbiesResponse`: `{ schemaVersion, lobbies }`, including an empty list |
| `GET /api/lobbies/:lobbyId` | Lobby ID in path; optional `schemaVersion=1` query only | 200 `ViewLobbyResponse`: `{ schemaVersion, lobby }` |
| `POST /api/lobbies/:lobbyId/join` | `{ "schemaVersion": 1 }`; target comes exclusively from validated path | 200 `JoinLobbyResponse`: `{ schemaVersion, lobby, outcome: "JOINED"\|"ALREADY_JOINED" }` |
| `POST /api/lobbies/:lobbyId/leave` | `{ "schemaVersion": 1 }`; target comes exclusively from validated path | 200 `LeaveLobbyResponse`: `{ schemaVersion, lobby }`, caller is a non-participant |

For GET, the omitted version defaults to 1; only the exact query string `1` is normalized to numeric 1. Unknown/repeated filters, unsupported versions, and whitespace/empty identifiers fail validation. Join/leave bodies are derived from the shared command schemas by omitting the path-owned lobby ID, then reconstructed/validated as the full shared command. A second body `lobbyId` is rejected, even if it agrees with the path. Existing request/success contracts and timing rules are preserved.

## Authentication, CSRF and authorization

1. The persistent session plugin validates the signed cookie, expiry, revocation, and generation. The acting account ID comes only from that server-side session; request bodies, queries, and authorization headers cannot override it.
2. The route checks the session's existing profile and registered username. Username onboarding remains `/auth/username`.
3. Every POST requires the exact configured `AUTH_ORIGIN` and a session-bound `x-csrf-token` obtained from `GET /auth/csrf`. Fetch a current token after sign-in rotation. Missing Origin, `null`, a different host/port/scheme, absent/invalid tokens, or another browser's token fail. Existing auth protections and errors are preserved through shared helper functions.
4. The repository rechecks identity, lifecycle, membership and capacity within its existing transactions. Routes never perform a separate roster read followed by a write. OPEN duplicate joins are idempotent even when full; leaving retains the same player ID for a permitted rejoin. Hosts cannot leave. All RUNNING joins/leaves fail, including duplicate retries.

Every request is still subject to the existing 60-per-IP-per-minute limit. POST Origin checks precede the local profile gate; profile/username checks precede CSRF verification and body validation. Session-loading and rate-limit failures can happen earlier. There is no request-level durable receipt or automatic retry policy.

Responses explicitly validate only public lobby metadata, match-local IDs/usernames, and the current viewer projection. No account IDs, OAuth identifiers, session secrets/tokens, runtime pins, snapshots or hidden game state are serialized. Viewing lobbies grants no spectator or game-state permissions. Responses, including errors, set `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. GET/HEAD reads need no Origin or CSRF token.

## Safe errors

Registered lobby operations return `{ "schemaVersion": 1, "error": "CODE" }`, validated by `LobbyErrorResponseSchema`. Five transport codes are added to the version-1 error enum; all existing domain codes remain accepted. Internal repository codes are mapped rather than sent publicly. Raw SQL/driver/session/parser/schema errors, stack traces, tokens and request bodies are never returned or logged; unexpected failures log a fixed message only.

| HTTP status | Public code | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Invalid body/path/query/version or rejected JSON/content-type/body parser input; maps repository INVALID_INPUT |
| 401 | `UNAUTHENTICATED` | No valid authenticated session or unknown identity |
| 403 | `USERNAME_REQUIRED` | Account has no valid registered username |
| 403 | `INVALID_ORIGIN` | Mutation Origin is missing or differs from configured origin |
| 403 | `CSRF_REJECTED` | Mutation CSRF secret/token is missing or invalid |
| 404 | `NOT_FOUND` | Lobby is absent or is an internal legacy match without public metadata |
| 409 | `LOBBY_NOT_OPEN`, `LOBBY_FULL`, `HOST_CANNOT_LEAVE`, `NOT_A_PARTICIPANT` | Repository rejected lifecycle/capacity/membership operation |
| 429 | `RATE_LIMITED` | Existing per-IP limit exceeded; retains Retry-After |
| 500 | `INTERNAL_ERROR` | Unexpected repository/session/storage/response failure; maps INVALID_STORAGE |

Unsupported routes/methods retain Fastify's ordinary 404 response; no start/edit/delete operation is registered. The shared enum still reserves HOST_REQUIRED/NOT_ENOUGH_PARTICIPANTS for future start behavior, which is not exposed here.

## Verification and deferred work

Unit HTTP tests use real cookie/session/CSRF plugins and a memory auth fixture with mocked repository responses. Live HTTP tests use the actual auth and lobby repositories and PostgreSQL, mocking only the external OAuth provider. They cover safe creation/list/view, duplicate and concurrent membership, host/RUNNING rejection, persisted-session security and app-replacement recovery. Cleanup touches only tracked records created by the current test, in dependency order; no prefix sweep or reset is performed. The shared runner/CI report guard discovers both `database/tests` and `apps/server/tests` integration files and requires every suite to execute without skips.

The [frontend/proxy integration](LOBBY_UI.md) is implemented in Issue #13 with mock HTTP/browser verification and no existing-database access. Real OAuth consent and live UI/database verification, match start and runtime-pin/world orchestration, game-command authorization, acknowledgements/retries, pagination, scheduling, private/invite access, host transfer/cancellation, spectators, teams, chat and gameplay remain separate work. There is no capacity/performance claim from these functional concurrency tests.
