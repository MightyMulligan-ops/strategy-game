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

The exact turn phase sequence is a future design decision and must be documented before implementing full simultaneous-turn resolution.

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
