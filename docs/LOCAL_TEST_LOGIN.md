# Loopback-only local test sign-in (004B.2E / Issue #15)

This opt-in development tool lets two browsers use the **real** lobby API without Google/Discord credentials. It creates normal persisted sessions and isolated fixture identities; it does not bypass username registration, CSRF, membership, host, capacity or lifecycle checks. It is never a production sign-in alternative.

## Fail-closed configuration

All of these must hold before startup:

| Setting | Required value |
|---|---|
| `AUTH_ENABLED` | `true` |
| `AUTH_DEV_LOGIN_ENABLED` | `true` (defaults off) |
| `NODE_ENV` | exactly `development` |
| `AUTH_ORIGIN` | exactly `http://127.0.0.1:5173`, without trailing slash |
| `HOST` | unset or exactly `127.0.0.1`; backend continues to bind explicit IPv4 loopback |
| `AUTH_TRUST_PROXY` | unset or empty |
| `SESSION_SECRET` | existing strong-secret validation, at least 32 characters; keep private |

Production/staging/test/unknown environments, HTTPS/public/alternate origins, public/implicit binds, proxy trust, malformed flags and inconsistent auth flags fail closed. In this mode Fastify's listen entry point also rejects public/implicit hosts. Before session hooks, requests require an actual loopback socket peer and a literal `127.0.0.1` Host; forwarded and X-Forwarded-* headers are rejected rather than trusted. Use the normal Vite `/auth` and `/api` proxy without forwarded-header additions, CORS exceptions, tunnels, container port publishing or public reverse proxies.

Normal mode is unchanged: with the dev flag absent/false, enabled auth still requires at least one complete Google/Discord provider configuration. Set the flag false and retain provider settings to return to OAuth-only behavior. Existing local-fixture cookies are rejected by the session store when the feature is off, without deleting their stored records. Ordinary OAuth sessions remain valid under the existing rules.

## Identities, endpoint and session security

`GET /auth/config` retains `enabled` and `providers`, adding only boolean `devLoginEnabled`. No private fixture IDs or credentials are advertised. The frontend shows **Local test sign-in** only for an anonymous user when this boolean is exactly true; Vite environment variables cannot enable it.

`POST /auth/dev-login` accepts only `{ "fixture": "player-one" }` or `{ "fixture": "player-two" }`. It requires the exact mutation Origin and normal session-bound `x-csrf-token`. Unknown keys, arbitrary account IDs/provider subjects/usernames, extra fields and authenticated account switching are rejected. Successful sign-in rotates the session and returns the ordinary `{ user }` profile; the frontend reloads through the existing CSRF/profile bootstrap before onboarding or lobby actions. Known fixture conflicts return safe 409 `fixture_unavailable`; unexpected failures remain sanitized. The existing per-IP rate limit and no-store headers apply.

The server maps those two choices to reserved `sovereign:local-test:v1:…` identity IDs, separately from random-UUID OAuth identities. `AuthRepository.signInLocalTest` atomically creates/recovers only those exact records and refuses any OAuth mapping collision. It never merges identities, detaches provider mappings, claims usernames or changes existing membership. Fixtures start with a null username and use the unchanged one-time username onboarding; usernames and membership persist across later fixture sign-ins. A name conflict is resolved by choosing another valid username, never by taking another account.

OAuth linking to reserved fixture identities is rejected in both route/persistence boundaries. OAuth sign-in cannot recover a reserved fixture mapping. The session store rejects fixture identity reads/writes outside enabled mode. Cookies, generation rotation, absolute expiry, revocation, logout and logout-all otherwise use the same persistent store and signed HttpOnly SameSite=Lax cookie as normal auth. Local HTTP cookies are not Secure; the dev mode is forbidden on HTTPS/production origins. No hardcoded cookie, bearer token, identity header override or new database schema is introduced.

Anyone with access to this local-only tool can select either fixture. Use only the owner's isolated sandbox and a private local development machine; these choices are not real-account credentials. Fixture data is deliberately durable and no cleanup/reset endpoint is supplied.

## Owner-only sandbox launch — not run by Codex

The owner reports an independently initialized `sovereign_lobby_sandbox` on `127.0.0.1:5435`. **Codex must not connect to this existing sandbox, development or test database.** This task does not initialize, migrate, seed, inspect or repair any of them. If the sandbox schema is not ready, stop and handle it in a separate owner-approved task; startup never migrates.

Keep `.env.sandbox` private/ignored. Put the settings above, a private random session secret and your already-configured sandbox DATABASE_URL there. No OAuth credentials are needed in local-only mode; remove incomplete provider pairs from inherited/file settings or keep complete normal credentials if intentionally testing OAuth too. Do not overwrite `.env` or copy secrets into Git/Vite variables.

`pnpm dev` loads root `.env`; it does **not** automatically read `.env.sandbox`. Inherited PowerShell environment variables take precedence over Node env files and the later root `.env` load. A stale inherited DATABASE_URL can silently override the sandbox file. First, in your own PowerShell terminal, verify the selected target **without connecting or printing credentials**:

```powershell
node --env-file=.env.sandbox -e "try { const u = new URL(process.env.DATABASE_URL); if (!['postgresql:', 'postgres:'].includes(u.protocol) || u.hostname !== '127.0.0.1' || u.port !== '5435' || u.pathname !== '/sovereign_lobby_sandbox') process.exit(1); console.log('Expected sandbox target selected; no connection made.'); } catch { console.error('Sandbox target verification failed; inspect settings privately.'); process.exit(1); }"
```

If it fails, inspect/correct the inherited setting privately before proceeding. Do not print the URL or secret. Then launch the same development orchestrator used by `pnpm dev`, with the sandbox file inherited by its processes:

```powershell
node --env-file=.env.sandbox --experimental-strip-types scripts/development.ts start
```

This owner-invoked workflow prepares generated dependencies, performs its normal readiness query against the selected sandbox and starts the loopback apps. It does not migrate or reset. Keep `AUTH_TRUST_PROXY` empty and use `http://127.0.0.1:5173` consistently. Stop with Ctrl+C. Remove the inherited dev-login flag afterward if it was set in PowerShell; normal `pnpm dev` continues to use root `.env` and any remaining inherited overrides.

## Manual two-browser verification

1. **Owner only:** review `database/prisma/migrations/202611110002_lobby_readiness/migration.sql` and explicitly approve its manual application to the sandbox before applying it. CI approval is limited to disposable CI and does not authorize sandbox migration. Codex must not perform this step or connect to any existing database. After owner-controlled preparation and private target verification, launch the sandbox workflow above. If the column is missing, stop; do not reset, seed or automatically repair it.
2. Open separate browser **profiles** (or different browsers). Incognito windows in one profile can share cookies; separate tabs/windows alone do not guarantee independent sessions.
3. In profile A select Player One, choose a unique valid username if prompted and create a PUBLIC two-player lobby. Record its turn duration. Confirm NOT READY, 0/1 ready, host-only disabled Start Match and the two-player requirement. Host leave stays unavailable.
4. In profile B select Player Two, register a different username, refresh/inspect and join. Confirm distinct names, NOT READY and no Start Match control. Refresh A; it shows 0/2 ready. Duplicate joining must not consume another slot.
5. Mark ready as Player Two and refresh A. Host remains NOT READY and Start disabled. Mark ready as Player One; both show READY after refreshing B, and only A can start. Mark not ready as B and refresh A: Start disables with a waiting reason. A stale enabled start must return safe NOT_ALL_READY and refresh, without retrying.
6. Leave as B while OPEN and refresh A: B no longer counts, and minimum-count disables Start. Rejoin B: same public player ID, NOT READY. Ready B and refresh A; host can start again. Confirm neither browser can change another player's readiness or bypass host-only start through direct requests (normal Origin/CSRF still required).
7. Start as A once both are ready. Both browsers show RUNNING after Refresh details; duration remains unchanged. Joining/leaving/readiness controls close, and host Start disables. Reload both browsers, choose **Started** in Lobby status and inspect the lobby: lifecycle/duration persist. Retrying the normal versioned start POST as host returns ALREADY_STARTED; non-host returns HOST_REQUIRED. No map or turn appears, no simultaneous turn is resolved and no deadline starts.
8. Sign out/reselect the same fixture and confirm username/membership persist. Check logout-all invalidates that fixture's other sessions without signing out the other player.
9. Stop the server, disable the dev flag, configure usual provider credentials and restart normally. Local controls/endpoint disappear; old fixture cookies fail. Recheck Google/Discord login/link/logout when credentials are available.

## Automated evidence and limitations

Local checks explicitly set `RUN_DATABASE_TESTS=0`; unit tests use memory auth, real Fastify session/CSRF plugins, injected HTTP and an ephemeral loopback memory server. Frontend tests cover server-advertised gating, strict boolean handling, fixture selection/session bootstrap and safe failures. Existing Google/Discord, session and lobby authorization tests run unchanged.

The new PostgreSQL integration file is automatically discovered by the existing CI runner and report guard. It uses only CI's newly created disposable PostgreSQL service and tracked current-run fixtures. It refuses pre-existing reserved fixture records before attempting cleanup. Coverage includes two persisted sessions and real lobby create/join/leave, app/client recovery, normal logout-all, OAuth collision refusal and no impersonation/linking. No local DB integration command is run for this issue; hosted CI is the database verification evidence.

No existing database was connected or modified, and private environment files were not displayed/edited. Manual sandbox/provider verification remains an owner action. Issue #15 introduced no migration; Issue #17 adds only the reviewed default-false readiness column, tested exclusively in disposable CI. No automatic seeds, gameplay execution, merge or deployment is added.
