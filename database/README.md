# PostgreSQL persistence foundation

This package is server-only. It imports validated contracts and the pure game engine; neither the browser nor the engine imports Prisma. Fastify uses separate match and authentication repositories; only authentication has HTTP endpoints so far.

## Models

| Model | Responsibility |
|---|---|
| `Match` / `MatchConfiguration` | Match identity and current state version; fixed configuration, duration, and pinned ruleset/simulation metadata. Configuration updates are blocked by a database trigger. |
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

`AuthRepository` implements the server-only `AuthPersistence` interface. Provider sign-in atomically creates the internal identity/mapping or reuses the unique winning mapping after a concurrent callback. Linking is a short transaction and never transfers an identity. Initial username selection is conditional on an unset name, with the normalized unique key resolving case-insensitive claim races. Existing identity IDs and match references are preserved by the additive `202611100002_authentication` migration.

OAuth attempts are inserted transactionally, replacing the browser generation's previous pending attempt; consumption checks state/provider/browser/link target/expiry and deletes exactly once in a transaction. Concurrent callbacks can consume only once. Session creation is insert-only; updates compare generation and require unexpired, unrevoked records. Expiry is absolute and unchanged by updates. Logout leaves a revocation tombstone so stale writes cannot recreate a session. A fresh Prisma client can read the same persisted session after restart. No authentication operation writes gameplay tables or invokes simulation.

Account tables reference identities with restrictive foreign keys; deletion needs an explicit retention/dependency policy. Tests remove only their tracked attempts/sessions/provider mappings/identities, in that order. No automatic cleanup of old failed-run fixtures is performed. Expired attempt/session pruning is deferred; no scheduler is introduced. See [authentication documentation](../docs/AUTHENTICATION.md) for configuration and security behavior.

## Dependencies and deferred decisions

`OrderDependency` has scoped foreign keys and rejects self-links. The repository currently refuses order edits if dependencies exist rather than inventing a cancellation policy. No API creates dependencies. Before enabling recruitment references, approve block-versus-cascade cancellation, validate cycles/output quantities, add versioned contracts, and warn about affected dependent orders.

Seed generation/reveal, roster changes, pauses, clock correction, acknowledgement/idempotency receipts for submitted commands, failure-attempt logging, retention, and production deployment policy remain open. Revision conflicts still follow the existing contract; an accepted command retry does not gain an implicit idempotent receipt. Unsupported resolution leaves its immutable inputs and prepared state available; no successful result or state advancement is recorded. Recovery primitives do not themselves retry jobs or progress offline matches.

## Validation

Root `pnpm test` runs mapping/environment and mocked authentication unit tests without PostgreSQL, explicitly skipping both database integration files. The opt-in suite exercises actual migrations/constraints, Ready/revisions/cancellations, competing submissions, closure rollback, seed recovery on a new client, idempotent commits, future dependency storage, and account/session persistence. It currently has 17 live tests. Run it only after the separate local `_test` database has been migrated using the root README instructions.

Prisma schema validation, generation, TypeScript checks, and an offline schema-to-SQL diff can run without credentials. The initial implementation used a supplementary in-memory PGlite SQL smoke check; no application code or committed tests depend on PGlite. The follow-up verified the owner-applied initial migration on the existing PostgreSQL 17.11 test database and passed all 11 live integration tests, including a new fixture-isolation regression. No database reset, migration reapplication, schema change, or foreign-key relaxation was needed.

Fixture cleanup uses one transaction and exact IDs generated by the current test process. It deletes dependency/result/frozen records, orders, revisions, turn-player states, turns, and snapshots before their match, then removes only tracked identities with no remaining participants. Tracking arrays are cleared only after commit. A populated match cannot simply rely on competing cascades: non-deferrable `NO ACTION` links from turn-player states to participants and from turns/results to snapshots require dependency-ordered deletion. Those relationships remain correct for persistence; any future production match-deletion operation also needs an explicit deletion plan. Earlier failed runs may retain fixtures whose ownership IDs were lost; this cleanup does not sweep them by prefix.

The passing live suite still emits a `pg` deprecation warning about overlapping queries on a transaction client. A trace points through Prisma 7.10.1's PostgreSQL adapter into `pg` 8.23.1. Dependency upgrades and future `pg` 9 compatibility are follow-up work; this fix changes neither driver versions nor gameplay behavior.
