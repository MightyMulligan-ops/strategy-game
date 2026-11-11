# Strategy Game web client

This React/Vite application currently provides Discord/Google login and the player profile page. PixiJS is installed for future map rendering; there is no playable map yet.

Follow the [root Windows setup guide](../../README.md#getting-started-windows) to install dependencies and configure local services. Run commands from the repository root:

```powershell
pnpm dev
```

This prepares internal workspace dependencies and Prisma Client, checks the backend environment, and starts both apps. Open **http://127.0.0.1:5173**. Vite proxies `/auth` to Fastify at `http://127.0.0.1:3001`. Real authentication also requires the [provider/environment setup](../../docs/AUTHENTICATION.md).

`pnpm dev:web` starts only Vite after dependency preparation; account requests still need a separately running backend (`pnpm dev:server`). React source edits hot reload. After editing shared workspace packages, stop and restart development to refresh compiled dependencies. Restart after `.env` changes too.

For intentional port changes, keep the Vite proxy, `AUTH_ORIGIN`, and provider callbacks consistent. Use `127.0.0.1` consistently rather than alternating with `localhost`.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from the root for the documented workspace checks. `pnpm --filter @strategy-game/web preview` previews an existing frontend production build; it does not provide the backend or development auth proxy.
