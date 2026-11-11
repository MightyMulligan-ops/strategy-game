# Authenticated public lobby REST API (004B.2C / Issue #11)

Fastify exposes seven lobby operations using persistent sessions and registered usernames. Approved 005B.2 / Issue #22 makes host start atomically persist an initial world while preserving the existing start envelope and retry outcomes. A separate participant-only GET world endpoint and explicit public projection are documented in [INITIAL_WORLD.md](INITIAL_WORLD.md). Turn 1, deadlines and scheduling remain future work.

## Prerequisites and database safety

Authentication must be enabled and configured as described in [AUTHENTICATION.md](AUTHENTICATION.md). The auth and lobby repositories share one Prisma client; the server disconnects it on app close and startup failure. Tests inject repositories through `buildApp` without opening a network listener. When authentication is disabled, all lobby routes are absent (404), even if a repository is supplied to the builder.

The target must have the committed migrations, including `202611110002_lobby_readiness` for Issue #17. **No existing database, including development, test or the sandbox on port 5435, may be connected to or modified during this task.** The new SQL was generated from local schema files and reviewed before testing. The owner authorized application/testing only in CI's newly provisioned disposable PostgreSQL service. Applying it manually to the sandbox still needs separate explicit owner approval. Missing schema/services produce sanitized errors; startup never applies migrations. See [database migration review](../database/README.md#lobby-readiness-migration-issue-17).

For this task, live verification runs only in CI's fresh PostgreSQL 17 service. CI applies committed migrations and runs all discovered integration suites plus the report guard; local checks explicitly use `RUN_DATABASE_TESTS=0`. Do not run local `test:db`, migration commands, the development preflight or the server to test against an existing database. A `_test` suffix alone is not proof of isolation.

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
| `POST /api/lobbies/:lobbyId/ready` | `{ "schemaVersion": 1, "ready": true }` (or false); no identity fields | 200 `SetLobbyReadyResponse`: `{ schemaVersion, lobby }`, OPEN active-member detail |
| `POST /api/lobbies/:lobbyId/start` | `{ "schemaVersion": 1 }` | 200 `StartLobbyResponse`: `{ schemaVersion, lobby, outcome: "STARTED"\|"ALREADY_STARTED" }`, RUNNING host detail |

For GET, an omitted version defaults to 1; only exact query string `1` is normalized. Unknown/repeated filters, unsupported versions and invalid IDs fail. Join/leave/ready/start bodies omit the path-owned ID, then are reconstructed/validated as full shared commands. A body lobbyId is rejected even if it matches. Ready requires a strict boolean, never a toggle/string/coercion. Public participants/host now include `ready`; summaries/details include `readyCount`. Envelopes remain version 1 as a coordinated pre-release shared-types/server/client update; older strict clients must be rebuilt.

New/rejoining players are NOT_READY; active duplicate joins preserve readiness. Only an active participant may set their own readiness while OPEN, including the host. Only the host may start, with at least two active players and all READY. Membership/readiness/start serialize on the parent Match lock; the transaction now validates/inserts the initial world and conditionally writes OPEN→RUNNING together. Failure rolls back both. Earlier writers are observed; later membership/readiness writes see RUNNING and fail. Repeated host start returns ALREADY_STARTED without generation/backfill; a non-host receives HOST_REQUIRED even after start. Responses follow commit. Configuration/turn duration, pins, snapshots, turns, deadlines and turn results stay unchanged. Historical RUNNING data receives no invented world/readiness history.

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
| 403 | `HOST_REQUIRED` | Only the host may start or acknowledge an already-started lobby |
| 404 | `NOT_FOUND` | Lobby is absent or is an internal legacy match without public metadata |
| 409 | `LOBBY_NOT_OPEN`, `LOBBY_FULL`, `HOST_CANNOT_LEAVE`, `NOT_A_PARTICIPANT` | Repository rejected lifecycle/capacity/membership operation |
| 409 | `NOT_ENOUGH_PARTICIPANTS`, `NOT_ALL_READY` | Start needs at least two active players and all active players READY, including host |
| 429 | `RATE_LIMITED` | Existing per-IP limit exceeded; retains Retry-After |
| 500 | `INTERNAL_ERROR` | Unexpected repository/session/storage/response failure; maps INVALID_STORAGE |

Unsupported methods/routes retain Fastify's ordinary 404; no edit/delete/settings override or gameplay operation is registered.

## Verification and deferred work

Unit HTTP tests use real cookie/session/CSRF plugins and a memory auth fixture with mocked repository responses. Live HTTP tests use the actual auth and lobby repositories and PostgreSQL, mocking only the external OAuth provider. They cover safe creation/list/view, duplicate and concurrent membership, host/RUNNING rejection, persisted-session security and app-replacement recovery. Cleanup touches only tracked records created by the current test, in dependency order; no prefix sweep or reset is performed. The shared runner/CI report guard discovers both `database/tests` and `apps/server/tests` integration files and requires every suite to execute without skips.

Local UI/HTTP checks use memory fixtures. CI covers persisted readiness/rejoin/leave, host/count/all-ready rules, concurrent duplicate starts and start-vs-readiness/membership, configuration preservation and no turn advancement. See [owner-only two-browser acceptance](LOCAL_TEST_LOGIN.md#manual-two-browser-verification). Real OAuth consent, manual sandbox verification, runtime-pin/world orchestration, gameplay commands, durable receipts, pagination, scheduling and other future lobby features remain separate. Functional concurrency tests make no capacity claim.
