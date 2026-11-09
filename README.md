# Strategy Game

A browser-based, multiplayer 2D grand strategy game inspired by the broad gameplay patterns of atWar, with an original implementation, original assets, and an extensible rules architecture.

## Project status

**Pre-production / foundation.** The repository is being initialized. No playable game systems have been implemented yet.

## Product direction

- Browser-based 2D multiplayer strategy.
- Simultaneous turns with configurable turn duration.
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

## Development principles

1. Treat the documentation as the source of truth. If code and docs conflict, stop and identify the conflict rather than silently choosing.
2. Keep gameplay rules configurable where practical, but do not expose arbitrary executable code through game settings.
3. Keep game logic on the server. The client submits player intent and renders authorized state; it does not decide outcomes.
4. Build vertical slices and test them. Do not implement large collections of disconnected systems.
5. Make deterministic turn resolution and explicit tie-breaking a design goal.
6. Add tests and update docs with every gameplay-rule change.
7. Preserve modular boundaries: modules communicate through explicit interfaces and events, not by mutating each other's internals.

## Getting started

The local development environment is being prepared. Setup instructions will be added when the initial workspace and application packages are implemented.

## Current next step

Establish the monorepo foundation and a small end-to-end playable slice before expanding the feature set.
