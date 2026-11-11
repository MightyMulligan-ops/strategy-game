import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { localTestIdentity } from "@strategy-game/database";
import type { LocalTestPlayer } from "@strategy-game/database";
import { buildApp } from "../src/app.js";
import { readAuthConfig } from "../src/auth/config.js";
import { MemoryAuth } from "./memory-auth.js";
import { localConfig, localEnvironment, localTestFixture } from "./local-test-fixture.js";

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
class LocalMemoryAccounts extends MemoryAuth {
  signInLocalTest = vi.fn(async (fixture: LocalTestPlayer) => {
    const id = localTestIdentity(fixture)!;
    if (!this.users.has(id)) this.users.set(id, { schemaVersion: 1, id, username: null, linkedProviders: [] });
    return this.users.get(id)!;
  });
}
async function fixture() {
  const accounts = new LocalMemoryAccounts(); const f = await localTestFixture(accounts); apps.push(f.app);
  return { ...f, accounts };
}

describe("fail-closed local test login configuration", () => {
  it("remains off by default and requires OAuth in normal enabled mode", () => {
    expect(readAuthConfig({})).toBeUndefined();
    expect(() => readAuthConfig({ ...localEnvironment, AUTH_DEV_LOGIN_ENABLED: "false" })).toThrow("OAuth provider");
    expect(readAuthConfig({ ...localEnvironment, AUTH_DEV_LOGIN_ENABLED: "false", GOOGLE_CLIENT_ID: "fixture-id", GOOGLE_CLIENT_SECRET: "fixture-secret" })?.devLoginEnabled).toBe(false);
    expect(localConfig().providers).toEqual({});
  });
  it.each([
    { NODE_ENV: "production" }, { NODE_ENV: "staging" }, { NODE_ENV: "test" }, { NODE_ENV: "" },
    { AUTH_ENABLED: "false" }, { AUTH_ORIGIN: "https://127.0.0.1:5173" }, { AUTH_ORIGIN: "https://game.example" },
    { AUTH_ORIGIN: "http://localhost:5173" }, { AUTH_ORIGIN: "http://127.0.0.1:5174" }, { AUTH_ORIGIN: "http://127.0.0.1:5173/" },
    { HOST: "0.0.0.0" }, { HOST: "::" }, { HOST: "localhost" }, { AUTH_TRUST_PROXY: "loopback" }, { AUTH_TRUST_PROXY: "true" },
    { AUTH_DEV_LOGIN_ENABLED: "yes" }
  ])("rejects inconsistent/remote settings %j", (change) => { expect(() => readAuthConfig({ ...localEnvironment, ...change })).toThrow(); });
  it("rejects an omitted environment and still enforces the session secret", () => {
    const { NODE_ENV: omitted, ...rest } = localEnvironment; void omitted;
    expect(() => readAuthConfig(rest)).toThrow();
    expect(() => readAuthConfig({ ...localEnvironment, SESSION_SECRET: "short" })).toThrow("SESSION_SECRET");
  });
  it("rejects public/implicit listen calls and proxy trust before binding", async () => {
    const f = await fixture();
    for (const host of ["0.0.0.0", "::", "localhost"]) expect(() => f.app.listen({ host, port: 0 })).toThrow("127.0.0.1");
    expect(() => f.app.listen()).toThrow("127.0.0.1");
    expect(f.app.server.address()).toBeNull();
    await expect(buildApp({ auth: { config: localConfig(), persistence: f.accounts, localTestLogin: f.accounts }, trustProxy: true })).rejects.toThrow("proxy trust");
  });
  it("can bind an isolated memory-fixture server only to explicit loopback", async () => {
    const f = await fixture(); const address = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${address}/auth/config`);
    expect(response.status).toBe(200); expect((await response.json()).devLoginEnabled).toBe(true);
    expect(f.app.server.address()).toMatchObject({ address: "127.0.0.1" });
  });
});

describe("normal-session local test sign-in", () => {
  it("registers no local login endpoint and advertises false in disabled mode", async () => {
    const app = await buildApp(); apps.push(app);
    expect((await app.inject("/auth/config")).json()).toEqual({ enabled: false, providers: [], devLoginEnabled: false });
    expect((await app.inject({ method: "POST", url: "/auth/dev-login", payload: { fixture: "player-one" } })).statusCode).toBe(404);
  });
  it("advertises only a safe boolean with no credentials or allowlist IDs", async () => {
    const f = await fixture(); const response = await f.app.inject({ url: "/auth/config", headers: { host: "127.0.0.1:5173" } });
    expect(response.json()).toEqual({ enabled: true, providers: [], devLoginEnabled: true });
    expect(response.body).not.toMatch(/sessionSecret|sovereign:local-test|player-one|fixture-id/);
  });
  it.each([
    { remoteAddress: "203.0.113.1", headers: { host: "127.0.0.1:5173" } },
    { headers: { host: "evil.example" } }, { headers: { host: "127.0.0.1:5173", "x-forwarded-for": "127.0.0.1" } },
    { headers: { host: "127.0.0.1:5173", "x-forwarded-host": "127.0.0.1:5173" } },
    { headers: { host: "127.0.0.1:5173", forwarded: "for=127.0.0.1;host=127.0.0.1:5173" } }
  ])("rejects raw remote peers/hosts/forwarded overrides %j", async (input) => {
    const f = await fixture(); const load = vi.spyOn(f.accounts, "readSession");
    expect((await f.app.inject({ url: "/auth/csrf", ...input })).statusCode).toBe(403);
    expect(load).not.toHaveBeenCalled(); expect(f.accounts.signInLocalTest).not.toHaveBeenCalled();
  });
  it("requires exact Origin and session CSRF before selecting a fixture", async () => {
    const f = await fixture(); const browser = { cookie: "", csrf: "" }; await f.csrf(browser);
    for (const headers of [
      { host: "127.0.0.1:5173", cookie: browser.cookie, origin: localEnvironment.AUTH_ORIGIN },
      { host: "127.0.0.1:5173", cookie: browser.cookie, origin: localEnvironment.AUTH_ORIGIN, "x-csrf-token": "invalid" },
      { host: "127.0.0.1:5173", cookie: browser.cookie, origin: "https://evil.example", "x-csrf-token": browser.csrf },
      { host: "127.0.0.1:5173", cookie: browser.cookie, "x-csrf-token": browser.csrf }
    ]) {
      const response = await f.app.inject({ method: "POST", url: "/auth/dev-login", headers, payload: { fixture: "player-one" } });
      expect(response.statusCode, `Origin present: ${"origin" in headers}; token present: ${"x-csrf-token" in headers}; ${response.body}`).toBe(403);
    }
    expect(f.accounts.signInLocalTest).not.toHaveBeenCalled();
  });
  it.each([{}, { fixture: "unknown" }, { fixture: "__proto__" }, { fixture: "private-real-account" }, { fixture: "player-one", identityId: "real-id" }, { fixture: "player-one", subject: "google-subject" }])("rejects arbitrary identity selection %j", async (body) => {
    const f = await fixture(); const browser = { cookie: "", csrf: "" }; await f.csrf(browser);
    expect((await f.request(browser, "POST", "/auth/dev-login", body)).statusCode).toBe(400);
    expect(f.accounts.signInLocalTest).not.toHaveBeenCalled();
  });
  it("rotates separate signed sessions, recovers fixtures and keeps normal onboarding/logout semantics", async () => {
    const f = await fixture(); const initial = { cookie: "", csrf: "" }; await f.csrf(initial); const old = initial.cookie;
    const first = await f.signIn("player-one", initial); const second = await f.signIn("player-two");
    expect(first.user.id).not.toBe(second.user.id); expect(first.browser.cookie).not.toBe(old);
    expect(first.user.linkedProviders).toEqual([]); expect(f.accounts.sessions.size).toBeGreaterThan(0);
    const headers = { host: "127.0.0.1:5173", cookie: old };
    expect((await f.app.inject({ url: "/auth/me", headers })).statusCode).toBe(401);
    expect((await f.request(first.browser, "POST", "/auth/username", { username: "FixtureOne" })).statusCode).toBe(200);
    expect((await f.request(first.browser, "POST", "/auth/dev-login", { fixture: "player-two" })).statusCode).toBe(409);
    expect((await f.request(first.browser, "POST", "/auth/logout", {})).statusCode).toBe(204);
    const again = await f.signIn("player-one"); expect(again.user.id).toBe(first.user.id); expect(again.user.username).toBe("FixtureOne");
    expect((await f.request(second.browser, "GET", "/auth/me")).json().user.id).toBe(second.user.id);
    await f.request(again.browser, "POST", "/auth/logout-all", {});
    expect((await f.request(again.browser, "GET", "/auth/me")).statusCode).toBe(401);
  });
  it("disabling local mode rejects existing fixture cookies without deleting persisted sessions", async () => {
    const f = await fixture(); const one = await f.signIn("player-one"); const before = f.accounts.sessions.size;
    const config = readAuthConfig({ ...localEnvironment, AUTH_DEV_LOGIN_ENABLED: "false", GOOGLE_CLIENT_ID: "fixture-id", GOOGLE_CLIENT_SECRET: "fixture-secret" })!;
    const app = await buildApp({ auth: { config, persistence: f.accounts } }); apps.push(app);
    expect((await app.inject({ url: "/auth/me", headers: { cookie: one.browser.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/auth/config" })).json().devLoginEnabled).toBe(false);
    expect((await app.inject({ method: "POST", url: "/auth/dev-login", headers: { origin: config.origin }, payload: { fixture: "player-one" } })).statusCode).toBe(404);
    expect(f.accounts.sessions.size).toBe(before);
  });
  it("rejects an unexpected persistence mapping instead of issuing an impersonation session", async () => {
    const f = await fixture(); const browser = { cookie: "", csrf: "" }; await f.csrf(browser);
    f.accounts.signInLocalTest.mockResolvedValue({ schemaVersion: 1, id: "real-account-id", username: "RealUser", linkedProviders: ["google"] });
    expect((await f.request(browser, "POST", "/auth/dev-login", { fixture: "player-one" })).statusCode).toBe(409);
    expect((await f.request(browser, "GET", "/auth/me")).statusCode).toBe(401);
  });
});
