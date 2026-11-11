# Account authentication (Assignment 004B.1)

## Implemented boundary

Discord and Google sign-in create or recover a persistent internal player identity. Registered users can use the authenticated [lobby REST API](LOBBY_API.md) to create/list/view/join/leave public lobbies. There is no email/password login, email-based account discovery, automatic account merging, match start, order API, scheduler, or WebSocket implementation. Authentication alone grants no game-state or other-player draft access.

The public, versioned `AuthenticatedPlayer` contract contains only `id`, nullable `username`, and linked provider names. Provider subjects, tokens, OAuth attempt data, session data, match drafts, and authoritative snapshots stay on the server. The username rules approved by the owner are 3–24 ASCII letters/digits/underscores, beginning with a letter, with case-insensitive uniqueness. Initial selection is supported once. Renaming needs a separate decision.

## Library choice and boundaries

The server uses [openid-client](https://github.com/panva/openid-client) for maintained OAuth/OIDC protocol handling, and Fastify's [session](https://github.com/fastify/session), cookie, [CSRF](https://github.com/fastify/csrf-protection), and rate-limit plugins for browser sessions and request protection. This fits the existing Fastify application and Prisma 7 repository without introducing another framework or requiring email-based user models. `jose` is used only to sign mock Google ID tokens in tests. No custom cryptographic primitive is implemented.

- `apps/server/src/auth`: configuration, provider adapters, routes, persistent session-store adapter.
- `database/src/auth-repository.ts`: transactional identity linking, username claims, one-use OAuth attempts, persistent session generation/expiry/revocation.
- `packages/shared-types/src/auth.ts`: strict public account/username schemas; no private storage types.
- `apps/web`: Sovereign-branded same-origin login/onboarding/profile and lobby shell. It receives no OAuth credentials or provider tokens; [LOBBY_UI.md](LOBBY_UI.md) records preserved account flows and frontend tests.
- `packages/game-engine`: unchanged; no authentication, database, clock, or random source is added to simulation.

## Local setup

1. Follow the root README to start local PostgreSQL. Authentication requires the existing `202611100002_authentication` migration. Lobby APIs additionally require `202611110001_lobby_persistence`; that pending migration is **not approved for the owner's existing development database**. Do not apply the pending chain there during this assignment. Use only a newly created verified isolated database for migration/integration tests; see [LOBBY_API.md](LOBBY_API.md#prerequisites-and-database-safety). No startup command automatically migrates, resets, or schema-pushes a database.
2. Copy missing keys from `.env.example` into the ignored root `.env`; preserve existing database configuration. Set `AUTH_ENABLED=true` and `AUTH_ORIGIN=http://127.0.0.1:5173`.
3. Generate a session-signing secret locally, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`, and put it in `SESSION_SECRET`. Use a different secret for each environment. Never commit it or put it in a `VITE_` variable.
4. Register provider applications and configure at least one complete client ID/secret pair. Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`. The UI enables only configured providers. Set exact registered redirect URLs to:
   - Google: `http://127.0.0.1:5173/auth/callback/google`
   - Discord: `http://127.0.0.1:5173/auth/callback/discord`
5. Run `pnpm dev` and open **http://127.0.0.1:5173** consistently; do not alternate it with `localhost`. Vite proxies `/auth` and `/api` to Fastify on port 3001, keeping cookies, Origin checks and callbacks on one browser origin. If changing ports, update both `AUTH_ORIGIN`/provider redirects and the proxy target as appropriate. The UI migration prerequisite does not authorize applying it to existing databases.

`AUTH_ENABLED` defaults to false. Enabling authentication without a strong session secret, a valid origin, or any complete provider configuration fails startup. The server loads the root `.env`, including on compiled startup; deployed environment variables can supply the same settings. No production database credentials are required for development or tests.

`AUTH_SESSION_TTL_SECONDS` defaults to 86400 (24 hours), with a validated technical range of 60 seconds to 30 days. Expiry is absolute from creation of the browser session, including its anonymous CSRF/login stage; login rotation and subsequent activity do not extend it. A new visit after expiration creates a fresh anonymous session. These are configurable implementation defaults, not gameplay timing rules. OAuth attempts expire after ten minutes. Starting another attempt replaces the previous pending attempt for that browser session generation; concurrent tabs can require restarting sign-in.

## Protocol and session security

[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) requests only `openid`. Discovery uses the fixed Google issuer; ID tokens require the expected issuer, audience, nonce, valid expiry, and a verified signature using provider keys. The validated `sub` identifies the account. [Discord OAuth](https://docs.discord.com/developers/topics/oauth2) requests only `identify`, then reads the stable numeric user ID from its protected current-user endpoint. Neither flow requests email, offline access, bot, guild, or administrative permissions. Provider tokens exist transiently during the callback and are discarded; neither tokens nor authorization codes are persisted or returned to the browser.

Both flows use authorization code, random state, and PKCE S256 through the library. Google also uses a random nonce. State is persisted server-side, bound to provider, browser session generation, and authenticated linking target, and atomically consumed before exchange. Wrong-provider, wrong-browser, expired, replayed, or changed-account callbacks fail. The callback redirect is fixed to the configured origin; clients cannot supply a return URL.

The maintained session library signs cookies and rotates the session generation at successful sign-in/link completion. PostgreSQL holds identity, private session JSON (including the CSRF secret), absolute expiry, generation, and revocation tombstone. Updates require the expected generation and an unexpired, unrevoked row. Stale writes cannot revive revoked sessions or replace a newer generation. A restart can read persisted sessions using the same session-signing secret. Changing that secret invalidates existing browser cookies. Logout revokes the current session; sign out everywhere revokes the player's persisted sessions. In-flight requests that authenticated before revocation may already be processing; invalidation rejects subsequent requests and conditional session writes.

Cookies are HTTP-only, host-only, Path `/`, SameSite=Lax, and Secure on HTTPS. HTTPS cookies use `__Host-strategy_session`; local HTTP uses `strategy_session`. Production disallows HTTP authentication origins. Mutating account requests require both an exact configured Origin and the session-bound `x-csrf-token`, including login initiation, linking, username selection, and logout. OAuth callbacks use one-use state instead of the POST CSRF token. Account responses disable caching and referrers. Rate limiting is 60 requests per IP per minute in this single server process; tune it with operational evidence before public launch.

The server disables automatic request URL logging and returns/logs generic errors so callback codes, provider errors, tokens, cookies, and secrets are not recorded. Do not add logging of callback query strings or sensitive headers in the reverse proxy or hosting platform.

## Endpoints

All paths are same-origin under `/auth`. JSON bodies are used for POST requests. No endpoint accepts an acting player ID from the client.

| Method / path | Behavior |
|---|---|
| `GET /auth/config` | Enabled flag and configured provider names; works with auth disabled. |
| `GET /auth/csrf` | Obtain CSRF token and initialize the anonymous or existing browser session. |
| `POST /auth/login/:provider` | CSRF-protected initiation for an unauthenticated browser; returns `authorizationUrl`. Authenticated callers must use linking. |
| `GET /auth/callback/:provider` | Validate/consume state, exchange code, sign in or link, rotate session, then redirect. Invalid state returns 400; provider/link errors redirect with generic `authError`. |
| `GET /auth/me` | Current session's public profile as `{ user }`; unauthenticated returns 401. |
| `POST /auth/link/:provider` | Authenticated, CSRF-protected initiation bound to the current identity; returns `authorizationUrl`. |
| `POST /auth/username` | Authenticated initial selection with strict `{ username }`; returns `{ user }`, malformed input 400, name/selection conflicts 409. |
| `POST /auth/logout` | Authenticated, CSRF-protected current-session revocation and cookie clearing; 204. |
| `POST /auth/logout-all` | Authenticated, CSRF-protected account-wide persisted-session revocation and current cookie clearing; 204. |

## Linking and authorization

Uniqueness of `(provider, subject)` prevents duplicate provider ownership, and `(identityId, provider)` permits only one Discord and one Google identity per player. Linking starts only from an authenticated session and requires completion with that session/identity. If the other provider already belongs to another player, linking fails; accounts are never merged or transferred, even if emails happen to match. A previously linked provider signs back into the same internal identity. Account recovery, unlinking, replacing a linked provider, and merging accounts created separately are deliberately unavailable.

The profile and username routes use only the authenticated session's ID. No arbitrary-user or game-data endpoints are introduced. Future match commands must separately check membership, ownership, and visibility, and return only authorized projections; importing an account ID is not sufficient authorization.

## Deployment and remaining work

Serve the frontend and `/auth` through the same HTTPS origin; forward `/auth` to the loopback Fastify server. Set `AUTH_ORIGIN` to that exact HTTPS origin, register its provider callbacks, and configure `AUTH_TRUST_PROXY` with only the actual trusted proxy addresses/CIDRs, comma-separated. Leave it empty for direct local HTTP. The proxy must overwrite forwarded headers and prevent public access to the backend. Do not use unrestricted proxy trust. Keep the same session secret across restarts and supply production secrets through the environment/secret manager. Never include them in the frontend build.

Unit tests use mocked provider HTTP and signed mock Google tokens; they cover state/browser/provider binding, CSRF, cookie flags/tampering, sessions, invalid Google claims/signatures, explicit linking conflicts, logout, and unauthorized profile access. `pnpm test:db` separately exercises real migrated PostgreSQL identity uniqueness/races, linking, username claims, atomic one-use state, new-client session recovery, generation conflicts, expiration, and revocation. Fixture cleanup targets tracked records only. No real Discord/Google credentials or consent flow were exercised; manually verify actual consent, registered redirects, PKCE behavior, and HTTPS/proxy cookies before public deployment.

Follow-up decisions: account recovery/unlinking/renaming/merging policy; whether linking should require a fresh provider sign-in in addition to an existing authenticated session; session duration for production; and retention/pruning of expired attempts, sessions, and revocation tombstones. Expired entries are rejected today but no maintenance scheduler is added. Multi-process rate-limit coordination, deployment monitoring, and game authorization tests belong to later hardening. The existing Prisma PostgreSQL adapter emits a `pg` overlapping-query deprecation warning in the live suite; no driver upgrade is included here.
