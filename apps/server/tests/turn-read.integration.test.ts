import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient, LobbyRepository, testDatabaseUrl, TurnReadRepository, WorldRepository } from "@strategy-game/database";
import { ReadTurnResponseSchema } from "@strategy-game/shared-types";
import { generateWorld, initializeTurnOne } from "../../../packages/game-engine/dist/index.js";
import { json } from "../../../database/dist/mappings.js";
import { insertInitialWorld } from "../../../database/dist/world-repository.js";
import { insertTurn } from "../../../database/dist/turn-storage.js";
import { lobbyFixture, settings } from "./lobby-fixture.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("production turn GET (fresh hosted CI only)", () => {
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
    f = await lobbyFixture(new Accounts(client), new Lobbies(client, undefined, () => 10_000), new WorldRepository(client), undefined, new TurnReadRepository(client));
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
  const path = (id: string) => `/api/matches/${id}/turn`;
  async function fresh(count = 2) {
    const members = [await login()];
    const created = await f.request(members[0]!, "POST", "/api/lobbies", { schemaVersion: 1, settings: { ...settings, playerCapacity: count, turnDurationMs: 1000 } });
    expect(created.statusCode).toBe(201); const id = created.json().lobby.lobbyId as string;
    for (let i = 1; i < count; i++) {
      const member = await login(); members.push(member);
      expect((await f.request(member, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })).statusCode).toBe(200);
    }
    for (const member of members) expect((await f.request(member, "POST", `/api/lobbies/${id}/ready`, { schemaVersion: 1, ready: true })).statusCode).toBe(200);
    return { id, host: members[0]!, members, start: () => f.request(members[0]!, "POST", `/api/lobbies/${id}/start`, { schemaVersion: 1 }) };
  }
  async function inspect(id: string) {
    return {
      match: await client.match.findUniqueOrThrow({ where: { id }, include: { configuration: true, world: true, snapshots: true, participants: true,
        turns: { include: { players: { include: { orders: true, revisions: true } }, frozenInput: true, resolution: true } } } }),
      sessions: await client.authSession.findMany({ where: { id: { in: [...sessions] } }, orderBy: { id: "asc" } })
    };
  }
  it.each([2, 4, 10, 40])("serves strict own-player status for %i real sessions; repeated overdue reads leave all stored data unchanged", async (count) => {
    const g = await fresh(count);
    expect((await f.request(g.host, "GET", path(g.id))).json().state).toBe("NOT_STARTED");
    expect((await g.start()).statusCode).toBe(200); const before = await inspect(g.id);
    for (const member of g.members) {
      const response = await f.app.inject({ url: path(g.id), headers: { cookie: member.cookie }, ...(member.remoteAddress ? { remoteAddress: member.remoteAddress } : {}) });
      expect(response.statusCode).toBe(200);
      const result = ReadTurnResponseSchema.parse(response.json());
      expect(result).toEqual({ schemaVersion: 1, matchId: g.id, state: "READY",
        turn: { schemaVersion: 1, gameId: g.id, turnNumber: 1, status: "open", openedAtMs: 10_000, deadlineAtMs: 11_000 },
        own: { schemaVersion: 1, gameId: g.id, turnNumber: 1, revision: 0, ready: false, orders: [] } });
      for (const secret of ["seed", "digest", "payload", "snapshotId", "pinnedRuleset", "players", "identityId", "frozenInput", "resolution", ...g.members.map((m) => m.identityId)]) expect(response.body).not.toContain(secret);
      expect(response.headers["cache-control"]).toBe("no-store"); expect(response.headers["set-cookie"]).toBeUndefined();
    }
    await Promise.all(Array.from({ length: 4 }, () => f.request(g.host, "GET", path(g.id))));
    expect(await inspect(g.id)).toEqual(before);
    expect((await f.request(g.host, "POST", `/api/matches/${g.id}/turns/1/ready`, { schemaVersion: 1, expectedRevision: 0, ready: true })).statusCode).toBe(404);
  }, 30_000);
  it("keeps authorization errors identical and private before availability; rejects expired/revoked sessions", async () => {
    const g = await fresh(); const outsider = await login(); const incomplete = await login(false);
    expect((await g.start()).statusCode).toBe(200);
    const missing = randomUUID();
    for (const url of [path(g.id), path(missing)]) {
      const denied = await f.request(outsider, "GET", url);
      expect(denied.statusCode).toBe(404); expect(denied.json()).toEqual({ schemaVersion: 1, error: "NOT_FOUND" });
      expect((await f.app.inject({ url })).statusCode).toBe(401);
      expect((await f.request(incomplete, "GET", url)).statusCode).toBe(403);
    }
    const other = await fresh(); const inactive = other.members[1]!;
    expect((await f.request(inactive, "POST", `/api/lobbies/${other.id}/leave`, { schemaVersion: 1 })).statusCode).toBe(200);
    for (const id of [other.id, g.id]) {
      const response = await f.request(inactive, "GET", path(id));
      expect(response.statusCode).toBe(404); expect(response.json()).toEqual({ schemaVersion: 1, error: "NOT_FOUND" });
    }
    await client.authSession.updateMany({ where: { identityId: g.host.identityId }, data: { expiresAt: new Date(0) } });
    expect((await f.request(g.host, "GET", path(g.id))).statusCode).toBe(401);
    await new Accounts(client).revokeAllSessions(outsider.identityId);
    expect((await f.request(outsider, "GET", path(g.id))).statusCode).toBe(401);
  });
  it.each([{ status: "OPEN", hasWorld: false }, { status: "RUNNING", hasWorld: false }, { status: "RUNNING", hasWorld: true }] as const)("preserves legacy $status / world=$hasWorld without turn initialization", async ({ status, hasWorld }) => {
    const host = await login(); const guest = await login(); const id = randomUUID(); matches.add(id);
    const roster = [host, guest].map((member) => ({ identityId: member.identityId, playerId: randomUUID(), active: true, lobbyReady: true }));
    await client.$transaction(async (tx) => {
      await tx.match.create({ data: { id, status: hasWorld ? "OPEN" : status, hostIdentityId: host.identityId, createdAt: new Date(0),
        configuration: { create: { schemaVersion: 1, name: "Legacy read fixture", playerCapacity: 2, turnDurationMs: 1000n, config: { schemaVersion: 1, gameId: id, turnDurationMs: 1000 } } },
        participants: { create: roster }
      } });
      if (hasWorld) {
        const players = roster.map((p) => p.playerId);
        const generated = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: 123, settings: { regionSide: 5 }, players });
        if (!generated.ok) throw new Error("Invalid legacy fixture");
        await insertInitialWorld(tx, id, generated.world, players);
        await tx.match.update({ where: { id }, data: { status: "RUNNING" } });
      }
    });
    const before = await inspect(id);
    for (let i = 0; i < 3; i++) {
      const response = await f.request(host, "GET", path(id)); expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ schemaVersion: 1, matchId: id, state: status === "OPEN" ? "NOT_STARTED" : "UNINITIALIZED" });
    }
    expect(await inspect(id)).toEqual(before);
  });
  it("fails closed for a structurally valid but forged archive digest without disclosing it", async () => {
    const g = await fresh();
    await client.$transaction(async (tx) => {
      const config = await tx.matchConfiguration.findUniqueOrThrow({ where: { matchId: g.id } });
      const roster = await tx.matchParticipant.findMany({ where: { matchId: g.id, active: true } });
      const generated = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: 123, settings: { regionSide: 5 }, players: roster.map((p) => p.playerId) });
      if (!generated.ok) throw new Error("Invalid fixture");
      const archive = await insertInitialWorld(tx, g.id, generated.world, roster.map((p) => p.playerId));
      const plan = initializeTurnOne(config.config, roster.map((p) => ({ schemaVersion: 1, gameId: g.id, playerId: p.playerId, active: true })), archive, 10_000);
      const payload = json(plan.snapshot) as Record<string, unknown>;
      (payload.worldRef as Record<string, unknown>).digest = `sha256:${"a".repeat(64)}`;
      await tx.gameSnapshotRecord.create({ data: { matchId: g.id, stateVersion: 0n, completedTurnNumber: 0n, snapshotId: plan.snapshot.snapshotId, payload: json(payload) } });
      await insertTurn(tx, plan.state, plan.snapshot);
      await tx.match.update({ where: { id: g.id }, data: { status: "RUNNING" } });
    });
    const before = await inspect(g.id); const response = await f.request(g.host, "GET", path(g.id));
    expect(response.statusCode).toBe(500); expect(response.json()).toEqual({ schemaVersion: 1, error: "INTERNAL_ERROR" });
    expect(await inspect(g.id)).toEqual(before);
    expect(f.logs.join("\n")).not.toContain(`sha256:${"a".repeat(64)}`);
  });
  it("concurrent start and reads see only NOT_STARTED or fully restored READY", async () => {
    const g = await fresh();
    const before = await f.request(g.host, "GET", path(g.id)); expect(before.json().state).toBe("NOT_STARTED");
    const [started, responses] = await Promise.all([g.start(), Promise.all(Array.from({ length: 12 }, () => f.request(g.members[1]!, "GET", path(g.id))))]);
    expect(started.statusCode).toBe(200);
    for (const response of responses) {
      expect(response.statusCode).toBe(200); const result = ReadTurnResponseSchema.parse(response.json());
      expect(["NOT_STARTED", "READY"]).toContain(result.state);
      if (result.state === "READY") expect(result.own).toMatchObject({ revision: 0, ready: false, orders: [] });
    }
    const after = await f.request(g.host, "GET", path(g.id)); expect(after.json().state).toBe("READY");
    const row = (await inspect(g.id)).match; expect(row.turns).toHaveLength(1); expect(row.snapshots).toHaveLength(1);
  });
});
