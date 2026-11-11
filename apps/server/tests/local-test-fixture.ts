import type { AuthPersistence, LocalTestLoginPersistence, LocalTestPlayer } from "@strategy-game/database";
import type { LobbyPersistence } from "../src/lobbies/routes.js";
import type { HTTPMethods } from "fastify";
import { buildApp } from "../src/app.js";
import { readAuthConfig } from "../src/auth/config.js";

export const localEnvironment = {
  AUTH_ENABLED: "true", AUTH_DEV_LOGIN_ENABLED: "true", NODE_ENV: "development",
  AUTH_ORIGIN: "http://127.0.0.1:5173", SESSION_SECRET: "unit-fixtures-only-local-session-signing-secret"
};
export const localConfig = () => readAuthConfig(localEnvironment)!;
export type LocalBrowser = { cookie: string; csrf: string };
export async function localTestFixture(accounts: AuthPersistence & LocalTestLoginPersistence, lobbies?: LobbyPersistence) {
  const app = await buildApp({ auth: { config: localConfig(), persistence: accounts, localTestLogin: accounts }, ...(lobbies ? { lobbies } : {}) });
  async function request(browser: LocalBrowser, method: HTTPMethods, url: string, payload?: object) {
    const response = await app.inject({ method, url, headers: { host: "127.0.0.1:5173", origin: localEnvironment.AUTH_ORIGIN,
      cookie: browser.cookie, "x-csrf-token": browser.csrf }, ...(payload ? { payload } : {}) });
    const cookies = response.headers["set-cookie"];
    const cookie = Array.isArray(cookies) ? cookies.at(-1) : cookies;
    if (cookie) browser.cookie = cookie.split(";")[0]!;
    return response;
  }
  async function csrf(browser: LocalBrowser) {
    const response = await request(browser, "GET", "/auth/csrf");
    if (response.statusCode !== 200) throw new Error("Fixture CSRF initialization failed");
    browser.csrf = response.json().csrfToken;
  }
  async function signIn(player: LocalTestPlayer, browser: LocalBrowser = { cookie: "", csrf: "" }) {
    await csrf(browser);
    const response = await request(browser, "POST", "/auth/dev-login", { fixture: player });
    if (response.statusCode !== 200) throw new Error("Local fixture sign-in failed");
    await csrf(browser);
    return { browser, user: response.json().user as { id: string; username: string | null; linkedProviders: string[] } };
  }
  return { app, request, csrf, signIn };
}
