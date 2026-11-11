import { afterEach, describe, expect, it, vi } from "vitest";
import { WorldError } from "@strategy-game/database";
import type { FastifyInstance } from "fastify";
import { lobbyFixture } from "./lobby-fixture.js";
import { MemoryAuth } from "./memory-auth.js";
import { buildApp } from "../src/app.js";
import type { LobbyPersistence } from "../src/lobbies/routes.js";
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
async function fixture() {
  const accounts = new MemoryAuth();
  const worlds = { getWorld: vi.fn().mockResolvedValue({ schemaVersion: 1, matchId: "fixture", state: "UNINITIALIZED" }) };
  const lobbies = {} as LobbyPersistence; // No lobby operations used in this boundary suite.
  const f = await lobbyFixture(accounts, lobbies, worlds); apps.push(f.app);
  return { ...f, worlds, accounts };
}
describe("world HTTP boundary", () => {
  it("requires normal sessions and username onboarding", async () => {
    const f = await fixture();
    expect((await f.app.inject({ url: "/api/matches/fixture/world" })).statusCode).toBe(401);
    const incomplete = await f.login(null);
    expect((await f.request(incomplete, "GET", "/api/matches/fixture/world")).statusCode).toBe(403);
    expect(f.worlds.getWorld).not.toHaveBeenCalled();
  });
  it("uses only session identity, accepts a read without CSRF/Origin and has no mutation endpoint", async () => {
    const f = await fixture(); const b = await f.login();
    const response = await f.app.inject({ url: "/api/matches/fixture/world", headers: { cookie: b.cookie } });
    expect(response.statusCode).toBe(200); expect(response.json().state).toBe("UNINITIALIZED");
    expect(response.headers["cache-control"]).toBe("no-store"); expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(f.worlds.getWorld).toHaveBeenCalledWith("fixture", b.identityId);
    expect((await f.request(b, "POST", "/api/matches/fixture/world", {})).statusCode).toBe(404);
    const disabled = await buildApp({ worlds: f.worlds }); apps.push(disabled);
    expect((await disabled.inject({ url: "/api/matches/fixture/world" })).statusCode).toBe(404);
  });
  it.each(["?identityId=other", "?schemaVersion=2", "?schemaVersion=1&schemaVersion=1", "?seed=3"])("rejects forged query %s", async (query) => {
    const f = await fixture(); const b = await f.login();
    expect((await f.request(b, "GET", `/api/matches/fixture/world${query}`)).statusCode).toBe(400);
    expect(f.worlds.getWorld).not.toHaveBeenCalled();
  });
  it("does not accept expired or revoked sessions", async () => {
    const f = await fixture(); const b = await f.login();
    for (const [id, s] of f.accounts.sessions) if (s.identityId === b.identityId) f.accounts.sessions.set(id, { ...s, expiresAt: new Date(0) });
    expect((await f.request(b, "GET", "/api/matches/fixture/world")).statusCode).toBe(401);
    expect(f.worlds.getWorld).not.toHaveBeenCalled();
  });
  it("uses identical safe errors for nonmembers/missing matches and sanitizes storage failures", async () => {
    const f = await fixture(); const b = await f.login();
    f.worlds.getWorld.mockRejectedValue(new WorldError("NOT_FOUND"));
    expect((await f.request(b, "GET", "/api/matches/fixture/world")).statusCode).toBe(404);
    f.worlds.getWorld.mockRejectedValue(new Error("private-sql-password"));
    const response = await f.request(b, "GET", "/api/matches/fixture/world");
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain("private-sql"); expect(f.logs.join("")).not.toContain("private-sql");
  });
});
