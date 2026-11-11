import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient, LobbyRepository, testDatabaseUrl } from "@strategy-game/database";
import {
  CreateLobbyResponseSchema, JoinLobbyResponseSchema, LeaveLobbyResponseSchema,
  ListLobbiesResponseSchema, SetLobbyReadyResponseSchema, StartLobbyResponseSchema, ViewLobbyResponseSchema
} from "@strategy-game/shared-types";
import { lobbyFixture, origin, settings } from "./lobby-fixture.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("authenticated lobby HTTP with PostgreSQL", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let f: Awaited<ReturnType<typeof lobbyFixture>>;
  const matches = new Set<string>();
  const identities = new Set<string>();
  const sessions = new Set<string>();
  const attempts = new Set<string>();
  class TrackedAccounts extends AuthRepository {
    override async signIn(...args: Parameters<AuthRepository["signIn"]>) {
      const player = await super.signIn(...args); identities.add(player.id); return player;
    }
    override async createSession(...args: Parameters<AuthRepository["createSession"]>) {
      sessions.add(args[0]); return super.createSession(...args);
    }
    override async createAttempt(...args: Parameters<AuthRepository["createAttempt"]>) {
      attempts.add(args[0].state); return super.createAttempt(...args);
    }
  }
  class TrackedLobbies extends LobbyRepository {
    override async createLobby(...args: Parameters<LobbyRepository["createLobby"]>) {
      const lobby = await super.createLobby(...args); matches.add(lobby.lobbyId); return lobby;
    }
  }
  beforeAll(async () => {
    client = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    await client.$connect();
  });
  beforeEach(async () => { f = await lobbyFixture(new TrackedAccounts(client), new TrackedLobbies(client)); });
  afterEach(async () => {
    if (f) await f.app.close();
    // Delete only fixtures created by this test; never sweep names/prefixes or
    // touch pre-existing records. These matches have no world/turn children.
    await client.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { id: { in: [...matches] } } });
      await tx.oAuthAttempt.deleteMany({ where: { state: { in: [...attempts] } } });
      await tx.authSession.deleteMany({ where: { id: { in: [...sessions] } } });
      await tx.oAuthAccount.deleteMany({ where: { identityId: { in: [...identities] } } });
      await tx.playerIdentity.deleteMany({ where: { id: { in: [...identities] }, participants: { none: {} }, hostedMatches: { none: {} } } });
    });
    matches.clear(); identities.clear(); sessions.clear(); attempts.clear();
  });
  afterAll(async () => { if (client) await client.$disconnect(); });
  const username = () => `U${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  async function fresh(capacity = 2) {
    const host = await f.login(username());
    const response = await f.request(host, "POST", "/api/lobbies", { schemaVersion: 1, settings: { ...settings, playerCapacity: capacity } });
    expect(response.statusCode).toBe(201);
    const { lobby } = CreateLobbyResponseSchema.parse(response.json());
    return { host, lobby, id: lobby.lobbyId };
  }

  it("authorizes readiness/start with real sessions and atomically starts once without any turn", async () => {
    const { host, id } = await fresh(); const guest = await f.login(username()); const outsider = await f.login(username());
    const path = `/api/lobbies/${id}`;
    expect((await f.request(host, "POST", `${path}/start`, { schemaVersion: 1 })).json().error).toBe("NOT_ENOUGH_PARTICIPANTS");
    expect((await f.request(outsider, "POST", `${path}/ready`, { schemaVersion: 1, ready: true })).json().error).toBe("NOT_A_PARTICIPANT");
    const nonhost = await f.request(outsider, "POST", `${path}/start`, { schemaVersion: 1 });
    expect(nonhost.statusCode).toBe(403); expect(nonhost.json().error).toBe("HOST_REQUIRED");
    await f.request(guest, "POST", `${path}/join`, { schemaVersion: 1 });
    const ready = await f.request(guest, "POST", `${path}/ready`, { schemaVersion: 1, ready: true });
    expect(ready.statusCode).toBe(200); expect(SetLobbyReadyResponseSchema.parse(ready.json()).lobby.readyCount).toBe(1);
    expect((await f.request(host, "POST", `${path}/start`, { schemaVersion: 1 })).json().error).toBe("NOT_ALL_READY");
    await f.request(host, "POST", `${path}/ready`, { schemaVersion: 1, ready: true });
    const started = await f.request(host, "POST", `${path}/start`, { schemaVersion: 1 });
    expect(started.statusCode).toBe(200); expect(StartLobbyResponseSchema.parse(started.json()).outcome).toBe("STARTED");
    const repeated = await f.request(host, "POST", `${path}/start`, { schemaVersion: 1 });
    expect(repeated.statusCode).toBe(200); expect(StartLobbyResponseSchema.parse(repeated.json()).outcome).toBe("ALREADY_STARTED");
    expect((await f.request(guest, "POST", `${path}/ready`, { schemaVersion: 1, ready: false })).json().error).toBe("LOBBY_NOT_OPEN");
    expect((await f.request(guest, "POST", `${path}/join`, { schemaVersion: 1 })).json().error).toBe("LOBBY_NOT_OPEN");
    expect((await f.request(guest, "POST", `${path}/leave`, { schemaVersion: 1 })).json().error).toBe("LOBBY_NOT_OPEN");
    expect((await f.request(guest, "POST", `${path}/start`, { schemaVersion: 1 })).json().error).toBe("HOST_REQUIRED");
    expect(ViewLobbyResponseSchema.parse((await f.request(host, "GET", path)).json()).lobby.settings.turnDurationMs).toBe(settings.turnDurationMs);
    expect(await client.turn.count({ where: { matchId: id } })).toBe(0);
    expect(await client.gameSnapshotRecord.count({ where: { matchId: id } })).toBe(0);
  });

  it("persists creation and safe list/view responses without world state, Turn 1 or a deadline", async () => {
    const { host, lobby, id } = await fresh();
    expect(lobby.host.username).toMatch(/^U/);
    const list = await f.request(host, "GET", "/api/lobbies?status=OPEN&durationCategory=QUICK");
    expect(list.statusCode).toBe(200);
    expect(ListLobbiesResponseSchema.parse(list.json()).lobbies.map((row) => row.lobbyId)).toContain(id);
    const viewed = await f.request(host, "GET", `/api/lobbies/${id}`);
    expect(viewed.statusCode).toBe(200);
    expect(ViewLobbyResponseSchema.parse(viewed.json()).lobby).toEqual(lobby);
    expect(await client.turn.count({ where: { matchId: id } })).toBe(0);
    expect(await client.gameSnapshotRecord.count({ where: { matchId: id } })).toBe(0);
    expect((await client.match.findUniqueOrThrow({ where: { id } })).hostIdentityId).toBe(host.identityId);
    const serialized = [list.body, viewed.body].join("");
    for (const privateValue of [host.identityId, host.cookie, host.csrf, "identityId", "oauthAccounts", "pinnedRuleset", "currentStateVersion"]) expect(serialized).not.toContain(privateValue);
  });

  it("joins idempotently when full, leaves, and rejoins with the same server-assigned participant ID", async () => {
    const { host, id } = await fresh(); const guest = await f.login(username());
    const path = `/api/lobbies/${id}`;
    const joined = await f.request(guest, "POST", `${path}/join`, { schemaVersion: 1 });
    expect(joined.statusCode).toBe(200);
    const first = JoinLobbyResponseSchema.parse(joined.json());
    expect(first.outcome).toBe("JOINED"); expect(first.lobby.viewer.playerId).not.toBe(guest.identityId);
    const duplicate = await f.request(guest, "POST", `${path}/join`, { schemaVersion: 1 });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({ ...first, outcome: "ALREADY_JOINED" });
    const left = await f.request(guest, "POST", `${path}/leave`, { schemaVersion: 1 });
    expect(left.statusCode).toBe(200);
    expect(LeaveLobbyResponseSchema.parse(left.json()).lobby.viewer.role).toBe("NON_PARTICIPANT");
    const repeated = await f.request(guest, "POST", `${path}/join`, { schemaVersion: 1 });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().lobby.viewer.playerId).toBe(first.lobby.viewer.playerId);
    const denied = await f.request(host, "POST", `${path}/leave`, { schemaVersion: 1 });
    expect(denied.statusCode).toBe(409); expect(denied.json().error).toBe("HOST_CANNOT_LEAVE");
    expect(await client.matchParticipant.count({ where: { matchId: id } })).toBe(2);
  });

  it("admits exactly one authenticated concurrent contender for the last slot", async () => {
    const { id } = await fresh();
    const first = await f.login(username()); const second = await f.login(username());
    const responses = await Promise.all([first, second].map((browser) => f.request(browser, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.statusCode === 409)!.json().error).toBe("LOBBY_FULL");
    expect(await client.matchParticipant.count({ where: { matchId: id, active: true } })).toBe(2);
  });

  it("serializes concurrent joins from the same authenticated account into one slot", async () => {
    const { id } = await fresh(); const guest = await f.login(username());
    const responses = await Promise.all([1, 2].map(() => f.request(guest, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })));
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses.map((response) => response.json().outcome).sort()).toEqual(["ALREADY_JOINED", "JOINED"]);
    expect(await client.matchParticipant.count({ where: { matchId: id, identityId: guest.identityId } })).toBe(1);
  });

  it("rejects RUNNING mutations, including existing-member retries, without changing the roster", async () => {
    const { id, host } = await fresh(3); const guest = await f.login(username()); const outsider = await f.login(username());
    expect((await f.request(guest, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })).statusCode).toBe(200);
    // Only our new fixture is changed to simulate a future start; no start API,
    // world initialization or turn creation is implemented or executed.
    await client.match.update({ where: { id }, data: { status: "RUNNING" } });
    const before = await client.matchParticipant.findMany({ where: { matchId: id }, orderBy: { playerId: "asc" } });
    for (const browser of [host, guest, outsider]) for (const action of ["join", "leave"]) {
      const response = await f.request(browser, "POST", `/api/lobbies/${id}/${action}`, { schemaVersion: 1 });
      expect(response.statusCode).toBe(409); expect(response.json().error).toBe("LOBBY_NOT_OPEN");
    }
    expect(await client.matchParticipant.findMany({ where: { matchId: id }, orderBy: { playerId: "asc" } })).toEqual(before);
  });

  it("enforces real persisted-session/username/CSRF/origin guards before any membership writes", async () => {
    const { id } = await fresh(); const guest = await f.login(username()); const unregistered = await f.login(null);
    const path = `/api/lobbies/${id}/join`;
    expect((await f.request({ cookie: "", csrf: "" }, "POST", path, { schemaVersion: 1 })).statusCode).toBe(401);
    expect((await f.request(unregistered, "POST", path, { schemaVersion: 1 })).statusCode).toBe(403);
    for (const headers of [
      { cookie: guest.cookie, origin },
      { cookie: guest.cookie, origin: "https://evil.example", "x-csrf-token": guest.csrf }
    ]) expect((await f.app.inject({ method: "POST", url: path, payload: { schemaVersion: 1 }, headers })).statusCode).toBe(403);
    expect((await f.request(guest, "POST", path, { schemaVersion: 1, identityId: "forged" })).statusCode).toBe(400);
    expect(await client.matchParticipant.count({ where: { matchId: id } })).toBe(1);
    const cookie = guest.cookie;
    expect((await f.request(guest, "POST", "/auth/logout", {})).statusCode).toBe(204);
    expect((await f.app.inject({ url: `/api/lobbies/${id}`, headers: { cookie } })).statusCode).toBe(401);
  });

  it("returns missing/nonmember errors safely and recovers the same session/lobby after app replacement", async () => {
    const { id, host, lobby } = await fresh(); const guest = await f.login(username());
    const missing = await f.request(guest, "GET", `/api/lobbies/${randomUUID()}`);
    expect(missing.statusCode).toBe(404); expect(missing.json()).toEqual({ schemaVersion: 1, error: "NOT_FOUND" });
    const leave = await f.request(guest, "POST", `/api/lobbies/${id}/leave`, { schemaVersion: 1 });
    expect(leave.statusCode).toBe(409); expect(leave.json().error).toBe("NOT_A_PARTICIPANT");
    await f.app.close();
    f = await lobbyFixture(new TrackedAccounts(client), new TrackedLobbies(client));
    const restored = await f.request(host, "GET", `/api/lobbies/${id}`);
    expect(restored.statusCode).toBe(200); expect(restored.json().lobby).toEqual(lobby);
    expect((await f.request(host, "GET", "/auth/me")).json().user.id).toBe(host.identityId);
  });
});
