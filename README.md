# Strategy Game

A browser-based, multiplayer 2D grand strategy game inspired by the broad gameplay patterns of atWar, with an original implementation, original assets, and an extensible rules architecture.

## Project status

**Pre-production / foundation.** The pnpm workspace has React/Vite and Fastify applications, validated turn/order contracts, a pure turn lifecycle, deterministic empty-turn resolution, a movement-queue planning helper, PostgreSQL/Prisma persistence, and Discord/Google sign-in with persistent accounts and sessions. Authentication requires local provider configuration; it is disabled by default. There is no playable game, scheduler, or multiplayer transport. Live PostgreSQL behavior requires the separate integration suite below.

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
- `docs/AUTHENTICATION.md` — OAuth/session behavior, endpoints, provider setup, and security limitations.
- `docs/CI.md` — GitHub Actions jobs, failure diagnostics, and recommended required checks for `main`.
- `docs/MATCH_LOBBIES.md` — approved lobby rules, versioned contracts, and internal PostgreSQL lobby persistence; APIs, UI, and starting matches remain unimplemented.
- `docs/CODEX_WORKFLOW.md` — human-started Windows VS Code issue-to-draft-PR workflow and metadata labels.
- `docs/DEVELOPMENT_STATUS.md` — evidence-based progress handoff and update policy.
- `AGENTS.md` — instructions for AI coding agents and contributors.
- `packages/shared-types/` — strict, versioned runtime schemas and transport types.
- `packages/shared-types/src/lobby.ts` — public lobby requests/responses, roster/viewer validation, and Quick/Casual classification (004B.2A).
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

## Getting started (Windows)

Use Node.js 22.13+ on the 22.x line, or Node.js 24+, and the pnpm version pinned in `package.json`.

### 1. Required software

Install Git for Windows, Node.js with the version requirements above, and **pnpm 12.18.0**, matching `package.json`. Use PowerShell from the repository root. Restart your terminal after installation so PATH updates take effect.

```powershell
node --version
npm install --global pnpm@12.18.0
pnpm --version
git --version
```

Install Docker Desktop with Docker Compose and start its engine if using the supplied PostgreSQL services. An independently managed local PostgreSQL 17 instance is also supported. Docker/PostgreSQL are optional when using the auth-disabled account shell or running unit tests.

### 2. Clone the repository

Use the URL from this project's GitHub **Code** button:

```powershell
git clone <your-repository-clone-url> strategy-game-1
cd strategy-game-1
```

### 3. Install dependencies

```powershell
pnpm install --frozen-lockfile
```

Keep the committed lockfile and `pnpm-workspace.yaml`. Required Prisma/esbuild dependency build approvals are already configured; do not replace them with blanket approvals. The first Prisma command may download its schema engine.

### 4. Configure `.env`

On a new clone, copy the template once:

```powershell
Copy-Item .env.example .env
```

Preserve any existing `.env`; copy only missing template keys into it. Replace `replace_me` consistently in `POSTGRES_PASSWORD`, `DATABASE_URL`, and `TEST_DATABASE_URL`, URL-encoding special characters in connection URLs. `.env` stays local and ignored by Git. Never put database or provider secrets in `VITE_` variables.

Authentication defaults to disabled. To enable sign-in, follow [AUTHENTICATION.md](docs/AUTHENTICATION.md): configure `AUTH_ENABLED`, `AUTH_ORIGIN`, a random `SESSION_SECRET`, and at least one complete provider credential pair. Auth-enabled startup also needs `DATABASE_URL` and reachable PostgreSQL. The backend's existing validator checks these authentication settings.

### 5. Start PostgreSQL

With Docker Desktop running:

```powershell
pnpm docker:up
```

This starts only development PostgreSQL and waits for its health check. The separate integration-test database starts with:

```powershell
pnpm docker:up:test
```

Development uses `127.0.0.1:5433`; tests use `127.0.0.1:5434`. Both have persistent named volumes. `pnpm docker:stop` stops both services and preserves data. If using your own PostgreSQL instance, manage it yourself and configure the URLs accordingly.

### 6. Apply committed migrations

```powershell
pnpm db:migrate
pnpm db:status
pnpm db:migrate:test
```

Run the test migration command only with the test database running. Apply pending migrations after pulling schema changes. These commands use committed migrations, including the additive authentication migration. Never use schema push/reset: migrations contain custom constraints and triggers. Development startup does not automatically start Docker, migrate, or reset either database.

### 7. Start the development servers

```powershell
pnpm dev
```

Startup builds only the internal packages required by the apps, in pnpm dependency order, including Prisma Client generation. A local content cache checks source/configuration/lockfile changes and generated/build outputs; unchanged repeated starts skip preparation. Deleted or changed output invalidates the cache. The ignored cache contains fingerprints, never `.env` or credentials. Web/server production builds are not part of this preparation.

Preflight checks Node/pnpm compatibility, required generated files, backend environment configuration, and an actual PostgreSQL query when authentication is enabled. It prints no connection URLs or secrets. The probe confirms connectivity, not migration status; use `pnpm db:status` for that. With auth disabled, PostgreSQL is not required by the current backend.

React/Vite hot reload and backend `tsx watch` reload remain enabled. **After editing an internal package (`packages/*` or `database/*`), stop with Ctrl+C and rerun `pnpm dev`.** Preparation rebuilds dependencies before both apps start. There is no shared-package watcher. Restart after `.env` changes too. Ctrl+C stops the foreground development servers; Docker remains running until explicitly stopped.

Open **http://127.0.0.1:5173** consistently rather than alternating with `localhost`. Fastify serves `http://127.0.0.1:3001/health` (optional `PORT` override). Vite proxies `/auth` to port 3001; update its target if overriding that port. Changing the frontend port also requires updating `AUTH_ORIGIN` and registered provider callbacks. If Vite selects another port because 5173 is occupied, stop the conflicting process before using sign-in. The server loads the root `.env`. Game command APIs and database jobs remain unimplemented.

### Daily commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Prepare dependencies, run preflight, start both apps |
| `pnpm dev:prepare` | Prepare internal packages and Prisma without PostgreSQL or OAuth |
| `pnpm dev:prepare --force` | Force preparation, ignoring the cache |
| `pnpm dev:check` | Check prepared files and backend environment/database without starting apps |
| `pnpm dev:web` / `pnpm dev:server` | Prepare and start one app; server also runs preflight |
| `pnpm test` | Unit, deterministic simulation, and mocked authentication tests |
| `pnpm test:db` | Live PostgreSQL integration tests against the separate migrated test database |
| `pnpm typecheck` | Type-check apps, packages, tests, and development scripts |
| `pnpm lint` | Existing frontend ESLint checks |
| `pnpm build` | Build all implemented packages and both applications |
| `pnpm docker:up` / `pnpm docker:up:test` | Start and wait for development/test PostgreSQL |
| `pnpm docker:stop` | Stop local Compose services, preserving volumes |

Existing build/test/typecheck preparation remains independent of the development cache. Typecheck and tests build the database dependency graph and generate Prisma Client without connecting to PostgreSQL.

### 8. Synchronize two computers

Before switching PCs, stop development, inspect `git status`, and commit the intended source/documentation changes on your feature branch. Push the branch once approved for sharing. On the other PC, fetch, switch to that branch, and run `git pull --ff-only` after confirming its working tree is clean. Resolve local changes deliberately rather than resetting them.

After pulling:

```powershell
pnpm install --frozen-lockfile
pnpm docker:up
pnpm db:migrate
pnpm dev
```

Start/migrate the test database separately when needed. Each PC has its own `.env`, dependencies, generated files, cache, and Docker volumes. Git synchronizes code and migrations, not database contents, sessions, accounts, or credentials. Configure secrets privately on each PC and review new `.env.example` keys and toolchain requirements after pulling.

### 9. Troubleshooting

| Symptom | Action |
|---|---|
| Software command not recognized | Install the required tool, reopen PowerShell, and verify PATH/version |
| PowerShell blocks `pnpm.ps1` | Use `pnpm.cmd` for the same commands or follow your machine's approved PowerShell policy |
| Unsupported Node/pnpm | Install the versions listed above; pnpm may reject incompatible Node before preflight runs |
| Missing workspace module or Prisma Client | Run `pnpm install --frozen-lockfile`, then `pnpm dev:prepare --force` |
| Prisma engine download fails | Check internet/proxy access and retry preparation; no database reset is needed |
| Docker daemon unavailable | Start Docker Desktop, wait for its engine, then rerun `pnpm docker:up` |
| PostgreSQL preflight fails | Check service health and `.env` host/port/credentials privately; check migrations after connectivity is restored |
| Changed `.env` password fails with an existing volume | PostgreSQL retains the original volume password; restore the correct setting or deliberately change the database password. Editing `.env` does not reinitialize the volume |
| Missing tables after pulling | Run the appropriate `pnpm db:migrate` or `pnpm db:migrate:test` command |
| Sign-in buttons disabled | Auth is disabled or the provider is unconfigured; follow the auth guide and restart |
| OAuth callback/Origin failure | Match `127.0.0.1:5173`, provider redirects, `AUTH_ORIGIN`, and proxy ports |
| Port already in use | Stop the conflicting process; intentional port changes need matching proxy/origin/callback settings |
| Shared-package edit has no effect | Stop and rerun `pnpm dev` to rebuild dependency output |

Zod validates contracts. Assignment 004A adds pinned Prisma 7 CLI/client and its PostgreSQL driver adapter; the adapter supplies the PostgreSQL driver. No extra web framework, environment loader, or database test double is introduced. Prisma's ESM client/adapter setup follows its [PostgreSQL guide](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql).

Assignment 004B.1 adds `openid-client` for OAuth/OIDC protocol handling and Fastify's cookie, session, CSRF, and rate-limit plugins. PostgreSQL stores sessions; provider access/refresh tokens are never stored or sent to the browser. `jose` is a test-only direct dependency for signed mock Google ID tokens. See [authentication setup](docs/AUTHENTICATION.md) for exact callbacks, environment variables, and production proxy requirements.

### Local PostgreSQL setup

Install Docker with Compose, or provide your own local PostgreSQL 17 instance. Assignment 004B.1 adds an authentication migration after the existing persistence migrations. Apply pending migrations to both local databases; no reset or recreation is needed.

1. Copy `.env.example` to `.env`. Replace `replace_me` consistently in `POSTGRES_PASSWORD`, `DATABASE_URL`, and `TEST_DATABASE_URL` (URL-encode special characters in connection URLs). No production credentials are needed.
2. Start development storage: `docker compose up -d --wait db`. It listens only on `127.0.0.1:5433` and uses a named volume.
3. Apply the committed migration with `pnpm db:migrate`, then inspect it with `pnpm db:status`.
4. For integration tests, start the separate database: `docker compose --profile test up -d --wait db-test` on port 5434. Run `pnpm db:migrate:test`, then `pnpm test:db`.

The default `pnpm test` runs unit tests and explicitly skips live database tests. `pnpm test:db` requires `TEST_DATABASE_URL` pointing to a local database whose name ends in `_test`; it never falls back to `DATABASE_URL`. It uses committed migrations, not schema push/reset. Missing or unreachable PostgreSQL fails that explicit command. Integration tests delete only their tracked fixture records, including test accounts and sessions. The 17 live tests cover turn persistence plus identity uniqueness, linking, username races, OAuth-state consumption, session recovery, expiration, and revocation. Mocked OAuth unit tests require no real provider credentials.

`pnpm db:validate` and schema-to-SQL diff generation work without a running database. Schema validation does not prove migration SQL, triggers, concurrency, rollback, or restart recovery work against PostgreSQL; those require the live suite. Generated Prisma sources are ignored and regenerated from the pinned toolchain.

## Continuous integration

[CI](.github/workflows/ci.yml) runs on pull requests targeting `main` (including drafts) and pushes to `main`. Its two checks are **Application checks** and **PostgreSQL integration tests**. It uses Node.js 24, the pnpm version in `package.json`, a cached pnpm store, and a disposable PostgreSQL 17 test database. No local `.env`, OAuth credentials, or production secrets are needed. Database report validation fails if any integration test is skipped or missing. See [CI setup and branch protection](docs/CI.md) for the GitHub settings to enable after the first run.

## Current next step

For focused issue work, use the [local Codex workflow](docs/CODEX_WORKFLOW.md) and [reusable issue prompt](.github/CODEX_ISSUE_PROMPT.md). A person starts Codex in VS Code with ChatGPT sign-in; GitHub metadata automation never invokes it and requires no OpenAI API key. Review current progress in [DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md).

Configure provider credentials and manually verify consent/callbacks before deploying sign-in. Issue #7 (004B.2A) establishes lobby contracts and documentation only: 2–40 player capacity, registered authenticated callers, host-only start with at least two participants, public discovery, and no new joins/leaves after start. It adds no endpoints, lobby database models, or UI. Next implement authorized lobby/match membership and command adapters, followed by durable acknowledgements and scheduling/restart orchestration. Authentication alone does not authorize game data. See [MATCH_LOBBIES.md](docs/MATCH_LOBBIES.md) and `docs/DEVELOPMENT_ROADMAP.md`.
