import { afterEach, describe, expect, it, vi } from "vitest";
import { LobbyDetailSchema, LobbyErrorResponseSchema } from "@strategy-game/shared-types";
import { LobbyError } from "@strategy-game/database";
import type { LobbyErrorCode } from "@strategy-game/database";
import type { FastifyInstance, HTTPMethods } from "fastify";
import type { LobbyPersistence } from "../src/lobbies/routes.js";
import { buildApp } from "../src/app.js";
import { MemoryAuth } from "./memory-auth.js";
import { lobbyFixture, origin, settings } from "./lobby-fixture.js";

const host = { playerId: "lobby-local-host", username: "Captain_1" };
const hostDetail = LobbyDetailSchema.parse({
  schemaVersion: 1, lobbyId: "lobby", status: "OPEN", settings, host, participants: [host],
  participantCount: 1, availableSlots: 1, durationCategory: "QUICK",
  viewer: { role: "HOST", playerId: host.playerId, username: host.username, canJoin: false, canLeave: false, canStart: false }
});
const nonmemberDetail = LobbyDetailSchema.parse({ ...hostDetail,
  host: { ...host, username: "OtherHost" }, participants: [{ ...host, username: "OtherHost" }],
  viewer: { role: "NON_PARTICIPANT", playerId: null, username: "Captain_1", canJoin: true, canLeave: false, canStart: false }
});
const { participants: _roster, viewer: _viewer, ...summary } = hostDetail;
const operations: [HTTPMethods, string, object?][] = [
  ["POST", "/api/lobbies", { schemaVersion: 1, settings }], ["GET", "/api/lobbies"], ["GET", "/api/lobbies/lobby"],
  ["POST", "/api/lobbies/lobby/join", { schemaVersion: 1 }], ["POST", "/api/lobbies/lobby/leave", { schemaVersion: 1 }]
];
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
async function fixture() {
  const persistence = new MemoryAuth();
  const lobbies = {
    createLobby: vi.fn<LobbyPersistence["createLobby"]>().mockResolvedValue(hostDetail),
    listLobbies: vi.fn<LobbyPersistence["listLobbies"]>().mockResolvedValue([summary]),
    getLobby: vi.fn<LobbyPersistence["getLobby"]>().mockResolvedValue(hostDetail),
    joinLobby: vi.fn<LobbyPersistence["joinLobby"]>().mockResolvedValue({ lobby: hostDetail, outcome: "ALREADY_JOINED" }),
    leaveLobby: vi.fn<LobbyPersistence["leaveLobby"]>().mockResolvedValue(nonmemberDetail)
  };
  const f = await lobbyFixture(persistence, lobbies);
  apps.push(f.app);
  return { ...f, persistence, lobbies };
}
const errorBody = (code: string) => ({ schemaVersion: 1, error: code });

describe("authenticated lobby HTTP boundary", () => {
  it("registers no lobby route when auth is disabled, even if a repository is supplied", async () => {
    const f = await fixture();
    const app = await buildApp({ lobbies: f.lobbies }); apps.push(app);
    for (const [method, url, payload] of operations) expect((await app.inject({ method, url, ...(payload ? { payload } : {}) })).statusCode).toBe(404);
    for (const call of Object.values(f.lobbies)) expect(call).not.toHaveBeenCalled();
  });

  it.each([false, true])("requires session authentication and a registered username (signed in: %s)", async (signedIn) => {
    const f = await fixture();
    const browser = signedIn ? await f.login(null) : { cookie: "", csrf: "" };
    for (const [method, url, payload] of operations) {
      const response = await f.request(browser, method, url, payload);
      expect(response.statusCode).toBe(signedIn ? 403 : 401);
      expect(response.json()).toEqual(errorBody(signedIn ? "USERNAME_REQUIRED" : "UNAUTHENTICATED"));
    }
    for (const call of Object.values(f.lobbies)) expect(call).not.toHaveBeenCalled();
  });

  it("wires all five operations with only the session identity and versioned public envelopes", async () => {
    const f = await fixture(); const browser = await f.login();
    const responses = [];
    for (const [method, url, payload] of operations) responses.push(await f.request(browser, method, url, payload));
    expect(responses.map((response) => response.statusCode)).toEqual([201, 200, 200, 200, 200]);
    for (const response of responses) {
      expect(response.json().schemaVersion).toBe(1);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.body).not.toContain(browser.identityId);
    }
    expect(f.lobbies.createLobby).toHaveBeenCalledWith(browser.identityId, settings);
    expect(f.lobbies.listLobbies).toHaveBeenCalledWith(browser.identityId, { schemaVersion: 1 });
    for (const call of [f.lobbies.getLobby, f.lobbies.joinLobby, f.lobbies.leaveLobby]) expect(call).toHaveBeenCalledWith("lobby", browser.identityId);
    const response = await f.app.inject({ url: "/api/lobbies?schemaVersion=1&status=OPEN&durationCategory=QUICK", headers: { cookie: browser.cookie } });
    expect(response.statusCode).toBe(200); // Read-only requests need no Origin/CSRF token.
    expect(f.lobbies.listLobbies).toHaveBeenLastCalledWith(browser.identityId, { schemaVersion: 1, status: "OPEN", durationCategory: "QUICK" });
  });

  it("rejects missing, invalid, and other-session CSRF tokens on every mutation", async () => {
    const f = await fixture(); const browser = await f.login(); const other = await f.login("Captain_2", "another-subject");
    for (const [method, url, payload] of operations.filter(([method]) => method === "POST")) {
      for (const token of [undefined, "invalid", other.csrf]) {
        const response = await f.app.inject({ method, url, ...(payload ? { payload } : {}), headers: {
          cookie: browser.cookie, origin, ...(token ? { "x-csrf-token": token } : {})
        } });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual(errorBody("CSRF_REJECTED"));
      }
    }
    for (const call of Object.values(f.lobbies)) expect(call).not.toHaveBeenCalled();
  });

  it("requires the exact configured Origin, even with valid cookies and CSRF", async () => {
    const f = await fixture(); const browser = await f.login();
    for (const [method, url, payload] of operations.filter(([method]) => method === "POST")) {
      for (const supplied of [undefined, "null", "https://evil.example", "http://localhost:5173"]) {
        const response = await f.app.inject({ method, url, ...(payload ? { payload } : {}), headers: {
          cookie: browser.cookie, "x-csrf-token": browser.csrf, ...(supplied ? { origin: supplied } : {})
        } });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual(errorBody("INVALID_ORIGIN"));
      }
    }
    for (const call of Object.values(f.lobbies)) expect(call).not.toHaveBeenCalled();
  });

  it("rejects forged identity/role/host/player fields instead of accepting caller authority", async () => {
    const f = await fixture(); const browser = await f.login();
    for (const field of ["identityId", "hostId", "playerId", "role"]) {
      for (const [method, url, payload] of operations.filter(([method]) => method === "POST")) {
        const response = await f.request(browser, method, url, { ...payload, [field]: "another-account" });
        expect(response.statusCode).toBe(400); expect(response.json()).toEqual(errorBody("INVALID_REQUEST"));
      }
    }
    for (const call of Object.values(f.lobbies)) expect(call).not.toHaveBeenCalled();
  });

  it.each([
    { playerCapacity: 1 }, { playerCapacity: 41 }, { turnDurationMs: 0 }, { turnDurationMs: "300000" },
    { turnDurationMs: 1.5 }, { turnDurationMs: Number.MAX_SAFE_INTEGER + 1 }, { visibility: "PRIVATE" },
    { name: " padded " }, { eraId: "era" }, { scenarioId: "empty-world" }, { hostIdentityId: "forged" }
  ])("validates strict creation settings: %j", async (change) => {
    const f = await fixture(); const browser = await f.login();
    const response = await f.request(browser, "POST", "/api/lobbies", { schemaVersion: 1, settings: { ...settings, ...change } });
    expect(response.statusCode).toBe(400); expect(response.json()).toEqual(errorBody("INVALID_REQUEST"));
    expect(f.lobbies.createLobby).not.toHaveBeenCalled();
  });

  it("validates versions, paths, query filters and mutation bodies without coercing arbitrary input", async () => {
    const f = await fixture(); const browser = await f.login();
    for (const url of ["/api/lobbies?schemaVersion=2", "/api/lobbies?schemaVersion=01", "/api/lobbies?status=OPEN&status=RUNNING",
      "/api/lobbies?identityId=forged", "/api/lobbies?status=DRAFT", "/api/lobbies?durationCategory=other",
      "/api/lobbies/%20", "/api/lobbies/lobby?role=HOST", "/api/lobbies/lobby?lobbyId=other"]) {
      const response = await f.request(browser, "GET", url);
      expect(response.statusCode, url).toBe(400); expect(response.json()).toEqual(errorBody("INVALID_REQUEST"));
    }
    for (const payload of [{}, { schemaVersion: 2 }, { schemaVersion: "1" }, { schemaVersion: 1, lobbyId: "other" }]) {
      expect((await f.request(browser, "POST", "/api/lobbies/lobby/join", payload)).statusCode).toBe(400);
    }
    expect((await f.request(browser, "POST", "/api/lobbies?status=OPEN", { schemaVersion: 1, settings })).statusCode).toBe(400);
    for (const call of Object.values(f.lobbies)) expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ["UNAUTHENTICATED", 401, "UNAUTHENTICATED"], ["USERNAME_REQUIRED", 403, "USERNAME_REQUIRED"], ["NOT_FOUND", 404, "NOT_FOUND"],
    ["LOBBY_NOT_OPEN", 409, "LOBBY_NOT_OPEN"], ["LOBBY_FULL", 409, "LOBBY_FULL"], ["HOST_CANNOT_LEAVE", 409, "HOST_CANNOT_LEAVE"],
    ["NOT_A_PARTICIPANT", 409, "NOT_A_PARTICIPANT"], ["INVALID_INPUT", 400, "INVALID_REQUEST"], ["INVALID_STORAGE", 500, "INTERNAL_ERROR"]
  ] as const)("maps repository %s to safe HTTP %s", async (code: LobbyErrorCode, status, publicCode) => {
    const f = await fixture(); const browser = await f.login();
    f.lobbies.joinLobby.mockRejectedValue(new LobbyError(code));
    const response = await f.request(browser, "POST", "/api/lobbies/lobby/join", { schemaVersion: 1 });
    expect(response.statusCode).toBe(status);
    expect(LobbyErrorResponseSchema.parse(response.json())).toEqual(errorBody(publicCode));
  });

  it("sanitizes raw failures, including parser, response validation, account store, and database errors", async () => {
    const f = await fixture(); const browser = await f.login();
    const secret = "private-database-credential-and-provider-subject";
    f.lobbies.getLobby.mockRejectedValue(new Error(secret));
    const failed = await f.request(browser, "GET", "/api/lobbies/lobby");
    expect(failed.statusCode).toBe(500); expect(failed.json()).toEqual(errorBody("INTERNAL_ERROR"));
    const leaked = { ...hostDetail, identityId: secret };
    f.lobbies.getLobby.mockResolvedValue(leaked);
    expect((await f.request(browser, "GET", "/api/lobbies/lobby")).json()).toEqual(errorBody("INTERNAL_ERROR"));
    const malformed = await f.app.inject({ method: "POST", url: "/api/lobbies", payload: "{", headers: {
      cookie: browser.cookie, origin, "x-csrf-token": browser.csrf, "content-type": "application/json"
    } });
    expect(malformed.statusCode).toBe(400); expect(malformed.json()).toEqual(errorBody("INVALID_REQUEST"));
    vi.spyOn(f.persistence, "profile").mockRejectedValue(new Error(secret));
    expect((await f.request(browser, "GET", "/api/lobbies")).json()).toEqual(errorBody("INTERNAL_ERROR"));
    vi.spyOn(f.persistence, "readSession").mockRejectedValue(new Error(secret));
    const unavailable = await f.request(browser, "GET", "/api/lobbies");
    expect(unavailable.statusCode).toBe(500);
    expect(unavailable.json()).toEqual(errorBody("INTERNAL_ERROR"));
    expect([failed.body, malformed.body, ...f.logs].join("")).not.toContain(secret);
  });

  it("rejects tampered, expired and revoked sessions without a fallback identity", async () => {
    const f = await fixture(); const browser = await f.login();
    expect((await f.app.inject({ url: "/api/lobbies", headers: { cookie: `${browser.cookie}!`, authorization: `Bearer ${browser.identityId}` } })).statusCode).toBe(401);
    for (const [id, session] of f.persistence.sessions) if (session.identityId === browser.identityId) f.persistence.sessions.set(id, { ...session, expiresAt: new Date(0) });
    expect((await f.request(browser, "GET", "/api/lobbies")).statusCode).toBe(401);
    const next = await f.login("Captain_2", "other-subject"); const staleCookie = next.cookie;
    expect((await f.request(next, "POST", "/auth/logout", {})).statusCode).toBe(204);
    expect((await f.app.inject({ url: "/api/lobbies", headers: { cookie: staleCookie } })).statusCode).toBe(401);
    for (const call of Object.values(f.lobbies)) expect(call).not.toHaveBeenCalled();
  });

  it("retains rate limiting with a safe versioned error envelope", async () => {
    const f = await fixture(); const browser = await f.login();
    let response;
    for (let attempt = 0; attempt < 65; attempt++) {
      response = await f.request(browser, "GET", "/api/lobbies");
      if (response.statusCode === 429) break;
    }
    expect(response!.statusCode).toBe(429);
    expect(response!.json()).toEqual(errorBody("RATE_LIMITED"));
    expect(response!.headers["retry-after"]).toBeDefined();
  });

  it("adds no start, edit, delete or settings-update endpoints", async () => {
    const f = await fixture(); const browser = await f.login();
    for (const [method, url] of [["POST", "/api/lobbies/lobby/start"], ["PATCH", "/api/lobbies/lobby"], ["DELETE", "/api/lobbies/lobby"]] as const) {
      expect((await f.request(browser, method, url, { schemaVersion: 1 })).statusCode).toBe(404);
    }
  });
});
