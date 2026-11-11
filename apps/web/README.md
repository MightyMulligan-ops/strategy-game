# Sovereign web client

This React/Vite application provides Sovereign-branded Discord/Google login, username onboarding, profile/link/logout controls and a public lobby browser. Registered users can inspect, create, join and leave lobbies through the existing authenticated APIs. PixiJS is installed for future map rendering; no map or match-start action is implemented.

Follow the [root Windows setup guide](../../README.md#getting-started-windows) to install dependencies and configure local services. Run commands from the repository root:

```powershell
pnpm dev
```

This prepares internal workspace dependencies and Prisma Client, checks the backend environment, and starts both apps. Open **http://127.0.0.1:5173**. Vite proxies `/auth` and `/api` to Fastify at `http://127.0.0.1:3001` with the same browser origin. Real authentication requires the [provider/environment setup](../../docs/AUTHENTICATION.md). The existing development DB still lacks the lobby migration, which is not approved for application in this issue. Missing schema/services show safe unavailable states; do not migrate/reset existing databases to try the UI.

`pnpm dev:web` starts only Vite after dependency preparation; account requests still need a separately running backend (`pnpm dev:server`). React source edits hot reload. After editing shared workspace packages, stop and restart development to refresh compiled dependencies. Restart after `.env` changes too.

For intentional port changes, keep the Vite proxy, `AUTH_ORIGIN`, and provider callbacks consistent. Use `127.0.0.1` consistently rather than alternating with `localhost`.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from the root for the documented workspace checks. `pnpm --filter @strategy-game/web preview` previews an existing frontend production build; it does not provide the backend or development auth proxy.

Branding lives in `apps/web/public/assets/branding/`, served at `/assets/branding/`. All 15 original tracked files were relocated unchanged; the app uses the actual `emblem.svg`, `wordmark.svg` and `favicon.svg`. See [LOBBY_UI.md](../../docs/LOBBY_UI.md) for the verified inventory, original README naming discrepancies, CSRF/state handling and accessibility. The sole new test dependency is pinned jsdom 26.1.0 for React DOM tests; no router or UI library was added. Local Chromium verification used isolated mock HTTP fixtures, never existing databases or real provider consent.
