# Strategy Game

A browser-based, multiplayer 2D grand strategy game inspired by the broad gameplay patterns of atWar, with an original implementation, original assets, and an extensible rules architecture.

## Project status

**Pre-production / foundation.** The pnpm workspace has starter React/Vite and Fastify applications, validated turn/order contracts, a pure turn lifecycle, deterministic empty-turn resolution, and a seeded movement-queue planning helper. There is no playable game, persistence, scheduler, or multiplayer transport yet.

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

`pnpm dev` starts the Vite starter client and Fastify server (`http://127.0.0.1:3001/health`; optional `PORT` override). They are not connected to each other yet. `pnpm lint` runs the existing frontend ESLint checks. Type checks include application source and the new package tests; builds cover all implemented workspace packages. Type checks and tests first build shared-types so its package exports work from a clean checkout.

Zod is the shared package's only new runtime dependency. It validates unknown input, rejects extra fields, and derives TypeScript contracts from the same schemas. Vitest was already a workspace dependency. No database or environment file is required for the current checks.

## Current next step

Add durable order storage and atomic turn closure/recovery before complex gameplay. The current in-memory lifecycle does not provide durable acknowledgements or advance offline matches automatically. See the early turn-foundation milestones in `docs/DEVELOPMENT_ROADMAP.md`.
