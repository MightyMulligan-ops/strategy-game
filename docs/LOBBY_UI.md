# Sovereign lobby and account shell (004B.2D / Issue #13)

The React client provides public lobby browsing, creation, joining/leaving, player readiness and host-only lifecycle start alongside account flows. Sovereign branding remains unchanged. A RUNNING lobby has no world, Turn 1, map, scheduler, presence or playable match yet.

## Account and API boundaries

When the server advertises boolean `devLoginEnabled: true`, anonymous users also see Local test sign-in with two fixed fixture choices. This opt-in tool uses normal session rotation/bootstrap and username onboarding; no Vite flag, arbitrary account input or identity-header override enables it. Fixture provider linking is prohibited server-side. See [LOCAL_TEST_LOGIN.md](LOCAL_TEST_LOGIN.md) for strict gates and manual sandbox-only instructions. Existing Google/Discord, profile and lobby flows remain intact.

`apps/web/src/App.tsx` retains configured-provider sign-in, callback error handling, username validation/conflicts, linking, current-session logout and account-wide logout. Initial configuration → CSRF → own-profile requests remain sequenced so the first visit shares one cookie. Callback navigation reloads the app and fetches a new session token. Unauthenticated users see login; accounts with a null username see onboarding; only registered users mount `LobbyBrowser`.

`LobbyBrowser.tsx` uses the [seven version-1 APIs](LOBBY_API.md). The list shows OPEN lobbies and ready/active counts; details show each player's READY/NOT READY state. Refreshes are explicit, so another browser's action appears after Refresh details/list. Creation uses shared validation: trimmed name, 2–40 players including host, duration presets, PUBLIC only. Responses use strict shared schemas. No account IDs are accepted as authority, persisted in browser storage or rendered in lobby metadata.

`lobby-api.ts` sends credentials `same-origin` and `cache: no-store`. Every explicit lobby POST first fetches a fresh `/auth/csrf` token and sends it in `x-csrf-token`; no token is persisted or shared across navigation. The browser supplies Origin. A shared synchronous action guard blocks repeated submissions and conflicting account/lobby actions while pending. There are no automatic mutation retries or polling loops.

Every successful lobby action reloads list/detail. State-conflict errors, including NOT_ALL_READY/NOT_ENOUGH_PARTICIPANTS/HOST_REQUIRED, explain the failure and refresh authoritative state without retrying the mutation. Join/Leave use server viewer flags. Active members in OPEN see Mark ready / Mark not ready; the body sets an explicit own boolean. Only hosts see Start Match, disabled unless server canStart is true, with reasons for insufficient players, host not ready, waiting for others or already started. RUNNING removes membership/readiness controls and disables host Start. STARTED/ALREADY_STARTED notices make no gameplay claim. Session failures recover account state; malformed/private errors remain sanitized.

AbortControllers cancel superseded reads and unmounted effects. Aborted responses are checked before state updates, including after asynchronous account recovery. Bootstrap work is cancellable in React StrictMode. Loading, empty, unavailable, validation, permission and pending states are visible; nothing fabricates successful multiplayer state.

## Same-origin development

Vite forwards both `/auth` and `/api` to `http://127.0.0.1:3001`, keeping the backend on loopback and retaining the browser's configured Origin. No CORS exemption, public backend listener or custom publicDir is introduced. Use the normal `http://127.0.0.1:5173` address and existing provider callbacks. Vite preview remains a static build preview; it does not provide the backend/proxy for production.

**The existing development database still lacks the lobby migration, and this issue does not approve applying it.** Missing schema/services display a safe unavailable message. Do not run migration/reset/push commands against existing development/test databases to exercise this UI. Full real-provider/real-database manual testing awaits separately approved setup. This task's browser checks used an isolated mock HTTP backend, never the existing database or backend service. Hosted CI continues its existing disposable PostgreSQL tests.

## Verified original branding

The entire former repository-root `public/assets/branding/` directory is moved with Git to **`apps/web/public/assets/branding/`**. All 15 tracked files, including the original README.md/README.txt and palette, are preserved byte for byte; SHA-256 hashes were compared before/after. There is no duplicate root copy or artwork rewrite.

| Actual files | Use / audit result |
|---|---|
| `emblem.svg`, `wordmark.svg` | Original crowned globe and silver lettering; used directly as separate images at `/assets/branding/…` |
| `favicon.svg`, `favicon.png` | Verified present; original SVG used as the page favicon |
| `primary_logo.svg/.png`, `horizontal_logo.svg/.png`, `app_icon.svg/.png` | Verified original underscore-named exports, relocated intact |
| `emblem.png`, `wordmark.png`, `brand_palette.txt`, `README.md`, `README.txt` | Relocated intact |

The older asset README is intentionally preserved and still lists hyphen-named `primary-logo.svg`, `horizontal-logo.svg` and `app-icon.png`; those exact names are absent. Its earlier statement that artwork is not included is historical. The inventory above reflects actual files. No missing-export placeholder, generated logo, alias or external substitute is used; the required original emblem and wordmark are sufficient for these layouts. Chromium verified both SVG URLs return 200 with identical file bytes and nonzero rendered image dimensions.

Reusable CSS tokens use the approved palette: Imperial Gold `#D4AF37`, Steel Silver `#C9CDD6`, Slate Navy `#0E1A26`, Charcoal `#0A0F16`, Off White `#E8EAEF`. Secondary borders/surfaces are derived accents. Original SVG colors/contents remain unchanged. No new font, component library, router, image-generation or external asset dependency is added.

## Accessibility and verification

Inputs have visible labels/help, native constraints and shared-schema validation. Keyboard focus uses a 3px gold outline; controls target at least 44px height. Status/alerts use live regions, data panels expose busy states, text/rosters wrap, layouts stack on small screens, and reduced-motion preferences disable transitions. Account controls remain available in the registered layout and below the workspace on mobile.

Frontend tests in `apps/web/src/App.test.tsx` use React DOM/act and **jsdom 26.1.0**, the only new test dependency. Its Node >=18 requirement preserves the repository's existing supported Node range; it is pinned for reproducibility. No testing/component library is needed. Tests cover login/provider availability, onboarding/conflicts, profile linking and both logout modes, list/detail/create/join/leave, fresh CSRF per action, strict response validation, empty/loading/error states, server authorization outcomes, duplicate prevention and StrictMode cleanup.

Local Chromium smoke checks rendered the real Vite app against an isolated mock HTTP server. They verified login navigation, onboarding, join/leave, preserved proxy Origin, changing CSRF tokens, original SVG rendering/bytes, visible keyboard focus, zero page errors and no horizontal overflow at 320/390/768/1440px. Desktop/mobile screenshots were reviewed locally; they show test fixtures, not a claim of live multiplayer data. Temporary browser tools/screenshots stay under ignored `.cache/issue-13/` and are not runtime dependencies or committed assets.

Required checks: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `git diff --check`. Ordinary tests intentionally skip live PostgreSQL suites; no local DB-backed verification or existing-database writes are performed for this frontend change. Real OAuth consent, HTTPS deployment behavior and live UI-to-database testing remain separate verification after owner-approved environment preparation.

Issue #17 adds readiness/start UI tests and a local Chromium smoke check with two independent browser contexts against a new in-memory HTTP fixture through Vite. Verified own ready/unready, host-only Start, disabled reasons, stale NOT_ALL_READY refresh without retry, RUNNING state after start/refresh, fresh CSRF and preserved Origin. No page errors or horizontal overflow at 320/390/768/1440px; desktop/mobile screenshots were inspected under ignored `.cache/issue-17/`. This verifies client behavior with fixtures, not real PostgreSQL or sandbox acceptance. No new dependencies or artwork changes were needed.
