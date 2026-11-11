import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateWorld } from "@strategy-game/game-engine";
import { GeneratedWorldSchema } from "@strategy-game/shared-types/server";
import { createDatabaseClient, LobbyRepository, WorldRepository } from "../src/index.js";
import { testDatabaseUrl } from "../src/environment.js";
import { insertInitialWorld } from "../src/world-repository.js";
import { Prisma } from "../src/generated/prisma/client.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("persistent initial worlds (disposable CI only)", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  const matches: string[] = []; const identities: string[] = [];
  beforeAll(async () => { client = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL)); await client.$connect(); });
  afterEach(async () => {
    // Exact IDs created by this test only. World deletion is a parent cascade.
    await client.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { id: { in: matches } } });
      await tx.playerIdentity.deleteMany({ where: { id: { in: identities }, participants: { none: {} }, hostedMatches: { none: {} } } });
    }); matches.length = 0; identities.length = 0;
  });
  afterAll(async () => { if (client) await client.$disconnect(); });
  async function account() {
    const id = randomUUID(); identities.push(id); const username = `U${id.replaceAll("-", "").slice(0, 20)}`;
    await client.playerIdentity.create({ data: { id, username, usernameKey: username.toLowerCase() } }); return id;
  }
  function generated(players: readonly string[], seed = 4294967295) {
    const r = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed, players, settings: { regionSide: 5 } });
    if (!r.ok) throw new Error("Invalid test world"); return r.world;
  }
  async function fresh(count = 2, repository = new LobbyRepository(client)) {
    const host = await account(); const lobby = await repository.createLobby(host, { name: "Fixture", playerCapacity: 40, turnDurationMs: 300000, visibility: "PUBLIC" });
    matches.push(lobby.lobbyId); const members = [host];
    for (let i = 1; i < count; i++) { const member = await account(); members.push(member); await repository.joinLobby(lobby.lobbyId, member); }
    for (const member of members) await repository.setReady(lobby.lobbyId, member, true);
    return { id: lobby.lobbyId, host, members, repository };
  }
  async function legacy() {
    const host = await account(); const guest = await account(); const id = randomUUID(); matches.push(id);
    await client.match.create({ data: { id, status: "RUNNING", hostIdentityId: host, createdAt: new Date(),
      configuration: { create: { schemaVersion: 1, name: "Legacy fixture", playerCapacity: 2, turnDurationMs: 300000n, config: { schemaVersion: 1, gameId: id, turnDurationMs: 300000 } } },
      participants: { create: [host, guest].map((identityId) => ({ playerId: randomUUID(), identityId, active: true })) }
    } }); return { id, host, guest };
  }

  it.each([2, 4, 10, 40])("persists the exact seeded %i-player result once and restores it without turn changes", async (count) => {
    let calls = 0; const repository = new LobbyRepository(client, (players) => { calls++; return generated(players); });
    const { id, host, members } = await fresh(count, repository);
    const before = await client.matchConfiguration.findUniqueOrThrow({ where: { matchId: id } });
    const started = await repository.startLobby(id, host); expect(started.outcome).toBe("STARTED");
    const stored = await client.matchWorld.findUniqueOrThrow({ where: { matchId: id } });
    expect(stored.seed).toBe(4294967295n);
    expect(GeneratedWorldSchema.parse(stored.payload)).toEqual(generated(started.lobby.participants.map((p) => p.playerId)));
    await repository.startLobby(id, host); expect(calls).toBe(1);
    const other = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const a = await new WorldRepository(client).getWorld(id, host);
      expect(a.state).toBe("READY"); expect(await new WorldRepository(other).getWorld(id, members[1]!)).toEqual(a);
      for (const key of ["seed", "payload", "identityId", "startingState", "generatorVersion"]) expect(JSON.stringify(a)).not.toContain(`"${key}"`);
    } finally { await other.$disconnect(); }
    expect(await client.matchConfiguration.findUniqueOrThrow({ where: { matchId: id } })).toEqual(before);
    expect((await client.match.findUniqueOrThrow({ where: { id } })).currentStateVersion).toBe(0n);
    expect(await client.turn.count({ where: { matchId: id } })).toBe(0);
    expect(await client.gameSnapshotRecord.count({ where: { matchId: id } })).toBe(0);
  }, 20000);

  it("serializes starts across clients and never calls generation after the committed start", async () => {
    let calls = 0; const factory = (players: readonly string[]) => { calls++; return generated(players, 2147483648); };
    const { id, host } = await fresh(2, new LobbyRepository(client, factory));
    const other = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const results = await Promise.all([new LobbyRepository(client, factory).startLobby(id, host), new LobbyRepository(other, factory).startLobby(id, host)]);
      expect(results.map((r) => r.outcome).sort()).toEqual(["ALREADY_STARTED", "STARTED"]); expect(calls).toBe(1);
      expect(await client.matchWorld.count({ where: { matchId: id } })).toBe(1);
    } finally { await other.$disconnect(); }
  });

  it("rolls back generation failure and can retry without clearing readiness", async () => {
    const { id, host } = await fresh();
    await expect(new LobbyRepository(client, () => { throw new Error("fixture generation failure"); }).startLobby(id, host)).rejects.toThrow();
    expect((await client.match.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
    expect(await client.matchWorld.count({ where: { matchId: id } })).toBe(0);
    expect((await new LobbyRepository(client).getLobby(id, host)).viewer.canStart).toBe(true);
    expect((await new LobbyRepository(client).startLobby(id, host)).outcome).toBe("STARTED");
  });

  it("rolls back a real insertion error without committing RUNNING", async () => {
    const { id, host } = await fresh(); const constraint = `fixture_${randomUUID().replaceAll("-", "")}`;
    await client.$executeRawUnsafe(`ALTER TABLE "MatchWorld" ADD CONSTRAINT "${constraint}" CHECK ("matchId" <> '${id}') NOT VALID`);
    try { await expect(new LobbyRepository(client).startLobby(id, host)).rejects.toThrow(); }
    finally { await client.$executeRawUnsafe(`ALTER TABLE "MatchWorld" DROP CONSTRAINT "${constraint}"`); }
    expect((await client.match.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
    expect(await client.matchWorld.count({ where: { matchId: id } })).toBe(0);
  });

  it("rejects a worldless OPEN→RUNNING transition at commit, without touching legacy RUNNING rows", async () => {
    const { id } = await fresh();
    await expect(client.match.update({ where: { id }, data: { status: "RUNNING" } })).rejects.toThrow();
    expect((await client.match.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
    const old = await legacy(); const before = await client.match.findUniqueOrThrow({ where: { id: old.id }, include: { configuration: true, participants: true } });
    const worlds = new WorldRepository(client);
    for (let i = 0; i < 2; i++) {
      expect((await worlds.getWorld(old.id, old.host)).state).toBe("UNINITIALIZED");
      expect((await new LobbyRepository(client).startLobby(old.id, old.host)).outcome).toBe("ALREADY_STARTED");
    }
    expect(await client.match.findUniqueOrThrow({ where: { id: old.id }, include: { configuration: true, participants: true } })).toEqual(before);
    expect(await client.matchWorld.count({ where: { matchId: old.id } })).toBe(0);
  });

  it("requires a committed world to belong to RUNNING and rolls back a post-insert failure", async () => {
    const { id, host } = await fresh(); const detail = await new LobbyRepository(client).getLobby(id, host); const players = detail.participants.map((p) => p.playerId);
    await expect(client.$transaction(async (tx) => { await insertInitialWorld(tx, id, generated(players), players); })).rejects.toThrow();
    await expect(client.$transaction(async (tx) => {
      await insertInitialWorld(tx, id, generated(players), players);
      await tx.match.update({ where: { id }, data: { status: "RUNNING" } });
      throw new Error("fixture after-insert failure");
    })).rejects.toThrow();
    expect(await client.matchWorld.count({ where: { matchId: id } })).toBe(0);
    expect((await client.match.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
  });

  it("enforces immutable unique archives and seed/payload metadata constraints", async () => {
    const { id, host } = await fresh(); await new LobbyRepository(client).startLobby(id, host);
    const row = await client.matchWorld.findUniqueOrThrow({ where: { matchId: id } });
    await expect(client.matchWorld.create({ data: { ...row, payload: row.payload as Prisma.InputJsonValue } })).rejects.toThrow();
    await expect(client.matchWorld.update({ where: { matchId: id }, data: { payload: row.payload! as Prisma.InputJsonValue } })).rejects.toThrow();
    await expect(client.matchWorld.delete({ where: { matchId: id } })).rejects.toThrow();
    const old = await legacy();
    for (const data of [{ seed: -1n }, { seed: 4294967296n }, { seed: row.seed === 0n ? 1n : 0n }, { schemaVersion: 2 }, { payload: {} }]) {
      await expect(client.matchWorld.create({ data: { ...row, matchId: old.id, ...data, payload: ("payload" in data ? data.payload : row.payload) as Prisma.InputJsonValue } })).rejects.toThrow();
    }
    expect(await client.matchWorld.findUniqueOrThrow({ where: { matchId: id } })).toEqual(row);
  });

  it("authorizes exact active membership before reading and never initializes on reads", async () => {
    const { id, host, members } = await fresh(); const outsider = await account(); const worlds = new WorldRepository(client);
    expect((await worlds.getWorld(id, host)).state).toBe("NOT_STARTED");
    for (const target of [id, randomUUID()]) await expect(worlds.getWorld(target, outsider)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await new LobbyRepository(client).leaveLobby(id, members[1]!);
    await expect(worlds.getWorld(id, members[1]!)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await client.matchWorld.count({ where: { matchId: id } })).toBe(0);
  });
});
