import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { TurnReadError } from "@strategy-game/database";
import { ReadFormationsResponseSchema, TurnErrorResponseSchema } from "@strategy-game/shared-types";
import type { ReadFormationsResponse } from "@strategy-game/shared-types";
import type { LobbyPersistence } from "../src/lobbies/routes.js";
import { buildApp } from "../src/app.js";
import { lobbyFixture } from "./lobby-fixture.js";
import { MemoryAuth } from "./memory-auth.js";

const path = "/api/matches/match/formations";
const apps: FastifyInstance[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const app of apps.splice(0)) await app.close(); });
function ready(matchId = "match"): ReadFormationsResponse {
  return { schemaVersion: 1, matchId, state: "READY", formations: [{ schemaVersion: 1,
    formationId: `formation:${"a".repeat(64)}`, ownerPlayerId: "own-player", position: { x: 50, y: 50 },
    units: Array.from({ length: 6 }, (_, i) => ({ schemaVersion: 1, unitId: `unit:${String(i).repeat(64)}`, originalSpawnNodeId: "own-supply",
      ...(i === 0 ? { kind: "LEADER" as const, rank: "LIEUTENANT" as const, specialization: "INFANTRY" as const } : { kind: "INFANTRY" as const }) })) }] };
}
async function fixture() {
  const accounts = new MemoryAuth();
  const getFormations = vi.fn(async (_matchId: string, _identityId: string): Promise<ReadFormationsResponse> => ready());
  const f = await lobbyFixture(accounts, {} as LobbyPersistence, undefined, undefined, undefined, { getFormations }); apps.push(f.app);
  const browser = await f.login();
  return { ...f, accounts, browser, getFormations };
}
function privateHeaders(headers: Record<string, unknown>) {
  expect(headers["cache-control"]).toBe("no-store"); expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
}
describe("006D.1 production GET-only formation boundary", () => {
  it("requires a valid session and completed username before calling the reader", async () => {
    const f = await fixture();
    const anonymous = await f.app.inject({ url: path });
    expect(anonymous.statusCode).toBe(401); expect(anonymous.json()).toEqual({ schemaVersion: 1, error: "UNAUTHENTICATED" }); privateHeaders(anonymous.headers);
    const incomplete = await f.login(null);
    const response = await f.request(incomplete, "GET", path);
    expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ schemaVersion: 1, error: "USERNAME_REQUIRED" }); privateHeaders(response.headers);
    expect(f.getFormations).not.toHaveBeenCalled();
  });
  it.each(["revoked", "expired", "forged-cookie"])("rejects %s sessions before turn lookup", async (kind) => {
    const f = await fixture();
    if (kind === "revoked") await f.accounts.revokeAllSessions(f.browser.identityId);
    if (kind === "expired") for (const [id, session] of f.accounts.sessions) f.accounts.sessions.set(id, { ...session, expiresAt: new Date(0) });
    if (kind === "forged-cookie") f.browser.cookie = "sessionId=untrusted";
    const response = await f.request(f.browser, "GET", path);
    expect(response.statusCode).toBe(401); expect(f.getFormations).not.toHaveBeenCalled(); privateHeaders(response.headers);
  });
  it("passes only the signed session identity and preserves exact own-player projection without CSRF or Origin", async () => {
    const f = await fixture();
    const response = await f.app.inject({ url: `${path}?schemaVersion=1`, headers: { cookie: f.browser.cookie } });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual(ready());
    expect(ReadFormationsResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(f.getFormations).toHaveBeenCalledExactlyOnceWith("match", f.browser.identityId); privateHeaders(response.headers);
  });
  it.each(["NOT_STARTED", "UNINITIALIZED", "UNSUPPORTED"] as const)("preserves explicit %s availability", async (state) => {
    const f = await fixture(); f.getFormations.mockResolvedValue({ schemaVersion: 1, matchId: "match", state });
    const response = await f.request(f.browser, "GET", path);
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ schemaVersion: 1, matchId: "match", state });
  });
  it.each(["outsider", "inactive", "missing", "cross-match"])("uses the same private NOT_FOUND envelope for %s", async () => {
    const f = await fixture(); f.getFormations.mockRejectedValue(new TurnReadError("NOT_FOUND"));
    const response = await f.request(f.browser, "GET", path);
    expect(response.statusCode).toBe(404); expect(response.json()).toEqual({ schemaVersion: 1, error: "NOT_FOUND" }); privateHeaders(response.headers);
  });
  it.each(["schemaVersion=2", "schemaVersion=1&schemaVersion=1", "identityId=other", "playerId=other", "seed=123", "now=1000", "runtime=empty-turn-v1", "extra=x"])("rejects untrusted query %s", async (query) => {
    const f = await fixture(); const response = await f.request(f.browser, "GET", `${path}?${query}`);
    expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ schemaVersion: 1, error: "INVALID_REQUEST" });
    expect(f.getFormations).not.toHaveBeenCalled();
  });
  it("rejects oversized match paths", async () => {
    const f = await fixture(); const response = await f.request(f.browser, "GET", `/api/matches/${"m".repeat(129)}/formations`);
    expect(response.statusCode).toBe(414); expect(f.getFormations).not.toHaveBeenCalled();
  });
  it.each(["exception", "extra-private-field", "malformed-response"])("sanitizes %s without leaking data to response or logs", async (kind) => {
    const f = await fixture(); const secret = "private-seed-session-connection-string";
    if (kind === "exception") f.getFormations.mockRejectedValue(new Error(secret));
    if (kind === "extra-private-field") f.getFormations.mockResolvedValue({ ...ready(), seed: secret } as unknown as ReadFormationsResponse);
    if (kind === "malformed-response") f.getFormations.mockResolvedValue({ schemaVersion: 99, secret } as unknown as ReadFormationsResponse);
    const response = await f.request(f.browser, "GET", path);
    expect(response.statusCode).toBe(500); expect(response.json()).toEqual({ schemaVersion: 1, error: "INTERNAL_ERROR" });
    expect(TurnErrorResponseSchema.safeParse(response.json()).success).toBe(true); privateHeaders(response.headers);
    expect(response.body).not.toContain(secret); expect(f.logs.join("\n")).not.toContain(secret);
    expect(f.logs.join("\n")).not.toContain(f.browser.cookie);
  });
  it("retains rate limits and private error headers", async () => {
    const f = await fixture(); let response = await f.request(f.browser, "GET", path);
    for (let i = 0; i < 65 && response.statusCode !== 429; i++) response = await f.request(f.browser, "GET", path);
    expect(response.statusCode).toBe(429); expect(response.json()).toEqual({ schemaVersion: 1, error: "RATE_LIMITED" }); privateHeaders(response.headers);
  });
  it("works outside test mode but never registers production Ready/command routes", async () => {
    vi.stubEnv("NODE_ENV", "production"); const f = await fixture();
    expect((await f.request(f.browser, "GET", path)).statusCode).toBe(200);
    for (const url of ["/api/matches/match/formations", "/api/matches/match/turns/1/ready", "/api/matches/match/turns/1/orders"]) {
      expect((await f.request(f.browser, "POST", url, { schemaVersion: 1, expectedRevision: 0, ready: true })).statusCode).toBe(404);
    }
    expect(f.getFormations).toHaveBeenCalledTimes(1);
  });
  it("does not expose turn routes when authentication is disabled or no reader is registered", async () => {
    for (const options of [{}, { formationReads: { getFormations: vi.fn() } }]) {
      const app = await buildApp(options); apps.push(app);
      expect((await app.inject({ url: path })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/api/matches/match/turns/1/ready" })).statusCode).toBe(404);
    }
  });
});
