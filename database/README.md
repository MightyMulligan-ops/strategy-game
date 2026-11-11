# PostgreSQL persistence foundation

## Initial world (005B.2 / Issue #22)

`MatchWorld` stores one immutable validated JSONB initial archive per match, with pinned schema/generator metadata and uint32 seed as BIGINT. It keeps generated geometry/links/terrain/starting fixtures separate from existing configuration, turns and snapshots. `LobbyRepository.startLobby` inserts it under the existing parent lock and transitions OPEN→RUNNING in the same transaction. `WorldRepository` checks active session-derived membership before reading and explicitly projects public DTOs; no seed or raw JSONB is serialized.

Reviewed additive migration `202611110003_initial_world` adds the table, uniqueness/FK/metadata/range/size checks, parent insertion lock, immutability and deferred guards for future OPEN→RUNNING transitions and world insertions. Existing RUNNING rows without worlds remain unchanged; no backfill. Code-only rollback to an older starter will fail the new world-required guard. Keep archives/history and use a separately reviewed forward/rollback plan; no reset/drop/automatic repair is supplied.

SQL was generated/reviewed offline before CI application. Only fresh disposable CI may migrate/test; no existing development/test/sandbox DB (including port 5435) is accessed. Existing triggers/migrations, turns/deadlines/armies/simulation snapshots stay unchanged. Full contract, SQL review, privacy and test details: [INITIAL_WORLD.md](../docs/INITIAL_WORLD.md). Earlier sections describe the preceding milestones; 005B.2 supersedes their lifecycle-only start boundary.

This package is server-only. It imports validated contracts and the pure game engine; neither browser nor engine imports Prisma. Fastify uses separate match, authentication and lobby repositories. Authentication, lobby metadata, readiness and lifecycle start have HTTP endpoints; game commands/world/turn initialization remain unimplemented.

## Lobby readiness migration (Issue #17)

`prisma/migrations/202611110002_lobby_readiness/migration.sql` was generated offline from the before/after Prisma schema files and reviewed in full before testing. Its only statement is:

```sql
ALTER TABLE "MatchParticipant" ADD COLUMN "lobbyReady" BOOLEAN NOT NULL DEFAULT false;
```

This adds independent lobby readiness, leaving per-turn `PlayerTurnState.ready` unchanged. Existing rows receive false; historical RUNNING readiness is not invented. No existing table/column/constraint/trigger/migration is removed or rewritten. PostgreSQL applies this single DDL statement atomically; it takes a table lock, so an owner-controlled rollout must consider active sessions.

**Approval boundary:** only newly provisioned disposable CI may apply/test this migration. Codex must not connect to, inspect, migrate, seed, clean up or otherwise modify any existing development/test/sandbox database (including port 5435). Local install/build/generate/schema-only diff/typecheck/unit tests need no database. No local server/preflight or DB command is run for Issue #17. Manual sandbox application requires separate explicit owner approval after SQL review; [owner acceptance steps](../docs/LOCAL_TEST_LOGIN.md#manual-two-browser-verification) are documentation, not authorization to execute.

Rollback considerations: keep the additive column and recorded migration if reverting application code; the previous application ignores it. Do not automatically drop the column, delete migration records or reopen RUNNING lobbies. Such operations lose readiness/lifecycle information and require a separately reviewed owner plan. Start itself changes only OPEN→RUNNING, preserving configuration/state version and creating no turns, pins, snapshots, world or deadlines. Future initialization must treat lifecycle-started lobbies explicitly; no empty-world shortcut is introduced.

## Models

| Model | Responsibility |
|---|---|
| `Match` / `MatchConfiguration` | Identity/state version, OPEN/RUNNING lifecycle, nullable historical host/creation metadata; immutable duration/config, lobby name/capacity, and optional initialized-match runtime pins. |
| `PlayerIdentity` / `MatchParticipant` | Stable global player reference with nullable username/unique normalized key, separate from game-scoped participant identity. |
| `OAuthAccount` | Unique provider/subject ownership; one identity per provider account, at most one provider account of each kind per identity. No emails or tokens. |
| `AuthSession` | Server-private JSON, generation, optional identity, absolute expiry, and revocation tombstone. |
| `OAuthAttempt` | One-use state bound to browser session generation/provider/link target, PKCE verifier, Google nonce, and expiry. |
| `GameSnapshotRecord` | Validated authoritative JSON with unique snapshot ID and match/state-version key. |
| `Turn` | Fixed starting snapshot, integer-millisecond deadline, lifecycle status, closure reason, and last server observation. |
| `PlayerTurnState` | Per-turn active membership snapshot, current revision, and Ready flag. Connection status is not membership. |
| `PlayerSubmissionRevision` | Initial revision zero and append-only accepted command/post-draft history, including Ready changes. |
| `PlayerOrder` | Stable order identity, current payload, active/canceled status, draft position, movement number, and content revision. |
| `OrderDependency` | Same-player/turn prerequisite references and optional future output reference. No recruitment types or dependency execution. |
| `FrozenTurnInputRecord` | One immutable closed-turn input plus a seed that can be assigned once before resolution. |
| `ResolutionResult` | One committed result per turn, globally unique resolution ID, resulting snapshot version, complete result/events/version metadata. |

Positions are one-based. `draftPosition` orders moves and attacks for exact contract reconstruction; only moves receive `moveNumber`. Cancellation retains the stable ID and clears its active positions. Reordering frees old active slots before updating records in one transaction. No submission or audit timestamp determines movement priority. Explicit attacks remain distinct; all gameplay orders still fail execution in the empty-turn simulation.

PostgreSQL partial unique indexes prevent duplicate active draft/movement slots. The order primary key prevents duplicate IDs even across canceled/current representations. Composite foreign keys scope identities, turns, and dependencies. Check constraints cover lifecycle clocks, safe integers, order kind/positions, and seeds. Revision foreign keys preserve the relationship between current order content and its accepted historical revision.

The initial migration contains PostgreSQL functions/triggers, partial indexes, checks, and a deferred revision FK beyond Prisma's schema representation. Do not replace it with `db push` or regenerate away those additions. Its SQL transaction includes both generated DDL and these additions. Future migration reviews must preserve them; a schema-only diff does not validate custom SQL.

## Repository operations and transaction boundaries

Create a client with `createDatabaseClient(DATABASE_URL)`, pass it to `new MatchRepository(client)`, and disconnect it when the owning application shuts down. Construction has no module-level connection side effect. Repository data is authoritative/private and is not an HTTP response contract.

- `createMatch`: atomically insert initial version-zero snapshot, immutable settings, opaque identities/participants, first turn, and empty initial revisions. The caller supplies identity mappings and opening time.
- `loadTurn`: reconstruct and validate the original contracts in a repeatable-read transaction. Explicit positions and JavaScript ID ordering avoid database row order/collation as priority. Bigints are checked before converting back to JSON-safe numbers.
- `submitCommand`: lock the turn row, read current state, sample the trusted server clock **after acquiring the lock**, call the existing engine command validator, and commit Ready/revision/history/order changes together. A rejection may still persist deadline closure. Returned success is available only after commit; it is not an implemented network acknowledgement.
- `observeDeadline`: explicitly observe expiry, atomically saving closure and frozen queues. It is not a scheduler. Unanimous Ready takes this same closure path inside `submitCommand`.
- `prepareResolution`: require a closed/frozen turn, persist an explicit uint32 seed once, and enter `RESOLVING`. A restart may call it without a seed to recover the stored context. A different seed is rejected.
- `commitResolution`: validate/recompute the existing empty resolver result outside the write transaction, then lock the turn and atomically commit the output snapshot, unique result/audit, compare-and-swap match version, and `RESOLVED` status. An identical retry returns the committed result; mismatched results fail. Unsupported nonempty orders cannot advance state.
- `openFollowingTurn`: explicitly create the next record after a committed result, retaining fixed match settings. The caller chooses its opening instant; no next-turn timing policy or scheduler is implemented.

Writes serialize on the same turn row using Prisma interactive transactions and parameterized `SELECT ... FOR UPDATE`; reads use repeatable-read snapshots. There are no nested transactions or hidden retry loops. SQL errors roll back the whole operation and propagate; a future caller must handle transient failures. The match version comparison and unique result key protect commits from duplicate/stale resolution attempts. No long-running game simulation holds a write lock.

Deferred database checks require a frozen input at closure, a pinned seed for resolution, a result for `RESOLVED`, and unanimous active readiness for Ready closure. Archives/settings cannot be updated; frozen input content cannot change, and a non-null seed cannot be replaced. All application writes must use repository transaction boundaries rather than independent Prisma model writes. Administrative deletion/retention and database role privileges remain future operational decisions.

## Authentication repository

Issue #15 adds the server-only `signInLocalTest` operation and reserved two-player fixture namespace without changing schema. It atomically creates/recovers only allowlisted non-OAuth identities, refuses existing provider mappings and never claims usernames. OAuth sign-in/linking cannot attach/recover reserved fixture identities. The HTTP mode is separately gated; normal auth persistence/session rules and lobby authorization remain authoritative. See [LOCAL_TEST_LOGIN.md](../docs/LOCAL_TEST_LOGIN.md). Automated persistence coverage runs only against CI's disposable service; existing databases are not accessed by this task.

`AuthRepository` implements the server-only `AuthPersistence` interface. Provider sign-in atomically creates the internal identity/mapping or reuses the unique winning mapping after a concurrent callback. Linking is a short transaction and never transfers an identity. Initial username selection is conditional on an unset name, with the normalized unique key resolving case-insensitive claim races. Existing identity IDs and match references are preserved by the additive `202611100002_authentication` migration.

OAuth attempts are inserted transactionally, replacing the browser generation's previous pending attempt; consumption checks state/provider/browser/link target/expiry and deletes exactly once in a transaction. Concurrent callbacks can consume only once. Session creation is insert-only; updates compare generation and require unexpired, unrevoked records. Expiry is absolute and unchanged by updates. Logout leaves a revocation tombstone so stale writes cannot recreate a session. A fresh Prisma client can read the same persisted session after restart. No authentication operation writes gameplay tables or invokes simulation.

Account tables reference identities with restrictive foreign keys; deletion needs an explicit retention/dependency policy. Tests remove only their tracked attempts/sessions/provider mappings/identities, in that order. No automatic cleanup of old failed-run fixtures is performed. Expired attempt/session pruning is deferred; no scheduler is introduced. See [authentication documentation](../docs/AUTHENTICATION.md) for configuration and security behavior.

## Lobby repository (004B.2B / Issue #9)

`new LobbyRepository(client)` accepts **trusted internal identity IDs**. The [server adapter](../docs/LOBBY_API.md) derives these exclusively from persistent sessions, sharing Prisma with auth. Each operation rechecks registered identity/username; HTTP session/CSRF enforcement belongs to the adapter. The lobby UI uses the same API.

| Method | Committed behavior |
|---|---|
| `createLobby(identityId, settings)` | Validate existing `LobbySettings`, create OPEN match, immutable configuration, host, server creation timestamp, and first membership atomically. |
| `joinLobby(lobbyId, identityId)` | Lock parent Match, require OPEN, acknowledge active duplicate before capacity checking, otherwise create/reactivate membership if room. Returns detail and JOINED/ALREADY_JOINED. |
| `leaveLobby(lobbyId, identityId)` | Take the same lock, require OPEN and a non-host active member, mark membership inactive. Never delete membership/history. |
| `setReady(lobbyId, identityId, ready)` | Same lock, OPEN active caller only; set explicit own boolean, never toggle or accept another player ID. |
| `startLobby(lobbyId, identityId)` | Same lock, host only, at least two active and all ready; guarded OPEN→RUNNING. Repeated host call returns ALREADY_STARTED; no initialization. |
| `getLobby(lobbyId, identityId)` | Read a consistent detail with public roster and viewer projection in repeatable-read isolation. |
| `listLobbies(identityId, filters?)` | Read consistent public summaries; optional version-1 status/duration-category filters. Historical internal matches lacking lobby metadata are excluded. |

IDs are server-generated and independent of account/provider/session IDs. `(matchId, identityId)` stays unique for inactive memberships; rejoin retains the public ID but resets readiness. Only active membership counts. Membership, readiness and start writers use parameterized `SELECT ... FOR UPDATE` on Match in a short ReadCommitted transaction, reading state **after** acquisition. Success follows commit; failures roll back without hidden retries. Host/count/readiness errors map to safe HTTP codes.

Issue #9 and the owner's clarification require **all RUNNING join retries to fail**, including existing members. This is stricter than the unchanged version-1 schema's ability to represent an ALREADY_JOINED response after start. Domain failures use `LobbyError.code`: UNAUTHENTICATED, USERNAME_REQUIRED, INVALID_INPUT, NOT_FOUND, LOBBY_NOT_OPEN, LOBBY_FULL, HOST_CANNOT_LEAVE, NOT_A_PARTICIPANT, INVALID_STORAGE. Legacy matches are NOT_FOUND at the public lobby boundary. Later HTTP adapters must map unexpected SQL errors to safe responses rather than exposing driver exceptions.

Results explicitly project the existing public summary/detail schemas: no internal identity IDs, OAuth records, sessions, ruleset pins, snapshots, or game state. Lobby discovery grants no game-state/spectator authorization. Pagination and request receipts remain future API work.

### Additive migration safety

`202611110001_lobby_persistence` is one transactional migration. It takes table locks and checks for legacy duplicate memberships **before** DDL/uniqueness. A conflict raises a clear error and rolls back; it never deletes or merges records. For operator review, this read-only query identifies conflicts:

```sql
SELECT "matchId", "identityId", count(*)
FROM "MatchParticipant"
GROUP BY "matchId", "identityId" HAVING count(*) > 1;
```

Those are private internal IDs; inspect them locally, never paste them into public logs. Resolve data conflicts through an owner-approved plan before retrying. Prisma can retain a failed migration-history entry even though the SQL transaction rolled back; inspect it and follow Prisma's documented failed-migration procedure only after review. No automated repair/reset is provided.

Existing matches default to RUNNING. Their host, lobby name/capacity, and creation timestamp remain NULL; existing configurations, identities, authentication data, and turn archives stay intact. The original configuration/turn/history checks and triggers are preserved. Host/creation metadata is immutable; RUNNING cannot reopen. New configuration checks enforce name/capacity shape and complete-or-absent runtime pins. The only column relaxations remove NOT NULL from the four runtime pin fields so OPEN lobbies need no invented ruleset, simulation, or world. Legacy configurations still require complete pins; all existing values are preserved.

New lobbies and Issue #17's lifecycle-only start store **no snapshot, active turn, deadline, ruleset pin or world**. Future world/turn orchestration must define runtime pins without rewriting fixed settings and validate safe opening-plus-duration arithmetic. No configuration trigger is relaxed and no internal empty-world initializer is called.

SQL was generated offline from the prior/current Prisma schemas, then reviewed with the custom checks/triggers before execution. Local upgrade verification used a newly created PostgreSQL 17 container with tmpfs storage, no volume/bind mounts, and loopback-only networking; both pre-existing Compose databases were left untouched. Separate new databases verified: preservation of every legacy table and original SQL guard/index with synthetic auth, two-turn history, ordered drafts/dependency, frozen/result archives; readable legacy turns/accounts through existing repositories; and duplicate preflight rejection with unchanged records/schema. A third new database applied the full migration chain via `pnpm db:migrate:test` and ran all integration suites. No existing development/test data was reset, truncated, or deleted.

Schema-only Prisma diffs still propose dropping the pre-existing custom deferred `order_content_revision` foreign key. That identical baseline diff was checked before/after this migration; it is not new drift and must never be executed as a repair.

## Dependencies and deferred decisions

`OrderDependency` has scoped foreign keys and rejects self-links. The repository currently refuses order edits if dependencies exist rather than inventing a cancellation policy. No API creates dependencies. Before enabling recruitment references, approve block-versus-cascade cancellation, validate cycles/output quantities, add versioned contracts, and warn about affected dependent orders.

Seed generation/reveal, roster changes, pauses, clock correction, acknowledgement/idempotency receipts for submitted commands, failure-attempt logging, retention, and production deployment policy remain open. Revision conflicts still follow the existing contract; an accepted command retry does not gain an implicit idempotent receipt. Unsupported resolution leaves its immutable inputs and prepared state available; no successful result or state advancement is recorded. Recovery primitives do not themselves retry jobs or progress offline matches.

## Validation

Root `pnpm test` runs mapping/environment and mocked authentication/lobby HTTP tests without PostgreSQL, skipping live suites. The opt-in suite has 45 live tests across four files: 11 turn persistence, 6 authentication, 21 lobby persistence and 7 actual HTTP/session/PostgreSQL tests. Coverage includes capacity/registration/settings, uniqueness, same-account/last-slot concurrency, lifecycle locking, duplicate/full retries, leave/rejoin, host protection, SQL rollback, recovery, privacy and real session/CSRF/origin enforcement. The runner and CI report guard share discovery across database/server tests and require every suite to execute with no skips. Run migration tests only against a newly created, verified isolated `_test` database after SQL review. Do not use the development database or reset/reuse an existing database for upgrade fixtures. The database package exports the existing `testDatabaseUrl` validator so server integration tests use the same guard without crossing source-package boundaries.

Prisma schema validation, generation, TypeScript checks, and an offline schema-to-SQL diff can run without credentials. The initial implementation used a supplementary in-memory PGlite SQL smoke check; no application code or committed tests depend on PGlite. The follow-up verified the owner-applied initial migration on the existing PostgreSQL 17.11 test database and passed all 11 live integration tests, including a new fixture-isolation regression. No database reset, migration reapplication, schema change, or foreign-key relaxation was needed.

Fixture cleanup uses one transaction and exact IDs generated by the current test process. It deletes dependency/result/frozen records, orders, revisions, turn-player states, turns, and snapshots before their match, then removes only tracked identities with no remaining participants. Tracking arrays are cleared only after commit. A populated match cannot simply rely on competing cascades: non-deferrable `NO ACTION` links from turn-player states to participants and from turns/results to snapshots require dependency-ordered deletion. Those relationships remain correct for persistence; any future production match-deletion operation also needs an explicit deletion plan. Earlier failed runs may retain fixtures whose ownership IDs were lost; this cleanup does not sweep them by prefix.

The passing live suite still emits a `pg` deprecation warning about overlapping queries on a transaction client. A trace points through Prisma 7.10.1's PostgreSQL adapter into `pg` 8.23.1. Dependency upgrades and future `pg` 9 compatibility are follow-up work; this fix changes neither driver versions nor gameplay behavior.
