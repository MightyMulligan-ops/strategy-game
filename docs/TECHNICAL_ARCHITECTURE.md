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
├── database/                # Prisma schema and migrations
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
- Create, revise, and cancel orders until closure. Accepted order changes clear Ready; players may explicitly set Ready or unready before closure.
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

All command envelopes contain `schemaVersion: 1`, `gameId`, `turnNumber`, and `expectedRevision`. Acting player identity is a separate trusted server argument, never a client-supplied payload field. This is an integration boundary, not implemented authentication.

- `replace_orders` creates/revises a player's entire draft. An empty array clears it. Order IDs must be unique within that draft.
- `cancel_order` removes one existing order by ID. Missing IDs are rejected without changing readiness or revision.
- `set_ready` changes Ready independently of the order list; `ready: false` withdraws Ready while open.
- A draft begins at revision zero. Every accepted command, including Ready changes and repeated Ready values, increments revision by one. The supplied revision must match; stale commands are rejected. Revision overflow is rejected.
- An accepted replacement or cancellation clears Ready, including a replacement that resends the same content. Invalid/stale commands leave draft contents, revision, and Ready unchanged.
- Wrong game/turn, inactive/unknown actor, malformed payloads, and all commands after closure are rejected. Deadline observation may still close a turn when rejecting a command; a future caller must retain the returned lifecycle state even on rejection.
- Current replacements preserve array order as submitted intent, not execution priority. Network arrival order, roster ordering, and client-chosen order IDs do not establish gameplay initiative. Future resolution needs separately approved ordering/conflict rules.

The pure functions return new frozen snapshots and do not mutate their inputs. They contain no map, unit, combat, or economy state. Consequently a draft change cannot execute an order. Frozen drafts are a future resolution input, not a gameplay-resolved result.

Retries currently encounter revision checks; there is no durable idempotency receipt or accepted-submission acknowledgement API. A future storage adapter must acknowledge only after its durability guarantee is met and must atomically coordinate acceptance, closure, snapshotting, and recovery.

### 8.5 Package and privacy boundaries

- `packages/shared-types` provides Zod schemas and inferred strict TypeScript contracts: `GameConfig`, `GamePlayer`, `TurnRecord`, `OrderSubmission` (initial/revised complete draft), `OrderCancellation`, `ReadyChange`, and `OwnTurnSubmission`.
- `MoveOrder` has an order ID, stack reference, and finite `x/y` destination; `AttackOrder` has an order ID, stack reference, and opaque target ID. These are minimal intent shapes, not a chosen map projection or targeting/visibility rule. Extra fields, unknown versions/types, and non-JSON numeric values are rejected.
- Schema version 1 covers its enclosed order variants. Future incompatible shapes require an explicit version/migration decision. Strict objects do not pass through private fields or executable rules.
- `TurnRecord` contains lifecycle metadata only. `GamePlayer` contains game-scoped membership, not account credentials/identities. `OwnTurnSubmission` may be returned only to its owner by a future authenticated adapter; it is not a public broadcast contract.
- `packages/game-engine` owns server-only `TurnState`, roster snapshots, and all private drafts. Never send it to clients or import it into the browser. Runtime schemas do not replace authorization or visibility checks.
- No Fastify refactor is needed for this assignment: lifecycle tests require neither HTTP startup nor transport. Zod is the only new runtime dependency; Vitest was already installed. The other domain packages remain unimplemented.

### 8.6 Explicitly unresolved / future work

Do not infer policies for joins, elimination, surrender, an empty active roster, pause/resume, wall-clock correction, minimum/maximum duration, payload/rate limits, next-turn opening time, or downtime catch-up. Membership is fixed for the supported lifecycle. The caller chooses when to open the next record; the function does not schedule it. Acknowledgement/retry semantics, atomic persistence, authentication, and scheduler recovery are future assignments.

Likewise, no gameplay phase order, movement path/leader validation, attack legality, combat formula, resource reservation, or same-stack conflicting-order policy has been implemented. Existing leadership, supply, and economy rules remain authoritative and will be applied by later domain modules.

## 9. Persistence and data

PostgreSQL is the planned persistent store. Prisma is the planned schema/migration tool.

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

## 10. Multiplayer and security

- Test two-player interactions early, not only after single-player systems are complete.
- Enforce authorization on every game command.
- Validate ownership and visibility before exposing data.
- Treat all client input as untrusted.
- Avoid trusting client clocks or client-calculated movement/combat results.
- Design reconnect and idempotent command handling as multiplayer foundations mature.
- Add load tests before claiming a 40-player capacity.

## 11. Quality gates

For each meaningful change:
- TypeScript type-check.
- Unit tests for domain rules.
- Integration tests across module boundaries.
- Deterministic simulation tests for turn/combat behavior.
- Lint/format checks once configured.
- Migration checks for persistence changes.
- Manual browser verification for relevant UI flows.

Do not report checks as passed unless they were actually run.
