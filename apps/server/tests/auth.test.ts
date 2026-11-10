import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, HTTPMethods } from "fastify";
import { buildApp } from "../src/app.js";
import { readAuthConfig } from "../src/auth/config.js";
import { MemoryAuth } from "./memory-auth.js";

const config = readAuthConfig({ AUTH_ENABLED: "true", AUTH_ORIGIN: "http://127.0.0.1:5173",
  SESSION_SECRET: "unit-test-session-secret-with-sufficient-length", GOOGLE_CLIENT_ID: "google-client", GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-client", DISCORD_CLIENT_SECRET: "discord-secret" })!;
const applications: FastifyInstance[] = [];
afterEach(async () => { for (const app of applications.splice(0)) await app.close(); });

async function fixture(secure = false) {
  const persistence = new MemoryAuth();
  const complete = vi.fn(async (provider: string) => `${provider}-subject`);
  const oauth = {
    begin: vi.fn(async () => { const state = randomUUID(); return {
      state, authorizationUrl: `https://provider.example/authorize?state=${state}`, codeVerifier: "p".repeat(43), nonce: "nonce"
    }; }), complete
  };
  const logs: string[] = [];
  const app = await buildApp({ auth: { config: { ...config, ...(secure ? { origin: "https://game.example", secureCookies: true } : {}) }, persistence, oauth },
    trustProxy: secure ? "loopback" : false,
    logger: { stream: new Writable({ write(chunk, _encoding, done) { logs.push(String(chunk)); done(); } }) }
  });
  applications.push(app);
  const origin = secure ? "https://game.example" : config.origin;
  type Browser = { cookie: string; csrf: string };
  const browser = (): Browser => ({ cookie: "", csrf: "" });
  async function request(client: Browser, method: HTTPMethods, url: string, payload?: object) {
    const response = await app.inject({ method, url, headers: {
      cookie: client.cookie, origin, "x-csrf-token": client.csrf,
      ...(secure ? { "x-forwarded-proto": "https" } : {})
    }, ...(payload ? { payload } : {}) });
    const header = response.headers["set-cookie"];
    const value = Array.isArray(header) ? header[header.length - 1] : header;
    if (value) client.cookie = value.split(";")[0]!;
    return response;
  }
  async function csrf(client: Browser) {
    const response = await request(client, "GET", "/auth/csrf");
    expect(response.statusCode).toBe(200); client.csrf = response.json().csrfToken as string; return response;
  }
  async function begin(client: Browser, provider = "google", linking = false) {
    await csrf(client);
    const response = await request(client, "POST", `/auth/${linking ? "link" : "login"}/${provider}`, {});
    expect(response.statusCode).toBe(200);
    return new URL(response.json().authorizationUrl as string).searchParams.get("state")!;
  }
  async function login(client: Browser, provider = "google") {
    const state = await begin(client, provider);
    const response = await request(client, "GET", `/auth/callback/${provider}?state=${state}&code=private-code`);
    expect(response.statusCode).toBe(303); expect(response.headers.location).toBe(`${origin}/`);
    await csrf(client);
    return (await request(client, "GET", "/auth/me")).json().user as { id: string; username: string | null; linkedProviders: string[] };
  }
  return { app, persistence, complete, logs, browser, request, csrf, begin, login, origin };
}

describe("authentication HTTP boundaries with mocked providers", () => {
  it("supports health without configuring authentication", async () => {
    const app = await buildApp(); applications.push(app);
    expect((await app.inject("/health")).statusCode).toBe(200);
    expect((await app.inject("/auth/me")).statusCode).toBe(401);
  });

  it("requires both same-origin requests and CSRF tokens before starting login", async () => {
    const f = await fixture(); const browser = f.browser(); await f.csrf(browser);
    const missing = await f.app.inject({ method: "POST", url: "/auth/login/google", headers: { cookie: browser.cookie, origin: f.origin }, payload: {} });
    expect(missing.statusCode).toBe(403);
    const wrongOrigin = await f.app.inject({ method: "POST", url: "/auth/login/google", headers: { cookie: browser.cookie, origin: "https://evil.example", "x-csrf-token": browser.csrf }, payload: {} });
    expect(wrongOrigin.statusCode).toBe(403); expect(f.persistence.attempts.size).toBe(0);
    expect((await f.request(browser, "GET", "/auth/login/google")).statusCode).toBe(404);
  });

  it("rejects missing, mismatched, wrong-browser, and mixed-provider OAuth state", async () => {
    const f = await fixture(); const browser = f.browser(); const state = await f.begin(browser);
    const other = f.browser(); await f.csrf(other);
    for (const [client, url] of [
      [browser, "/auth/callback/google?code=private-code"],
      [browser, "/auth/callback/google?state=wrong&code=private-code"],
      [other, `/auth/callback/google?state=${state}&code=private-code`],
      [browser, `/auth/callback/discord?state=${state}&code=private-code`]
    ] as const) expect((await f.request(client, "GET", url)).statusCode).toBe(400);
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("expires state, consumes it once, and rotates the pre-login cookie", async () => {
    const f = await fixture(); const browser = f.browser();
    const expiredState = await f.begin(browser);
    f.persistence.attempts.set(expiredState, { ...f.persistence.attempts.get(expiredState)!, expiresAt: new Date(0) });
    expect((await f.request(browser, "GET", `/auth/callback/google?state=${expiredState}&code=private-code`)).statusCode).toBe(400);
    const state = await f.begin(browser); const oldCookie = browser.cookie;
    expect((await f.request(browser, "GET", `/auth/callback/google?state=${state}&code=private-code`)).statusCode).toBe(303);
    expect(browser.cookie).not.toBe(oldCookie);
    expect((await f.request(browser, "GET", `/auth/callback/google?state=${state}&code=private-code`)).statusCode).toBe(400);
    expect((await f.app.inject({ url: "/auth/me", headers: { cookie: oldCookie } })).statusCode).toBe(401);
  });

  it("uses HTTP-only cookies with production Secure, host scope, and SameSite=Lax", async () => {
    const local = await fixture(); const client = local.browser(); const response = await local.csrf(client);
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(response.headers["set-cookie"])).toContain("SameSite=Lax");
    expect(String(response.headers["set-cookie"])).not.toContain("; Secure");
    const production = await fixture(true); const secure = await production.csrf(production.browser());
    expect(String(secure.headers["set-cookie"])).toContain("__Host-strategy_session=");
    expect(String(secure.headers["set-cookie"])).toContain("; Secure");
    expect(String(secure.headers["set-cookie"])).not.toContain("Domain=");
  });

  it("returns only the current player's safe profile and validates username ownership", async () => {
    const f = await fixture(); const browser = f.browser();
    expect((await f.request(browser, "GET", "/auth/me")).statusCode).toBe(401);
    const user = await f.login(browser);
    expect((await f.request(browser, "POST", "/auth/username", { username: "Captain_1", identityId: "someone-else" })).statusCode).toBe(400);
    expect((await f.request(browser, "POST", "/auth/username", { username: "Captain_1" })).json()).toMatchObject({ user: { id: user.id, username: "Captain_1" } });
    expect((await f.request(browser, "GET", `/auth/users/someone-else`)).statusCode).toBe(404);
    expect((await f.request(browser, "GET", "/matches/private/orders")).statusCode).toBe(404);
    expect((await f.request(browser, "GET", "/auth/me")).json().user).toEqual({ schemaVersion: 1, id: user.id, username: "Captain_1", linkedProviders: ["google"] });
  });

  it("requires authenticated, CSRF-protected linking and keeps one stable internal identity", async () => {
    const f = await fixture(); const browser = f.browser(); await f.csrf(browser);
    expect((await f.request(browser, "POST", "/auth/link/discord", {})).statusCode).toBe(401);
    const user = await f.login(browser);
    const state = await f.begin(browser, "discord", true);
    expect((await f.request(browser, "GET", `/auth/callback/discord?state=${state}&code=private-code`)).statusCode).toBe(303);
    expect((await f.request(browser, "GET", "/auth/me")).json().user).toMatchObject({ id: user.id, linkedProviders: ["discord", "google"] });
  });

  it("does not transfer or merge a provider identity already owned by another player", async () => {
    const f = await fixture(); const first = f.browser(); const second = f.browser();
    const user = await f.login(first, "google"); const other = await f.login(second, "discord");
    expect(user.id).not.toBe(other.id);
    const state = await f.begin(first, "discord", true);
    const response = await f.request(first, "GET", `/auth/callback/discord?state=${state}&code=private-code`);
    expect(response.headers.location).toContain("authError=signin_failed");
    expect((await f.request(first, "GET", "/auth/me")).json().user.id).toBe(user.id);
    expect((await f.request(second, "GET", "/auth/me")).json().user.id).toBe(other.id);
  });

  it("protects every authenticated mutation against CSRF and tampered cookies", async () => {
    const f = await fixture(); const browser = f.browser(); await f.login(browser);
    for (const url of ["/auth/link/discord", "/auth/username", "/auth/logout", "/auth/logout-all"]) {
      const response = await f.app.inject({ method: "POST", url, headers: { cookie: browser.cookie, origin: f.origin }, payload: { username: "Captain" } });
      expect(response.statusCode).toBe(403);
    }
    expect((await f.request(browser, "GET", "/auth/me")).statusCode).toBe(200);
    const tampered = `${browser.cookie.slice(0, -1)}!`;
    expect((await f.app.inject({ url: "/auth/me", headers: { cookie: tampered } })).statusCode).toBe(401);
    expect((await f.request(browser, "GET", "/auth/logout")).statusCode).toBe(404);
  });

  it("rejects a linking callback after its authenticated session has been revoked", async () => {
    const f = await fixture(); const browser = f.browser(); const user = await f.login(browser);
    const state = await f.begin(browser, "discord", true);
    const oldCookie = browser.cookie;
    await f.request(browser, "POST", "/auth/logout", {});
    const response = await f.app.inject({ url: `/auth/callback/discord?state=${state}&code=private-code`, headers: { cookie: oldCookie } });
    expect(response.statusCode).toBe(400);
    expect((await f.persistence.profile(user.id))?.linkedProviders).toEqual(["google"]);
  });

  it("revokes logout sessions and all-session invalidation, rejecting stale updates", async () => {
    const f = await fixture(); const first = f.browser(); const second = f.browser();
    await f.login(first); await f.login(second);
    const oldCookie = first.cookie;
    expect((await f.request(first, "POST", "/auth/logout", {})).statusCode).toBe(204);
    expect((await f.app.inject({ url: "/auth/me", headers: { cookie: oldCookie } })).statusCode).toBe(401);
    expect((await f.request(second, "GET", "/auth/me")).statusCode).toBe(200);
    await f.login(first);
    expect((await f.request(first, "POST", "/auth/logout-all", {})).statusCode).toBe(204);
    expect((await f.request(second, "GET", "/auth/me")).statusCode).toBe(401);
  });

  it("enforces server expiry and never logs codes or sensitive provider errors", async () => {
    const f = await fixture(); const browser = f.browser(); await f.login(browser);
    for (const [id, stored] of f.persistence.sessions) f.persistence.sessions.set(id, { ...stored, expiresAt: new Date(0) });
    expect((await f.request(browser, "GET", "/auth/me")).statusCode).toBe(401);
    const state = await f.begin(browser);
    f.complete.mockRejectedValueOnce(new Error("secret-access-token secret-refresh-token private-code"));
    const response = await f.request(browser, "GET", `/auth/callback/google?state=${state}&code=private-code`);
    expect(response.headers.location).toContain("authError=signin_failed");
    expect(response.body + f.logs.join("")).not.toMatch(/secret-access-token|secret-refresh-token|private-code/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });
});
