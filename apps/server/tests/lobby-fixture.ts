import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import type { HTTPMethods } from "fastify";
import type { AuthPersistence } from "@strategy-game/database";
import type { LobbyPersistence } from "../src/lobbies/routes.js";
import type { WorldPersistence } from "../src/worlds/routes.js";
import type { FixtureTurnService } from "../src/turns/service.js";
import type { TurnReadPersistence } from "../src/turns/read-routes.js";
import type { FormationReadPersistence } from "../src/formations/read-routes.js";
import type { MovementDraftPersistence } from "../src/turns/movement-routes.js";
import type { TurnReadyPersistence } from "../src/turns/ready-routes.js";
import { buildApp } from "../src/app.js";
import { readAuthConfig } from "../src/auth/config.js";

export const settings = { name: "Public lobby", playerCapacity: 2, turnDurationMs: 300_000, visibility: "PUBLIC" as const };
export const origin = "http://127.0.0.1:5173";
export type Browser = { cookie: string; csrf: string; remoteAddress?: string };

/** Real cookie/session/CSRF plugins; only the external OAuth provider is mocked. */
export async function lobbyFixture(persistence: AuthPersistence, lobbies: LobbyPersistence, worlds?: WorldPersistence, turnFixtures?: { service: FixtureTurnService }, turnReads?: TurnReadPersistence, formationReads?: FormationReadPersistence, movementDrafts?: MovementDraftPersistence, turnReady?: TurnReadyPersistence) {
  const config = readAuthConfig({ AUTH_ENABLED: "true", AUTH_ORIGIN: origin,
    SESSION_SECRET: "isolated-http-tests-session-signing-secret", GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret" })!;
  const logs: string[] = [];
  const app = await buildApp({ auth: { config, persistence, oauth: {
    async begin() { const state = randomUUID(); return { state, authorizationUrl: `https://provider.example/authorize?state=${state}`, codeVerifier: "p".repeat(43), nonce: "fixture-nonce" }; },
    async complete(_provider, callback) { return callback.searchParams.get("code")!; }
  } }, lobbies, ...(worlds ? { worlds } : {}), ...(turnFixtures ? { turnFixtures } : {}), ...(turnReads ? { turnReads } : {}), ...(formationReads ? { formationReads } : {}), ...(movementDrafts ? { movementDrafts } : {}), ...(turnReady ? { turnReady } : {}), logger: { stream: new Writable({ write(chunk, _encoding, done) { logs.push(String(chunk)); done(); } }) } });
  async function request(browser: Browser, method: HTTPMethods, url: string, payload?: object) {
    const response = await app.inject({ method, url, ...(browser.remoteAddress ? { remoteAddress: browser.remoteAddress } : {}), headers: { cookie: browser.cookie, origin, "x-csrf-token": browser.csrf }, ...(payload ? { payload } : {}) });
    const cookies = response.headers["set-cookie"];
    const cookie = Array.isArray(cookies) ? cookies.at(-1) : cookies;
    if (cookie) browser.cookie = cookie.split(";")[0]!;
    return response;
  }
  async function csrf(browser: Browser) {
    const response = await request(browser, "GET", "/auth/csrf");
    if (response.statusCode !== 200) throw new Error("Fixture CSRF initialization failed");
    browser.csrf = response.json().csrfToken;
  }
  async function login(username: string | null = "Captain_1", subject: string = randomUUID(), remoteAddress?: string) {
    const browser: Browser = { cookie: "", csrf: "", ...(remoteAddress ? { remoteAddress } : {}) };
    await csrf(browser);
    const start = await request(browser, "POST", "/auth/login/google", {});
    if (start.statusCode !== 200) throw new Error("Fixture OAuth initiation failed");
    const state = new URL(start.json().authorizationUrl).searchParams.get("state");
    const callback = await request(browser, "GET", `/auth/callback/google?state=${state}&code=${subject}`);
    if (callback.statusCode !== 303) throw new Error("Fixture sign-in failed");
    await csrf(browser);
    if (username !== null) {
      const selected = await request(browser, "POST", "/auth/username", { username });
      if (selected.statusCode !== 200) throw new Error("Fixture username selection failed");
    }
    const profile = await request(browser, "GET", "/auth/me");
    return { ...browser, identityId: profile.json().user.id as string };
  }
  return { app, request, login, csrf, logs };
}
