# Development Roadmap

**Status:** Initial sequence. Reorder only when dependencies or prototype results justify it.

## Guiding approach

Build vertical slices, not isolated piles of features. A vertical slice should connect player interaction, server command handling, game rules, persistence where needed, and tests.

The first playable prototype should demonstrate the strategy-game loop and include the two distinctive systems—leadership-dependent movement and basic Military Supplies. Do not spend months building an abstract engine without a playable result.

## Phase 0 — Foundation and rules audit

**Goal:** Make the repository safe and understandable for ongoing development.

- [ ] Initialize pnpm workspace and TypeScript conventions.
- [ ] Add formatting, linting, type-checking, and Vitest.
- [ ] Create initial web and server applications.
- [ ] Establish shared types and package boundaries.
- [ ] Add environment configuration and `.env.example`.
- [ ] Add PostgreSQL/Prisma foundation when persistence is introduced.
- [ ] Complete an atWar reference audit for mechanics that will be reproduced.
- [ ] Record open decisions rather than inventing formulas.
- [ ] Establish GitHub Issues/PR workflow and branch conventions.

**Exit criteria:** A clean install, type-check, and test command work; web and server can start locally; core design docs are discoverable.

## Phase 1 — Map and game shell

**Goal:** Render a navigable 2D map and establish a game session.

- [ ] Choose and document map coordinate/projection approach.
- [ ] Render original/licensed map geometry with PixiJS.
- [ ] Support pan, zoom, selection, and map layers.
- [ ] Represent countries, territories, cities, capitals, and ports.
- [ ] Add basic lobby/game configuration shell.
- [ ] Define map data format and validation.

**Exit criteria:** A player can open a local test game, inspect the map, and select a territory/city.

## Phase 2 — First core gameplay vertical slice

**Goal:** Complete a small end-to-end scenario.

- [ ] Select a country/player faction.
- [ ] Implement a small initial set of unit types and base stats.
- [ ] Recruit leaders and units from eligible nodes.
- [ ] Create stacks and split formations.
- [ ] Enforce leader ranks, one-per-rank, primary/secondary roles, and creation-time specialization selection.
- [ ] Implement leader-commanded geographic movement.
- [ ] Implement the single-infantry original-source-node movement exception.
- [ ] Implement a simple deterministic combat encounter using explicitly approved formulas.
- [ ] Add basic city income/recruitment costs.
- [ ] Persist and reload a scenario.
- [ ] Add tests for movement, leader succession, splitting, and combat modifiers.

**Exit criteria:** A player can recruit, organize, move, and fight in a small scenario; illegal movement is rejected by the server.

## Phase 3 — Basic Military Supplies

**Goal:** Make supply a real but manageable strategic constraint.

- [ ] Node population, generation, storage capacity, and stockpile.
- [ ] Stack supply requirement calculation.
- [ ] Departure allocation slider, defaulting to calculated requirement.
- [ ] Partial-stack movement supply allocation.
- [ ] Stack-carried inventory and consumption.
- [ ] Friendly-node replenishment.
- [ ] Adequate/oversupply/shortage states and configurable attack/defense modifiers.
- [ ] Supply overlay and clear shortage feedback.
- [ ] Split/merge rules that prevent supply-ratio exploits.
- [ ] Tests for stockpile accounting, consumption, and formation changes.

**Exit criteria:** Supply can be generated, allocated, consumed, replenished, and shown to affect attack/defense only.

## Phase 4 — Core strategy systems

**Goal:** Expand the playable loop.

- [ ] Broader unit roster and recruitment constraints (including ports).
- [ ] Economy, upkeep, population, reinforcements, and capital/country rules based on audited decisions.
- [ ] Diplomacy: peace, war, alliance, teams/coalitions, and passage permissions.
- [ ] Fog of war, unit view ranges, stealth, detection, and allied visibility.
- [ ] Defense lines as geographic objects with validated crossing/attack behavior.
- [ ] Victory conditions and match lifecycle.
- [ ] Battle reports and basic playback.
- [ ] Strategies, upgrades, and auto-production as prioritized by the reference audit.

**Exit criteria:** A complete small match can be played from setup through a victory condition.

## Phase 5 — Multiplayer hardening

**Goal:** Make multiplayer reliable and fair.

- [ ] Two-player end-to-end testing early in this phase (and preferably during Phase 2).
- [ ] Simultaneous-turn submission and resolution.
- [ ] Deterministic ordering and tie-breaking.
- [ ] WebSocket lobby and game updates.
- [ ] Reconnect, idempotency, and stale-command handling.
- [ ] Per-player visibility filtering.
- [ ] Basic abuse prevention and authorization tests.
- [ ] Load tests; validate practical player capacity before claiming 40-player support.

**Exit criteria:** Multiple players can complete a match without client-trusted outcomes or information leaks.

## Phase 6 — Content, editor, and customization

- [ ] Additional eras and maps.
- [ ] Map/scenario editor.
- [ ] Custom rulesets and validated module configuration.
- [ ] Admin tools.
- [ ] Public/private/password game options and join cutoff.
- [ ] Additional game modes, rare units, advanced strategies, and quality-of-life features.

## Phase 7 — Advanced systems and scale

Potential later work:
- Strategic/operational intelligence, SIGINT, HUMINT.
- Advanced supply networks: roads, rail, sea routes, air resupply, convoys, depots, capacity, interdiction, and infrastructure damage.
- More advanced AI opponents.
- Performance optimization and larger-scale infrastructure only when measurement justifies it.

## Working cadence

For each milestone:
1. Create a focused GitHub issue with acceptance criteria.
2. Create a short-lived feature branch.
3. Ask Codex to inspect relevant docs and code before implementation.
4. Implement one coherent task.
5. Run tests/type-checks and review the diff.
6. Update docs.
7. Open a pull request and review before merging to `main`.

Avoid asking an AI coding agent to implement the entire game in one prompt.
