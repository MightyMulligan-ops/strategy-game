import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { applyTurnCommand } from "../../../packages/game-engine/dist/index.js";
import { ReadTurnResponseSchema, SetTurnReadyResponseSchema, TurnErrorResponseSchema } from "@strategy-game/shared-types";
import { buildApp } from "../src/app.js";
import { FixtureTurnService } from "../src/turns/service.js";
import { lobbyFixture, origin } from "./lobby-fixture.js";
import type { LobbyPersistence } from "../src/lobbies/routes.js";
import { MemoryAuth } from "./memory-auth.js";
import { MemoryTurns, memoryMatch } from "./memory-turns.js";

const readPath = "/api/matches/match/turn";
const readyPath = "/api/matches/match/turns/1/ready";
const body = (expectedRevision = 0, ready = true) => ({ schemaVersion: 1, expectedRevision, ready });
const apps: FastifyInstance[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const app of apps.splice(0)) await app.close(); });
async function fixture(count = 2) {
  const accounts = new MemoryAuth(); const store = new MemoryTurns(); let now = 1_000;
  const clock = vi.fn(() => now); const service = new FixtureTurnService(store, clock);
  const worlds = { getWorld: vi.fn(async (_matchId: string, _identityId: string) => ({ schemaVersion: 1 as const, matchId: "legacy", state: "UNINITIALIZED" as const })) };
  const f = await lobbyFixture(accounts, {} as LobbyPersistence, worlds, { service }); apps.push(f.app);
  const browsers = await Promise.all(Array.from({ length: count }, (_, i) => f.login(`Player_${i}`, `subject-${i}`, `192.0.2.${i + 1}`)));
  store.matches.set("match", memoryMatch("match", browsers.map((b) => b.identityId)));
  return { ...f, accounts, store, service, browsers, worlds, clock, setTime(value: number) { now = value; }, match: () => store.matches.get("match")! };
}

describe("006A participant-authorized turn boundary", () => {
  it("requires sessions and completed onboarding before touching turn storage", async () => {
    const f = await fixture();
    expect((await f.app.inject({ url: readPath })).statusCode).toBe(401);
    expect((await f.app.inject({ method: "POST", url: readyPath, headers: { origin }, payload: body() })).statusCode).toBe(401);
    const incomplete = await f.login(null);
    for (const [method, url, payload] of [["GET", readPath, undefined], ["POST", readyPath, body()]] as const) {
      const response = await f.request(incomplete, method, url, payload);
      expect(response.statusCode).toBe(403); expect(response.json().error).toBe("USERNAME_REQUIRED");
    }
    expect(f.store.reads).toBe(0); expect(f.clock).not.toHaveBeenCalled();
  });
  it("rejects expired and revoked sessions", async () => {
    const f = await fixture(); const browser = f.browsers[0]!;
    await f.accounts.revokeAllSessions(browser.identityId);
    expect((await f.request(browser, "GET", readPath)).statusCode).toBe(401);
    const other = f.browsers[1]!;
    for (const [id, session] of f.accounts.sessions) if (session.identityId === other.identityId) f.accounts.sessions.set(id, { ...session, expiresAt: new Date(0) });
    expect((await f.request(other, "POST", readyPath, body())).statusCode).toBe(401);
    expect(f.store.reads).toBe(0);
  });
  it("uses identical private errors for outsiders, inactive members, cross-match access and missing matches", async () => {
    const f = await fixture(); const outsider = await f.login("Outsider");
    f.match().participants[1]!.active = false;
    f.store.matches.set("other", memoryMatch("other", [outsider.identityId]));
    for (const browser of [outsider, f.browsers[1]!]) {
      for (const path of [readPath, "/api/matches/missing/turn"]) {
        const response = await f.request(browser, "GET", path);
        expect(response.statusCode).toBe(404); expect(response.json()).toEqual({ schemaVersion: 1, error: "NOT_FOUND" });
      }
      const response = await f.request(browser, "POST", readyPath, body());
      expect(response.statusCode).toBe(404); expect(response.json()).toEqual({ schemaVersion: 1, error: "NOT_FOUND" });
    }
    expect(f.store.writes).toBe(0); expect(f.clock).not.toHaveBeenCalled();
  });
  it("projects only the authenticated player's private draft, with no roster, seed, pins or frozen inputs", async () => {
    const f = await fixture(); let state = f.match().state!;
    for (const [playerId, orderId] of [["local-0", "my-private-order"], ["local-1", "enemy-private-order"]]) {
      state = applyTurnCommand(state, playerId!, { schemaVersion: 1, gameId: "match", turnNumber: 1, kind: "replace_orders", expectedRevision: 0,
        orders: [{ orderId, type: "attack", stackId: `stack-${orderId}`, targetId: `target-${orderId}` }] }, 1_000).state;
    }
    Object.assign(f.match(), { state });
    const response = await f.app.inject({ url: readPath, headers: { cookie: f.browsers[0]!.cookie } });
    expect(response.statusCode).toBe(200); const view = ReadTurnResponseSchema.parse(response.json());
    expect(view.state).toBe("READY"); expect(response.body).toContain("my-private-order");
    for (const value of ["enemy-private-order", "identityId", "playerId", "players", "drafts", "seed", "snapshot", "ruleset", "simulationVersion", "frozen", ...f.browsers.map((b) => b.identityId)]) expect(response.body).not.toContain(value);
    expect(response.headers["cache-control"]).toBe("no-store"); expect(response.headers["referrer-policy"]).toBe("no-referrer"); expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(f.store.writes).toBe(0); expect(f.clock).not.toHaveBeenCalled();
  });
  it("checks membership before disclosing no-turn or not-started availability", async () => {
    const f = await fixture(); const browser = f.browsers[0]!;
    f.match().participants[0]!.active = false;
    for (const status of ["OPEN", "RUNNING"] as const) {
      Object.assign(f.match(), { status, state: null });
      expect((await f.request(browser, "GET", readPath)).json()).toEqual({ schemaVersion: 1, error: "NOT_FOUND" });
      expect((await f.request(browser, "POST", readyPath, body())).json()).toEqual({ schemaVersion: 1, error: "NOT_FOUND" });
    }
    expect(f.store.writes).toBe(0); expect(f.clock).not.toHaveBeenCalled();
  });
  it.each([2, 4, 10, 40])("supports %i-player Ready/unready, revision conflicts and one unanimous closure", async (count) => {
    const f = await fixture(count); const first = f.browsers[0]!;
    const initial = await f.request(first, "GET", readPath);
    expect(initial.json().own).toMatchObject({ revision: 0, ready: false, orders: [] });
    const lobbyFlags = f.match().participants.map((p) => p.lobbyReady);
    expect((await f.request(first, "POST", readyPath, body())).json().own).toMatchObject({ ready: true, revision: 1 });
    expect((await f.request(first, "POST", readyPath, body(1, false))).json().own).toMatchObject({ ready: false, revision: 2 });
    const stale = await f.request(first, "POST", readyPath, body(0));
    expect(stale.statusCode).toBe(409); expect(stale.json().error).toBe("STALE_REVISION");
    const responses = await Promise.all(f.browsers.map((browser, i) => f.request(browser, "POST", readyPath, body(i === 0 ? 2 : 0))));
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    responses.forEach((r) => expect(SetTurnReadyResponseSchema.safeParse(r.json()).success).toBe(true));
    expect(responses.filter((r) => r.json().turn.status === "closed")).toHaveLength(1);
    expect(f.match().closures).toBe(1); expect(f.match().frozen?.playerOrders).toHaveLength(count);
    expect(f.match().state!.turn).toMatchObject({ status: "closed", closeReason: "all_ready", closedAtMs: 1_000 });
    expect((await f.request(first, "POST", readyPath, body(3, false))).json().error).toBe("TURN_CLOSED");
    expect(f.match().closures).toBe(1); expect(f.match().participants.map((p) => p.lobbyReady)).toEqual(lobbyFlags);
    expect(f.match().state!.drafts.every((p) => p.ready && p.orders.length === 0)).toBe(true);
  });
  it("serializes competing revisions for one player without lost updates", async () => {
    const f = await fixture(); const browser = f.browsers[0]!;
    const responses = await Promise.all([true, false].map((ready) => f.request(browser, "POST", readyPath, body(0, ready))));
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const accepted = responses.find((r) => r.statusCode === 200)!.json().own;
    expect(f.match().state!.drafts[0]).toMatchObject({ ready: accepted.ready, revision: 1 });
  });
  it("honors the exact deadline over final Ready, commits rejection closure and never closes from GET", async () => {
    const f = await fixture();
    await f.request(f.browsers[0]!, "POST", readyPath, body()); f.setTime(2_000);
    const before = await f.request(f.browsers[1]!, "GET", readPath);
    expect(before.json().turn.status).toBe("open"); expect(f.match().closures).toBe(0);
    const response = await f.request(f.browsers[1]!, "POST", readyPath, body());
    expect(response.statusCode).toBe(409); expect(response.json().error).toBe("TURN_CLOSED");
    expect(f.match().state!.turn).toMatchObject({ status: "closed", closeReason: "deadline", closedAtMs: 2_000 });
    expect(f.match().closures).toBe(1); expect(f.match().state!.drafts[1]).toMatchObject({ ready: false, revision: 0 });
    expect(f.match().frozen?.playerOrders.map((p) => p.revision)).toEqual([1, 0]);
    f.setTime(3_000); expect((await f.request(f.browsers[1]!, "POST", readyPath, body())).statusCode).toBe(409);
    expect(f.match().closures).toBe(1);
  });
  it("retains early closure when observed after the deadline", async () => {
    const f = await fixture();
    await Promise.all(f.browsers.map((b) => f.request(b, "POST", readyPath, body())));
    const frozen = structuredClone(f.match().frozen); f.setTime(2_001);
    expect((await f.request(f.browsers[0]!, "POST", readyPath, body(1, false))).statusCode).toBe(409);
    expect(f.match().state!.turn).toMatchObject({ closeReason: "all_ready", closedAtMs: 1_000 }); expect(f.match().frozen).toEqual(frozen);
  });
  it("serializes deadline-boundary contenders with the clock sampled inside the fixture lock", async () => {
    const f = await fixture(); f.clock.mockReturnValueOnce(1_999).mockReturnValue(2_000);
    const responses = await Promise.all(f.browsers.map((b) => f.request(b, "POST", readyPath, body())));
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(f.match().closures).toBe(1); expect(f.match().state!.turn).toMatchObject({ closeReason: "deadline", closedAtMs: 2_000 });
  });
  it("does not acknowledge failed commits and rolls back Ready and deadline closure together", async () => {
    const f = await fixture(); const original = structuredClone(f.match()); f.store.failCommit = true;
    expect((await f.request(f.browsers[0]!, "POST", readyPath, body())).statusCode).toBe(500);
    expect(f.match()).toEqual(original); f.setTime(2_000);
    const failed = await f.request(f.browsers[0]!, "POST", readyPath, body());
    expect(failed.statusCode).toBe(500); expect(failed.body).not.toContain("private-fixture"); expect(f.match()).toEqual(original);
    expect(f.logs.join("")).not.toContain("private-fixture");
    f.store.failCommit = false;
    expect((await f.request(f.browsers[0]!, "POST", readyPath, body())).json().error).toBe("TURN_CLOSED"); expect(f.match().closures).toBe(1);
  });
  it("returns unavailable states without initialization and preserves legacy world UNINITIALIZED", async () => {
    const f = await fixture(); const browser = f.browsers[0]!;
    for (const status of ["OPEN", "RUNNING"] as const) {
      Object.assign(f.match(), { status, state: null, worldState: "UNINITIALIZED" }); const original = structuredClone(f.match());
      expect((await f.request(browser, "GET", readPath)).json()).toEqual({ schemaVersion: 1, matchId: "match", state: status === "OPEN" ? "NOT_STARTED" : "UNINITIALIZED" });
      expect((await f.request(browser, "POST", readyPath, body())).json().error).toBe("TURN_UNINITIALIZED");
      expect(f.match()).toEqual(original);
    }
    expect((await f.request(browser, "GET", "/api/matches/legacy/world")).json()).toEqual({ schemaVersion: 1, matchId: "legacy", state: "UNINITIALIZED" });
    expect(f.store.writes).toBe(0); expect(f.clock).not.toHaveBeenCalled();
  });
  it("retains Origin and CSRF protection without changing the draft", async () => {
    const f = await fixture(); const browser = f.browsers[0]!;
    for (const headers of [
      { cookie: browser.cookie, origin: "https://outsider.example", "x-csrf-token": browser.csrf },
      { cookie: browser.cookie, "x-csrf-token": browser.csrf }, { cookie: browser.cookie, origin },
      { cookie: browser.cookie, origin, "x-csrf-token": "wrong" }
    ]) {
      const response = await f.app.inject({ method: "POST", url: readyPath, headers, payload: body() });
      expect(response.statusCode).toBe(403); expect(TurnErrorResponseSchema.safeParse(response.json()).success).toBe(true);
    }
    expect(f.store.reads).toBe(0);
  });
  it("keeps parser failures private and rate-limit failures versioned", async () => {
    const f = await fixture(); const browser = f.browsers[0]!;
    const malformed = await f.app.inject({ method: "POST", url: readyPath,
      headers: { cookie: browser.cookie, origin, "x-csrf-token": browser.csrf, "content-type": "application/json" }, payload: "{invalid-json" });
    expect(malformed.statusCode).toBe(400); expect(malformed.json()).toEqual({ schemaVersion: 1, error: "INVALID_REQUEST" });
    expect(f.store.reads).toBe(0);
    let limited;
    for (let i = 0; i < 65; i++) {
      const response = await f.app.inject({ url: readPath, remoteAddress: "198.51.100.11", headers: { cookie: browser.cookie } });
      if (response.statusCode === 429) { limited = response; break; }
    }
    expect(limited?.json()).toEqual({ schemaVersion: 1, error: "RATE_LIMITED" });
    expect(limited?.headers["cache-control"]).toBe("no-store");
  });
  it.each(["identityId", "playerId", "serverNowMs", "seed", "pinnedRuleset", "gameId", "turnNumber", "orders", "kind"])("rejects forged client field %s", async (field) => {
    const f = await fixture(); const browser = f.browsers[0]!;
    const response = await f.request(browser, "POST", readyPath, { ...body(), [field]: "forged" });
    expect(response.statusCode).toBe(400); expect(response.json().error).toBe("INVALID_REQUEST"); expect(f.store.reads).toBe(0);
  });
  it("rejects unsupported versions, noncanonical paths, extra/repeated queries and gameplay endpoints", async () => {
    const f = await fixture(); const browser = f.browsers[0]!;
    for (const suffix of ["?identityId=other", "?schemaVersion=2", "?schemaVersion=1&schemaVersion=1"]) expect((await f.request(browser, "GET", readPath + suffix)).statusCode).toBe(400);
    for (const number of ["0", "-1", "01", "1e0", "1.5", "9007199254740992"]) expect((await f.request(browser, "POST", `/api/matches/match/turns/${number}/ready`, body())).statusCode).toBe(400);
    expect((await f.request(browser, "POST", readyPath + "?seed=123", body())).statusCode).toBe(400);
    expect((await f.request(browser, "POST", readyPath, { ...body(), schemaVersion: 2 })).statusCode).toBe(400);
    for (const suffix of ["orders", "resolve", "start"]) expect((await f.request(browser, "POST", `/api/matches/match/turns/1/${suffix}`, {})).statusCode).toBe(404);
    expect(f.store.reads).toBe(0);
  });
  it("rejects the wrong turn and fails safely for invalid clocks and storage errors", async () => {
    const f = await fixture(); const browser = f.browsers[0]!;
    expect((await f.request(browser, "POST", readyPath.replace("/1/", "/2/"), body())).json().error).toBe("WRONG_TURN");
    const original = structuredClone(f.match()); f.setTime(999);
    expect((await f.request(browser, "POST", readyPath, body())).statusCode).toBe(500); expect(f.match()).toEqual(original);
    vi.spyOn(f.store, "withMatch").mockRejectedValue(new Error("private-storage-details"));
    const response = await f.request(browser, "GET", readPath);
    expect(response.json()).toEqual({ schemaVersion: 1, error: "INTERNAL_ERROR" }); expect(f.logs.join("")).not.toContain("private-storage");
  });
  it("keeps routes absent without explicit fixture injection or authentication", async () => {
    const f = await fixture(); const normal = await lobbyFixture(f.accounts, {} as LobbyPersistence); apps.push(normal.app);
    const anonymous = await buildApp({ turnFixtures: { service: f.service } }); apps.push(anonymous);
    for (const app of [normal.app, anonymous]) {
      expect((await app.inject({ url: readPath, headers: { cookie: f.browsers[0]!.cookie } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: readyPath, payload: body() })).statusCode).toBe(404);
    }
  });
  it.each(["production", "development", ""])("refuses fixture registration in NODE_ENV=%s", async (environment) => {
    const service = new FixtureTurnService(new MemoryTurns(), () => 1_000); vi.stubEnv("NODE_ENV", environment);
    await expect(buildApp({ turnFixtures: { service } })).rejects.toThrow("Turn fixtures require NODE_ENV=test");
  });
});
