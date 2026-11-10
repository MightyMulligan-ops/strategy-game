# Strategy Game

A browser-based, multiplayer 2D grand strategy game inspired by the broad gameplay patterns of atWar, with an original implementation, original assets, and an extensible rules architecture.

## Project status

**Pre-production / foundation.** The pnpm workspace has starter React/Vite and Fastify applications, validated turn/order contracts, a pure turn lifecycle, deterministic empty-turn resolution, a movement-queue planning helper, and a PostgreSQL/Prisma persistence foundation. There is no playable game, scheduler, or multiplayer transport. Live PostgreSQL behavior requires the separate integration suite below.

## Product direction

- Browser-based 2D multiplayer strategy.
- Simultaneous turns with a duration configured at match creation and fixed for that match. A turn closes at its server deadline or when all active players mark Ready, whichever happens first.
- Target scale: up to 40 players, subject to performance testing.
- World, regional, national, and custom maps.
- Countries, territories, cities, capitals, ports, and geographic unit positions.
- atWar-inspired core loop: choose a country, develop an economy, recruit and organize forces, move and fight, negotiate, and pursue victory conditions.
- Distinctive additions in the initial playable game: leadership-dependent movement and a deliberately modest Military Supplies system.

This project uses atWar as a gameplay reference only. Do not copy its source code, proprietary assets, maps, branding, or text. Implement original systems and use properly licensed or original data and assets.

## Technology direction

- TypeScript
- React + Vite client
- PixiJS map rendering
- Node.js server
- PostgreSQL + Prisma
- WebSockets for live multiplayer communication
- pnpm workspace monorepo
- Vitest for automated tests

Use a **server-authoritative modular monolith** initially. Do not introduce microservices or Kubernetes without a documented need.

## Repository guide

- `docs/GAME_DESIGN.md` — gameplay rules and current design decisions.
- `docs/TECHNICAL_ARCHITECTURE.md` — system boundaries, stack, data flow, and module contracts.
- `docs/DEVELOPMENT_ROADMAP.md` — milestones and vertical-slice priorities.
- `docs/ATWAR_REFERENCE.md` — reference observations, sources, and unresolved verification items.
- `AGENTS.md` — instructions for AI coding agents and contributors.
- `packages/shared-types/` — strict, versioned runtime schemas and transport types.
- `packages/game-engine/` — server-only lifecycle, empty-turn resolver, and movement-queue planning; no gameplay execution yet.
- `@strategy-game/shared-types/server` — authoritative snapshot/resolution schemas; never send these directly to clients.
- `database/` — server-only Prisma schema, initial migration, mappings, and transactional match repository. See `database/README.md` for storage details.

## Development principles

1. Treat the documentation as the source of truth. If code and docs conflict, stop and identify the conflict rather than silently choosing.
2. Keep gameplay rules configurable where practical, but do not expose arbitrary executable code through game settings.
3. Keep game logic on the server. The client submits player intent and renders authorized state; it does not decide outcomes.
4. Build vertical slices and test them. Do not implement large collections of disconnected systems.
5. Make deterministic turn resolution and explicit tie-breaking a design goal.
6. Add tests and update docs with every gameplay-rule change.
7. Preserve modular boundaries: modules communicate through explicit interfaces and events, not by mutating each other's internals.

## Getting started

Use Node.js 22.13+ on the 22.x line, or Node.js 24+, and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm dev
```

`pnpm dev` starts the Vite starter client and Fastify server (`http://127.0.0.1:3001/health`; optional `PORT` override). The server still exposes only health; it does not start database jobs or expose player APIs. `pnpm lint` runs the existing frontend ESLint checks. Type checks include application source and package tests; builds cover all implemented packages. Test/type-check preparation builds the engine dependency graph and generates Prisma Client, without connecting to PostgreSQL. The first Prisma command may need to download its schema engine.

Zod validates contracts. Assignment 004A adds pinned Prisma 7 CLI/client and its PostgreSQL driver adapter; the adapter supplies the PostgreSQL driver. No extra web framework, environment loader, or database test double is introduced. Prisma's ESM client/adapter setup follows its [PostgreSQL guide](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql).

### Local PostgreSQL setup

Install Docker with Compose, or provide your own local PostgreSQL 17 instance. The Assignment 004A follow-up verified the existing test migration on PostgreSQL 17.11 and passed all 11 live integration tests after correcting dependency-ordered fixture cleanup. No schema or migration change was required.

1. Copy `.env.example` to `.env`. Replace `replace_me` consistently in `POSTGRES_PASSWORD`, `DATABASE_URL`, and `TEST_DATABASE_URL` (URL-encode special characters in connection URLs). No production credentials are needed.
2. Start development storage: `docker compose up -d --wait db`. It listens only on `127.0.0.1:5433` and uses a named volume.
3. Apply the committed migration with `pnpm db:migrate`, then inspect it with `pnpm db:status`.
4. For integration tests, start the separate database: `docker compose --profile test up -d --wait db-test` on port 5434. Run `pnpm db:migrate:test`, then `pnpm test:db`.

The default `pnpm test` runs unit tests and explicitly skips live database tests. `pnpm test:db` requires `TEST_DATABASE_URL` pointing to a local database whose name ends in `_test`; it never falls back to `DATABASE_URL`. It uses the committed migration, not schema push/reset. Missing or unreachable PostgreSQL fails that explicit command. Integration tests delete only their generated match/identity records.

`pnpm db:validate` and schema-to-SQL diff generation work without a running database. Schema validation does not prove migration SQL, triggers, concurrency, rollback, or restart recovery work against PostgreSQL; those require the live suite. Generated Prisma sources are ignored and regenerated from the pinned toolchain.

## Current next step

The live persistence suite now passes against the existing migrated test database. Next add authenticated command APIs and scheduling/restart orchestration. Repository calls return after their transaction commits, but there is no player-facing acknowledgement API or scheduler yet. See `docs/DEVELOPMENT_ROADMAP.md`.
