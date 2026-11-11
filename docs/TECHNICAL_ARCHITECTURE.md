# Technical Architecture

**Status:** Proposed baseline. Validate choices through small prototypes before committing to large-scale implementation.

## 1. Architecture goals

- Browser-first 2D strategy game.
- Multiplayer support with authoritative, secure game-state resolution.
- Modular gameplay systems that can evolve independently.
- Configurable rulesets without runtime arbitrary-code loading.
- Testable deterministic game logic.
- A manageable architecture for a small project and AI-assisted development.

## 2. Initial technology stack

| Area | Technology | Responsibility |
|---|---|---|
| Language | TypeScript | Shared language and type system |
| Package manager | pnpm workspaces | Monorepo dependency management |
| Web client | React + Vite | Menus, lobby, HUD, player interactions |
| Map renderer | PixiJS | 2D map, units, overlays, selection, animation |
| Server | Node.js | Sessions, commands, validation, turn resolution |
| Database | PostgreSQL | Persistent users, games, maps, turns, orders, state |
| ORM | Prisma | Database schema and migrations |
| Realtime | WebSockets | Lobby updates, game events, player state |
| Tests | Vitest | Unit and package tests; integration tests as architecture grows |
| OAuth/OIDC | openid-client | Server-only Discord authorization code and Google validated ID-token flows |
| Sessions | Fastify cookie/session/CSRF/rate-limit plugins | PostgreSQL-backed browser sessions and protected account actions |

Versions should be selected for current compatibility when the workspace is initialized and pinned through the package manager lockfile. Do not assume this document fixes exact version numbers.

## 3. Deployment shape

Start with a **modular monolith**:
- One server application/process initially.
- Clear internal package and domain boundaries.
- One PostgreSQL database.
- Explicit interfaces and events between domains.

Do not begin with microservices, Kubernetes, message brokers, or a distributed event platform. Revisit only when scale, reliability, or team ownership demonstrates a concrete need.

## 4. Proposed monorepo

Initial target layout (adjust only with documented rationale):

```text
strategy-game/
├── apps/
│   ├── web/                 # React/Vite browser client
│   ├── server/              # Node.js API, sessions, game orchestration
│   └── admin/               # Later: map/ruleset/game administration
├── packages/
│   ├── game-engine/         # Deterministic domain orchestration and turn resolution
│   ├── shared-types/        # Shared contracts and validated DTOs
│   ├── map-engine/          # Map geometry, coordinate and spatial helpers
│   ├── module-sdk/          # Contracts, events, config schema conventions
│   └── modules/
│       ├── units/
│       ├── movement/
│       ├── army-organization/
│       ├── leadership/
│       ├── combat/
│       ├── economy/
│       ├── supply/
│       ├── defense-lines/
│       ├── visibility/
│       └── diplomacy/
├── database/                # Server-only Prisma schema, migrations, and repository
├── assets/                  # Original or properly licensed assets and attribution
├── tests/                   # Cross-package scenarios and fixtures
├── docs/
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

This is a target structure, not a requirement to create every package immediately. Add packages when a vertical slice needs them.

## 5. Server-authoritative model

The browser client:
- Renders only the state it is authorized to know.
- Sends player intent as commands/orders.
- Displays server-validated results and events.
- Does not decide combat, income, movement legality, visibility, or turn outcomes.

The server:
- Authenticates and authorizes commands.
- Validates movement, recruitment, diplomacy, supply allocation, and other orders.
- Resolves turns and combat.
- Persists authoritative state.
- Filters hidden information separately for each player before sending updates.
- Enforces rate limits and validates untrusted payloads.

Never send hidden enemy state to a client and rely on client-side UI hiding to protect it.

## 6. Domain/module boundaries

Each gameplay module should define:
- Stable module identifier and semantic version.
- Typed public interfaces/commands.
- Validated configuration schema and defaults.
- Declared dependencies/capabilities.
- Domain events it emits and consumes.
- State ownership and persistence requirements.
- Unit, integration, and deterministic scenario tests.
- Migration strategy for persisted state/configuration when needed.

Modules must not directly mutate another module's private state. Cross-domain behavior should use explicit service interfaces, commands, and events.

Examples:
- Movement asks leadership whether a stack has movement authority; it does not inspect or mutate leadership internals.
- Combat consumes calculated combat modifiers from leadership and supply interfaces.
- Supply owns stockpiles and stack-carried inventory.
- Visibility owns detection and player-specific information filtering.
- Economy owns income and recruitment eligibility/cost calculations.

A module registry may compose approved, versioned implementations at application build/deployment time. Game settings may enable/configure supported modules but must never accept arbitrary uploaded JavaScript or executable code.

## 7. Important domain separations

- Territory ownership is not the same as a unit's geographic position.
- City/supply-node stockpile is not the same as a stack's carried supply.
- A leader unit is part of a formation; commander role is derived from stack composition.
- A defense line is a separate geographic object, not simply a territory border.
- Authoritative full game state is not the same as the filtered state sent to an individual player.

## 8. Turn resolution and determinism

- Use explicit turn phases and documented ordering.
- Validate and snapshot eligible orders before resolution.
- Do not let network arrival order decide gameplay outcomes.
- Define stable tie-breaking for simultaneous or conflicting orders.
- Keep simulation logic independent from UI and network transport.
- Prefer deterministic functions given the same initial state, ruleset, and ordered command set.
- If randomness is needed, use an explicit seeded/randomness service whose seed and consumption order are controlled and testable.
- Record enough turn/order history to support battle reports, replay, and debugging.

The exact **gameplay** phase sequence is a future design decision and must be documented before implementing movement/combat/economy resolution. The operational lifecycle below is now defined separately.

### 8.1 Approved turn behavior

- Simultaneous orders and deterministic server-authoritative resolution.
- Hybrid closure: deadline expiry OR unanimous active-player Ready, whichever occurs first.
- Match creation fixes `GameConfig.turnDurationMs`; there is no duration-update command.
- Create, revise, reorder, and cancel orders until closure. Accepted order changes clear Ready; players may explicitly set Ready or unready before closure.
- No orders means no new actions, not immunity from future passive effects.
- Server-only acceptance decisions; offline progression and eventual durable acknowledgements are required.
- Move and attack remain distinct intents. Acceptance of a draft is not execution or gameplay validation.

### 8.2 State machine

`TurnRecord` is a discriminated union with these states:

| State | Meaning | Valid transition |
|---|---|---|
| `open` | Accept player commands; maintain private per-player drafts and Ready flags. | `closed` at deadline or on final active Ready. |
| `closed` | Closure reason/time recorded; drafts frozen against edits. | `resolving` on a trusted server lifecycle call. |
| `resolving` | Reserved for future deterministic gameplay resolution. | `resolved` on a trusted server lifecycle call. |
| `resolved` | Terminal for this turn record. | None; `openNextTurn` creates a new record with the next number. |

No reverse, skip, or repeated resolution transition is allowed. Deadline observation is idempotent with respect to turn metadata. In Assignment 002, `begin_resolution` and `complete_resolution` only test lifecycle transitions; they execute no gameplay and certify no persistence. In a future adapter, only a successful committed resolution may authorize completion/next-turn creation.

### 8.3 Time and Ready semantics

The following are explicit **implementation conventions**, not new balance rules:

- Timestamps and durations are JSON-safe integer milliseconds. A deadline is `openedAtMs + turnDurationMs`; overflow is rejected.
- The acceptance window is half-open: `openedAtMs <= serverNowMs < deadlineAtMs`. At the exact deadline, the turn is closed and commands are rejected.
- Every command first observes the deadline. A final Ready arriving at the deadline cannot replace deadline closure. A prior unanimous Ready closure is preserved when the deadline is observed later.
- Deadline closure records `closedAtMs = deadlineAtMs`, even if observed late. Ready closure records the server instant at which the final Ready is accepted.
- A trusted caller supplies nondecreasing server observation times and serializes command/closure operations. Backwards, fractional, or unsafe times are rejected. No function reads a client clock or calls `Date.now()`.
- The roster is supplied by the server, has unique same-game IDs, and must include at least one active player. Only active players participate in readiness. Disconnected active players still count, so deadline expiry is the fallback. Empty rosters and membership transitions are unsupported, not a decided match-ending policy.
- Each new turn begins with empty drafts and all active players unready. Ready does not submit or copy orders. The final Ready closes the turn within the same pure operation; subsequent unready commands fail.

Future infrastructure must drive expiry with no connected clients, persist the deadline, and enforce the same serialization boundary in a transaction. A pure `observeDeadline` call is not an implemented scheduler or an offline-progression service.

### 8.4 Draft and revision protocol

All command envelopes contain `schemaVersion: 1`, `gameId`, `turnNumber`, and `expectedRevision`. Acting player identity is a separate trusted server argument, never a client-supplied payload field. Account sessions exist in section 9.2; binding them to authorized game commands remains future work.

- `replace_orders` creates/revises a player's entire draft. An empty array clears it. Order IDs must be unique within that draft.
- `cancel_order` removes one existing order by ID. Missing IDs are rejected without changing readiness or revision.
- `set_ready` changes Ready independently of the order list; `ready: false` withdraws Ready while open.
- A draft begins at revision zero. Every accepted command, including Ready changes and repeated Ready values, increments revision by one. The supplied revision must match; stale commands are rejected. Revision overflow is rejected.
- An accepted replacement or cancellation clears Ready, including a replacement that resends the same content. Invalid/stale commands leave draft contents, revision, and Ready unchanged.
- Wrong game/turn, inactive/unknown actor, malformed payloads, and all commands after closure are rejected. Deadline observation may still close a turn when rejecting a command; a future caller must retain the returned lifecycle state even on rejection.
- Replacements preserve the player's intentional array order. The position among `move` entries determines that player's move number; interleaved attacks do not consume a number or acquire a phase. Submission time, roster ordering, and client-chosen IDs do not establish gameplay priority. See section 8.8 for the approved movement-number rule and provisional tie policy.

The pure functions return new frozen snapshots and do not mutate their inputs. They contain no map, unit, combat, or economy state. Consequently a draft change cannot execute an order. Frozen drafts are a future resolution input, not a gameplay-resolved result.

Retries currently encounter revision checks; there is no durable idempotency receipt or accepted-submission acknowledgement API. The internal storage adapter in section 9.1 commits draft writes/closure before returning. A future authenticated API must acknowledge only after that commit and define request receipt/retry semantics.

### 8.5 Package and privacy boundaries

- `packages/shared-types` provides Zod schemas and inferred strict TypeScript contracts: `GameConfig`, `GamePlayer`, `TurnRecord`, `OrderSubmission` (initial/revised complete draft), `OrderCancellation`, `ReadyChange`, and `OwnTurnSubmission`.
- `MoveOrder` has an order ID, stack reference, and finite `x/y` destination; `AttackOrder` has an order ID, stack reference, and opaque target ID. These are minimal intent shapes, not a chosen map projection or targeting/visibility rule. Extra fields, unknown versions/types, and non-JSON numeric values are rejected.
- Schema version 1 covers its enclosed order variants. Future incompatible shapes require an explicit version/migration decision. Strict objects do not pass through private fields or executable rules.
- `TurnRecord` contains lifecycle metadata only. `GamePlayer` contains game-scoped membership, not account credentials/identities. `OwnTurnSubmission` may be returned only to its owner by a future authenticated adapter; it is not a public broadcast contract.
- `packages/game-engine` owns server-only `TurnState`, roster snapshots, and all private drafts. Never send it to clients or import it into the browser. Runtime schemas do not replace authorization or visibility checks.
- `@strategy-game/shared-types/server` is a separate server-only entry point for authoritative snapshot/resolution schemas. They are not re-exported by the public transport entry point. This is a code boundary, not a substitute for future transport filtering.
- Assignment 002 needed no Fastify refactor: lifecycle tests require neither HTTP startup nor transport. Zod was introduced for those contracts; Vitest was already installed. Prisma dependencies are introduced separately in section 9.1. The other gameplay domain packages remain unimplemented.

### 8.6 Explicitly unresolved / future work

Do not infer policies for joins, elimination, surrender, an empty active roster, pause/resume, wall-clock correction, minimum/maximum duration, game-command payload/rate limits, next-turn opening time, or downtime catch-up. Membership is fixed for the supported lifecycle. The caller chooses when to open the next record; the function does not schedule it. Player-facing acknowledgement/retry semantics, match authorization, and scheduler recovery remain future assignments. Account authentication is provided by section 9.2; internal atomic persistence is provided by section 9.1 and covered by the live PostgreSQL suite.

Likewise, no gameplay phase order, movement path/leader validation, attack legality, combat formula, resource reservation, or same-stack conflicting-order policy has been implemented. Existing leadership, supply, and economy rules remain authoritative and will be applied by later domain modules.

The later 004B.2A lobby specification in section 10.1 defines pre-start public joining/leaving separately. It adds contracts only and does not change this fixed-roster turn engine or implement in-match joins, surrender, or elimination.

### 8.7 Empty-turn resolution foundation (Assignment 003)

The server-only schema version 1 contracts are:

| Contract | Purpose |
|---|---|
| `GameSnapshot` | Fixed starting snapshot ID, match config, roster, completed-turn counter, state version, ruleset reference, and simulation version. This version supports an empty world only; unknown unit/economy/map fields are rejected rather than discarded. |
| `FrozenTurnInput` | Starting snapshot ID, the existing closed `TurnRecord`, pinned version metadata, and one final revision/ordered draft for every active player, including empty drafts. |
| `PinnedRuleset` | Ruleset ID/version, simulation version, and named movement tie policy. Only approved compiled implementations may interpret these identifiers; no executable rules are accepted. |
| `TurnResult` | Content-derived resolution ID, input snapshot reference, turn number, seed, next snapshot, order results, domain events, and completed operational phase trace. |
| `OrderResult` | Stable resolution/player/order identity with version metadata. Currently only `rejected/unsupported_order` exists; no successful gameplay variant exists. |
| `DomainEvent` | A versioned `turn_resolved` event linking input/output snapshots and the resulting state version; no wall-clock timestamp. |

`freezeTurnInput(closedLifecycle, startingSnapshot)` copies/freezes the final drafts using the existing lifecycle and schemas. It rejects open turns, mismatched match settings/rosters, and a snapshot at the wrong turn boundary. Capture while closed before beginning resolution. No caller-owned object is mutated or frozen. This function is not a database transaction or acknowledgement.

`resolveTurn(startingSnapshot, frozenOrders, pinnedRuleset, seed)` returns a serializable typed success/failure union. It performs these **operational** phases in order:

1. `validate_inputs`: validate strict schemas, supported simulation/policy, matching versions, snapshot/turn identity, fixed duration, and complete active-player queues.
2. `check_supported_orders`: reject any nonempty turn with stable per-order rejection records and no next state/event. Move and attack are both unsupported execution intents.
3. `advance_empty_state`: increment the completed-turn and state-version counters, preserving the configuration and roster. Reject unsafe counter arithmetic. No passive/gameplay effects run in this simulation version.
4. `emit_audit_event`: produce one turn-resolution event and no action results. No next opening/deadline is scheduled.

Schema errors return `invalid_input`; inconsistent pins return `version_mismatch`; inconsistent snapshot/turn/roster references return `snapshot_mismatch`; nonempty gameplay returns `unsupported_orders`; unsafe state advancement returns `counter_overflow`. There is no partial success or silent order omission. The standalone lifecycle transition helpers still certify neither execution nor persistence: a future adapter must apply only a successful resolver result and coordinate its commit with lifecycle completion.

Simulation version `empty-turn-v1` pins the current behavior. Resolution IDs use SHA-256 over canonical JSON of all validated inputs, the ruleset/policy, and a uint32 seed. Object keys are sorted; arrays preserve intentional order. Snapshot, event, and rejection IDs derive from that identity and stable player/order references. Identical inputs/seed produce identical outputs, including IDs. Different seeds have distinct audit identities even though an empty turn consumes no random draws. Hashes are audit identifiers, not signatures or authentication.

The resolver reads no clock, uncontrolled randomness, storage, or transport. Node's deterministic built-in SHA-256 requires no added dependency; the engine explicitly uses the existing Node type definitions. Results are nested readonly/frozen values. Replay requires retaining the inputs, seed, and matching versioned code; durable history is future work.

Future gameplay extension points belong after input validation and before final state advancement/audit. Movement, combat, economy, supply, diplomacy, and visibility are **unimplemented domains, not an ordered list of phases**. Their mutual precedence and state ownership must be approved before inserting handlers. There are no placeholder handlers pretending to resolve these systems.

### 8.8 Numbered movement queues and provisional precedence

`MovementQueueEntry` carries `{ playerId, moveNumber, order: MoveOrder }`. It is derived from the existing draft, not submitted as a second editable queue. `groupMovementOrders` groups moves by positive one-based number and returns groups in ascending numerical order. Thus all eligible Move 1 entries precede Move 2. It calculates no eligibility and executes no action; future validation determines which orders are eligible.

Within equal-number groups, the provisional `seeded-shuffle-v1` implementation canonicalizes by player ID, then uses Fisher–Yates with a specified 32-bit LCG and rejection sampling. The stream starts from `seed XOR imul(moveNumber, 0x9e3779b9)` and advances by `imul(state, 1664525) + 1013904223`, modulo 2^32. Sampling rejects the incomplete remainder before choosing an index. The algorithm is reproducible and not a security random generator. Seed generation and reveal policy remain future work.

The helper accepts a trusted code-supplied replacement tie-break function operating only inside each group; it must return exactly the original entries as a permutation. Game configuration cannot upload a function. A production replacement requires an explicit policy ID/simulation-version change and replay-compatible code. Canonical input sorting is only a shuffle baseline; neither player ID nor submission/list arrival order becomes fixed gameplay initiative.

Reordering the existing complete draft changes move numbers while preserving order IDs and clears Ready through the existing revision protocol. Canceling a movement compacts later numbers. Frozen drafts retain their final order at closure. Attacks are excluded from this helper, and the empty resolver does not call it to execute gameplay. UI follow-up: dotted map paths with cancellation controls and a separate numbered Movement Queue panel.

### 8.9 Future prerequisites and safe cancellation (specification only)

Dependency references should be scoped by player plus stable order ID, not by mutable movement number, draft position, or submission timestamp. A future movement referencing recruited forces will also need an explicit recruitment-output reference instead of pretending an uncreated stack already exists. These fields are not accepted by the current strict schemas; their introduction needs an explicit schema/version decision.

Before that feature ships, validate prerequisite existence, ownership, output type/quantity, cycles, and dependent-order legality in the same final draft. Queue reordering must not invalidate stable references. A prerequisite cancellation must identify/warn about affected dependent orders and prevent executable dangling references. The owner must choose blocked cancellation versus cascading cancellation and define failures at execution time; neither policy is selected or implemented here. These dependencies do not establish recruitment, attack, or cross-domain phase precedence.

## 9. Persistence and data

PostgreSQL is the persistent store and Prisma is the schema/migration tool. Assignment 004A introduces the initial storage implementation; its follow-up passed the live PostgreSQL persistence suite.

Likely data domains:
- Users and authentication identities.
- Game rooms and access settings.
- Players, teams, and diplomacy.
- Maps, map versions, territories, cities, ports, and geographic features.
- Units, leaders, stacks, and positions.
- Orders and turn snapshots.
- Economy, node stockpiles, and carried supplies.
- Defense lines.
- Visibility/detection state.
- Battle reports and event history.
- Ruleset/module configuration.

Do not design every table before a vertical slice. Evolve schema around tested domain behavior and use migrations.

### 9.1 Assignment 004A persistence foundation

`@strategy-game/database` is a workspace package in the documented `database/` directory. It depends on the existing engine/contracts; the engine remains pure and has no database import. Fastify exposes health and the separate account endpoints in section 9.2, with no game command APIs. Prisma 7.10.1 CLI/client and its PostgreSQL adapter are pinned together; no database dependency is added to the browser or game engine. Client generation uses ESM TypeScript sources and needs no running database.

The schema separates matches/configuration, opaque identities/participants, authoritative snapshots, turns, per-player Ready/revision state, append-only accepted draft revisions, current/canceled order records, future dependencies, frozen inputs, and resolution results. JSON fields retain the existing strict Zod contracts and version metadata. Database integers preserve safe millisecond/counter values with bigint-to-number checks. Full snapshots, drafts, frozen inputs, and result/events remain server-private.

Move numbers and complete-draft positions are persisted independently; attacks have no move number. Scoped primary keys prevent duplicate active IDs; PostgreSQL partial indexes prevent duplicate active queue slots. Cancellation preserves historical IDs. Dependency foreign keys reference stable same-player/turn order IDs, never movement numbers. There is no dependency execution or choice of cancellation cascade policy; edits involving stored dependencies are unsupported until that feature is approved.

Repository operations use a common turn row lock and short interactive transactions. The server samples acceptance time only after obtaining that lock. Draft/revision/Ready writes and hybrid closure/frozen inputs commit together. Deferred SQL checks reject a closed turn without a frozen input or a resolved turn without a result. Match configuration updates, archive updates, frozen content changes, and seed replacements are blocked by triggers. Partial indexes/checks/triggers are maintained in migration SQL and must not be discarded by schema push or future regenerated migrations.

Resolution preparation pins the caller-supplied seed before computation. After a restart, a fresh repository/client can load the same snapshot, frozen queues, ruleset, and seed without process memory. Resolution computation/validation happens outside the write transaction; a guarded transaction commits one output snapshot/result and advances the match version once. Identical result retries return the committed audit. These are recovery primitives, not an implemented job runner/scheduler, authentication layer, or player-facing acknowledgement API. The existing resolver still rejects nonempty gameplay.

The initial migration and local-only Compose services require no production credentials. Unit tests run without a database; PostgreSQL integration tests require an explicit local `_test` URL and migrated test instance. The follow-up passed all 11 integration tests against the existing PostgreSQL 17.11 test database, covering persistence, constraints, competing submissions, rollback, new-client recovery, and result retries. Cleanup explicitly deletes children before parents inside a transaction, using only tracked fixture IDs; cross-referencing `NO ACTION` foreign keys remain unchanged. Future production match deletion must likewise define dependency order. See `database/README.md` for cleanup details and the remaining Prisma/pg deprecation warning.

### 9.2 Account authentication and persistent sessions (Assignment 004B.1)

`apps/server/src/auth` owns provider configuration, `openid-client` protocol adapters, Fastify routes, CSRF protection, and the persistent session-store adapter. `buildApp` constructs the app without listening so HTTP behavior is testable through injection. Startup alone loads environment configuration and creates the Prisma client. `database/AuthRepository` owns provider mapping, username selection, one-use attempts, and session transactions. These boundaries do not import or change game simulation. The web client imports only the strict public account schemas.

`PlayerIdentity.id` remains stable; nullable username/display and normalized unique username key extend it without replacing existing game identity references. `OAuthAccount` uniquely maps `(provider, subject)` to one identity, with at most one account per provider on an identity. No email lookup, email-based merging, passwords, or stored provider tokens exist. New identity plus provider mapping is one atomic nested write; explicit linking is transactional and rejects conflicting ownership. Username selection uses conditional writes and database uniqueness to resolve concurrent claims.

`AuthSession` stores server-only JSON, an optional identity reference, absolute expiry, generation, and revocation tombstone. The maintained Fastify session plugin signs cookies and generates/rotates identifiers; the store's conditional generation update prevents stale writes after rotation, logout, or expiry. Sessions survive a new database client/process; activity does not extend their original expiry. `OAuthAttempt` stores short-lived state/PKCE verifier and Google nonce, bound to browser session generation, provider, and optional authenticated linking target. Consumption is atomic and one-use, including concurrent callbacks.

Google uses OIDC discovery, PKCE S256, state, nonce, issuer/audience/expiry checks, and explicit ID-token signature verification against provider keys. Discord uses state, PKCE S256, and the protected current-user endpoint. Requested scopes are only Google `openid` and Discord `identify`; stable validated subjects identify users. Successful callbacks rotate the browser session. Linking requires an existing authenticated session and CSRF-protected initiation; it never silently switches accounts.

Cookies are host-only, HTTP-only, SameSite=Lax, Secure on HTTPS, and use the `__Host-` prefix on HTTPS. Local HTTP is allowed only for loopback development. Account POST requests require both an exact configured Origin and a session-bound CSRF token. Login/link initiation is POST-only; callbacks are GET and require one-use OAuth state. Responses never include provider subjects, tokens, session data, or authoritative game state. Own-profile responses identify their user from the session, not a submitted ID. Fastify request URL logging is disabled and error responses/logs omit sensitive provider details.

The additive `202611100002_authentication` migration preserves the prior game schema and custom SQL constraints. The live suite now includes six account/session persistence tests in addition to the eleven existing tests. HTTP/provider unit tests use mocks, including signed Google ID tokens with invalid-claim/signature rejection. Real provider consent and production HTTPS/proxy behavior still require deployment verification. Configuration, endpoint details, rate limits, and deferred operational/product decisions are in [AUTHENTICATION.md](AUTHENTICATION.md). Authentication alone supplies no match authorization or game-data endpoints.

## 10. Multiplayer and security

### 10.1 Public lobby contract boundary (004B.2A)

`packages/shared-types/src/lobby.ts` and its public barrel add strict version-1 create/list/view/join/leave/start request/response schemas without changing existing account, turn, snapshot, or repository contracts. [MATCH_LOBBIES.md](MATCH_LOBBIES.md) specifies the approved public, pre-start lifecycle. Capacity is 2–40 including the host; start requires the host and at least two participants. `DRAFT` is reserved and unsupported; only `OPEN` admits new members, and the roster is fixed after `RUNNING`.

Lobby participants expose lobby-scoped IDs and registered usernames only. Summaries contain approved metadata; detailed views add the public roster and a session-derived viewer projection. Schemas check occupancy, host presence, uniqueness, derived timing categories, and permission consistency. Requests contain no acting identity, host, roster, or permission fields. Era/scenario selectors and private access are rejected. Public lobby viewing grants no spectator or game-state access.

The pure `lobbyActionRequestSchema` factory validates a request against trusted, session-bound lobby metadata; it executes no command. A future server must authenticate and require a username, derive the viewer/membership mapping, enforce current-state checks atomically, commit, and return only an authorized projection. A structurally valid duration does not guarantee a schedulable deadline: validate `openedAtMs + turnDurationMs` with safe-integer arithmetic and reject overflow before committing match/start state, as required by section 8.3. Neither client parsing nor response flags replace that authorization. No endpoints, new Prisma models/migrations, lobby persistence, UI, or WebSockets are introduced. Current `MatchRepository.createMatch` and the fixed-roster engine remain internal and unchanged; their integration is later work.

### 10.2 Existing multiplayer foundations

- Test two-player interactions early, not only after single-player systems are complete.
- Enforce authorization on every game command.
- Validate ownership and visibility before exposing data.
- Treat all client input as untrusted.
- Avoid trusting client clocks or client-calculated movement/combat results.
- Design reconnect and idempotent command handling as multiplayer foundations mature.
- Add load tests before claiming a 40-player capacity.

## 11. Quality gates

Assignment 005 adds root TypeScript development tooling without changing application or simulation boundaries. `pnpm dev` prepares only the apps' internal workspace dependencies using pnpm's graph, generates Prisma Client through the existing database build, and caches source/configuration and output fingerprints locally. Preflight reuses the authentication validator and probes PostgreSQL only when the current backend requires it. Internal package edits require stopping and restarting development; application hot reload remains enabled. Docker startup and committed migrations remain explicit commands. See the root README for Windows setup and commands.

For each meaningful change:
- TypeScript type-check.
- Unit tests for domain rules.
- Integration tests across module boundaries.
- Deterministic simulation tests for turn/combat behavior.
- Lint/format checks once configured.
- Migration checks for persistence changes.
- Manual browser verification for relevant UI flows.

Do not report checks as passed unless they were actually run.
