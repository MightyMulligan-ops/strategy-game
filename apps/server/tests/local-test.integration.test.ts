import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient, LobbyRepository, localTestIdentity, testDatabaseUrl } from "@strategy-game/database";
import { localTestFixture } from "./local-test-fixture.js";

// This suite is run by existing CI against its new disposable PostgreSQL service.
// Ordinary local unit runs skip it. Never point it at an existing database.
describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("local test login with isolated PostgreSQL", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let f: Awaited<ReturnType<typeof localTestFixture>>;
  const identities = new Set<string>(); const sessions = new Set<string>(); const matches = new Set<string>();
  class TrackedAccounts extends AuthRepository {
    override async signInLocalTest(...args: Parameters<AuthRepository["signInLocalTest"]>) {
      const user = await super.signInLocalTest(...args); identities.add(user.id); return user;
    }
    override async signIn(...args: Parameters<AuthRepository["signIn"]>) {
      const user = await super.signIn(...args); identities.add(user.id); return user;
    }
    override async createSession(...args: Parameters<AuthRepository["createSession"]>) {
      sessions.add(args[0]); return super.createSession(...args);
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
    // Refuse pre-existing fixture data rather than claiming or deleting it.
    if (await client.playerIdentity.count({ where: { id: { in: [localTestIdentity("player-one")!, localTestIdentity("player-two")!] } } })) {
      throw new Error("Local-login tests require a fresh isolated database with no existing fixture identities");
    }
  });
  beforeEach(async () => { f = await localTestFixture(new TrackedAccounts(client), new TrackedLobbies(client)); });
  afterEach(async () => {
    if (f) await f.app.close();
    await client.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { id: { in: [...matches] } } });
      await tx.authSession.deleteMany({ where: { id: { in: [...sessions] } } });
      await tx.oAuthAccount.deleteMany({ where: { identityId: { in: [...identities] } } });
      await tx.playerIdentity.deleteMany({ where: { id: { in: [...identities] }, participants: { none: {} }, hostedMatches: { none: {} } } });
    });
    identities.clear(); sessions.clear(); matches.clear();
  });
  afterAll(async () => { if (client) await client.$disconnect(); });
  const username = () => `Local_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

  it("uses two normal persisted sessions for real authorized lobby create/join/leave", async () => {
    const one = await f.signIn("player-one"); const two = await f.signIn("player-two");
    expect(one.user.id).not.toBe(two.user.id);
    expect((await f.request(one.browser, "GET", "/api/lobbies")).statusCode).toBe(403); // Normal onboarding gate.
    for (const player of [one, two]) expect((await f.request(player.browser, "POST", "/auth/username", { username: username() })).statusCode).toBe(200);
    const created = await f.request(one.browser, "POST", "/api/lobbies", { schemaVersion: 1,
      settings: { name: "Local fixture lobby", playerCapacity: 2, turnDurationMs: 300000, visibility: "PUBLIC" } });
    expect(created.statusCode).toBe(201); const id = created.json().lobby.lobbyId as string;
    expect((await f.request(two.browser, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })).statusCode).toBe(200);
    expect((await f.request(two.browser, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })).json().outcome).toBe("ALREADY_JOINED");
    expect((await f.request(one.browser, "POST", `/api/lobbies/${id}/leave`, { schemaVersion: 1 })).json().error).toBe("HOST_CANNOT_LEAVE");
    expect((await f.request(two.browser, "POST", `/api/lobbies/${id}/leave`, { schemaVersion: 1 })).statusCode).toBe(200);
    expect(await client.matchParticipant.count({ where: { matchId: id, active: true } })).toBe(1);
    expect(await client.oAuthAccount.count({ where: { identityId: { in: [one.user.id, two.user.id] } } })).toBe(0);
    expect(await client.authSession.count({ where: { identityId: { in: [one.user.id, two.user.id] }, revokedAt: null } })).toBe(2);
  });
  it("recovers stable identity and sessions with new app/client instances and normal logout-all", async () => {
    const one = await f.signIn("player-one"); const name = username();
    await f.request(one.browser, "POST", "/auth/username", { username: name });
    const second = await f.signIn("player-one"); expect(second.user.id).toBe(one.user.id); expect(second.user.username).toBe(name);
    await f.app.close();
    const other = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      f = await localTestFixture(new TrackedAccounts(other), new TrackedLobbies(other));
      expect((await f.request(one.browser, "GET", "/auth/me")).json().user.username).toBe(name);
      await f.request(one.browser, "POST", "/auth/logout-all", {});
      expect((await f.request(second.browser, "GET", "/auth/me")).statusCode).toBe(401);
      await f.app.close();
    } finally { await other.$disconnect(); }
  });
  it("serializes concurrent first sign-ins to the same allowlisted fixture", async () => {
    const responses = await Promise.all([f.signIn("player-one"), f.signIn("player-one")]);
    expect(responses[0]!.user.id).toBe(responses[1]!.user.id);
    expect(responses[0]!.browser.cookie).not.toBe(responses[1]!.browser.cookie);
    expect(await client.playerIdentity.count({ where: { id: localTestIdentity("player-one")! } })).toBe(1);
  });
  it("refuses fixture collisions with existing OAuth mappings without changing records", async () => {
    const id = localTestIdentity("player-one")!; identities.add(id); const subject = randomUUID();
    await client.playerIdentity.create({ data: { id, oauthAccounts: { create: { provider: "GOOGLE", subject } } } });
    const before = await client.playerIdentity.findUniqueOrThrow({ where: { id }, include: { oauthAccounts: true } });
    const browser = { cookie: "", csrf: "" }; await f.csrf(browser);
    const response = await f.request(browser, "POST", "/auth/dev-login", { fixture: "player-one" });
    expect(response.statusCode).toBe(409); expect(response.json()).toEqual({ error: "fixture_unavailable" });
    expect(await client.playerIdentity.findUniqueOrThrow({ where: { id }, include: { oauthAccounts: true } })).toEqual(before);
    await expect(new AuthRepository(client).signIn("google", subject)).rejects.toMatchObject({ code: "unauthorized" });
  });
  it("cannot link a real provider to a fixture or select a real account as a fixture", async () => {
    const one = await f.signIn("player-one"); const accounts = new TrackedAccounts(client);
    const real = await accounts.signIn("discord", randomUUID());
    await expect(accounts.link(one.user.id, "google", randomUUID())).rejects.toMatchObject({ code: "identity_conflict" });
    const browser = { cookie: "", csrf: "" }; await f.csrf(browser);
    expect((await f.request(browser, "POST", "/auth/dev-login", { fixture: real.id })).statusCode).toBe(400);
    expect(await accounts.profile(real.id)).toEqual(real);
    expect(await client.oAuthAccount.count({ where: { identityId: one.user.id } })).toBe(0);
  });
});
