import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient, LobbyRepository, testDatabaseUrl, MovementDraftRepository, FormationReadRepository } from "@strategy-game/database";
import { MOVEMENT_DRAFT_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { MovementDraftReadySchema } from "@strategy-game/shared-types";
import { lobbyFixture, settings } from "./lobby-fixture.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("production movement drafts (separately approved fresh hosted CI only)", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let f: Awaited<ReturnType<typeof lobbyFixture>>;
  const matches = new Set<string>(), identities = new Set<string>(), sessions = new Set<string>(), attempts = new Set<string>();
  let address = 0;
  class Accounts extends AuthRepository {
    override async signIn(...args: Parameters<AuthRepository["signIn"]>) {
      const user = await super.signIn(...args); identities.add(user.id); return user;
    }
    override async createSession(...args: Parameters<AuthRepository["createSession"]>) {
      sessions.add(args[0]); return super.createSession(...args);
    }
    override async createAttempt(...args: Parameters<AuthRepository["createAttempt"]>) {
      attempts.add(args[0].state); return super.createAttempt(...args);
    }
  }
  class Lobbies extends LobbyRepository {
    override async createLobby(...args: Parameters<LobbyRepository["createLobby"]>) {
      const lobby = await super.createLobby(...args); matches.add(lobby.lobbyId); return lobby;
    }
  }
  beforeAll(async () => {
    if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Only the approved fresh hosted CI service may run this suite; no local DB execution");
    client = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL)); await client.$connect();
  });
  beforeEach(async () => {
    address = 0;
    f = await lobbyFixture(new Accounts(client), new Lobbies(client, undefined, Date.now, MOVEMENT_DRAFT_RUNTIME_PROFILE), undefined, undefined, undefined, undefined, new MovementDraftRepository(client));
  });
  afterEach(async () => {
    if (f) await f.app.close();
    if (!client) return;
    // Only this suite's fresh fixtures; initialized children use the existing parent cascade.
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
  const login = (complete = true) => f.login(complete ? `U${randomUUID().replaceAll("-", "").slice(0, 20)}` : null, randomUUID(), `192.0.2.${++address}`);
  const path = (id: string) => `/api/matches/${id}/turns/1/orders`;
  async function fresh() {
    const host = await login(), guest = await login();
    const created = await f.request(host, "POST", "/api/lobbies", { schemaVersion: 1, settings });
    expect(created.statusCode).toBe(201); const id = created.json().lobby.lobbyId as string;
    expect((await f.request(guest, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })).statusCode).toBe(200);
    for (const member of [host, guest]) expect((await f.request(member, "POST", `/api/lobbies/${id}/ready`, { schemaVersion: 1, ready: true })).statusCode).toBe(200);
    expect((await f.request(host, "POST", `/api/lobbies/${id}/start`, { schemaVersion: 1 })).statusCode).toBe(200);
    return { host, guest, id };
  }
  it("persists own authenticated drafts with normal CSRF/session and denies all enemy visibility", async () => {
    const g = await fresh();
    const projected = await new FormationReadRepository(client).getFormations(g.id, g.host.identityId);
    if (projected.state !== "READY") throw new Error("Missing formation");
    const own = projected.formations[0]!;
    const command = { schemaVersion: 1, kind: "replace_orders", expectedRevision: 0, orders: [{ type: "move", orderId: "private-own-route", stackId: own.formationId, destination: own.position }] };
    const result = await f.request(g.host, "POST", path(g.id), command);
    expect(result.statusCode).toBe(200); expect(MovementDraftReadySchema.parse(result.json()).own.revision).toBe(1);
    const restored = await f.request(g.host, "GET", path(g.id)); expect(restored.json()).toEqual(result.json());
    const guest = await f.request(g.guest, "GET", path(g.id)); expect(guest.statusCode).toBe(200); expect(guest.json().own.orders).toEqual([]);
    expect(guest.body).not.toContain("private-own-route"); expect(guest.body).not.toContain(own.formationId);
    expect((await f.request(g.guest, "POST", path(g.id), command)).statusCode).toBe(422);
    for (const key of ["snapshotId", "seed", "digest", "identityId", "pinnedRuleset"]) expect(result.body).not.toContain(`"${key}"`);
    expect(result.headers["cache-control"]).toBe("no-store");
  });
  it("conflicts stale revisions and denies outsider/revoked sessions without a mutation", async () => {
    const g = await fresh(), command = { schemaVersion: 1, kind: "replace_orders", expectedRevision: 0, orders: [] };
    expect((await f.request(g.host, "POST", path(g.id), command)).statusCode).toBe(200);
    expect((await f.request(g.host, "POST", path(g.id), command)).statusCode).toBe(409);
    const outsider = await login();
    expect((await f.request(outsider, "GET", path(g.id))).statusCode).toBe(404);
    expect((await f.request(outsider, "POST", path(g.id), command)).statusCode).toBe(404);
    await client.authSession.updateMany({ where: { identityId: g.host.identityId }, data: { revokedAt: new Date() } });
    expect((await f.request(g.host, "POST", path(g.id), { ...command, expectedRevision: 1 })).statusCode).toBe(401);
    expect((await client.playerTurnState.findMany({ where: { matchId: g.id } })).map((p) => p.revision).sort()).toEqual([0n,1n]);
  });
});
