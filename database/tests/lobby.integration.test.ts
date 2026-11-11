import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CreateLobbyResponseSchema, JoinLobbyResponseSchema, LeaveLobbyResponseSchema } from "@strategy-game/shared-types";
import { AuthRepository, createDatabaseClient, LobbyRepository } from "../src/index.js";
import { Prisma } from "../src/generated/prisma/client.js";
import { testDatabaseUrl } from "../src/environment.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("PostgreSQL lobbies (live database required)", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let repository: LobbyRepository;
  const matches: string[] = [];
  const identities: string[] = [];
  const settings = (playerCapacity = 2) => ({ name: `Lobby ${randomUUID()}`, playerCapacity, turnDurationMs: 300_000, visibility: "PUBLIC" });
  beforeAll(async () => {
    client = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    repository = new LobbyRepository(client);
    await client.$connect();
  });
  afterEach(async () => {
    // Only this test's newly created IDs. These fixtures never contain turns.
    await client.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { id: { in: [...matches] } } });
      await tx.oAuthAccount.deleteMany({ where: { identityId: { in: [...identities] } } });
      await tx.playerIdentity.deleteMany({ where: { id: { in: [...identities] }, participants: { none: {} }, hostedMatches: { none: {} } } });
    });
    matches.length = 0;
    identities.length = 0;
  });
  afterAll(async () => { if (client) await client.$disconnect(); });

  async function account(registered = true) {
    const id = randomUUID();
    identities.push(id);
    const username = `U${id.replaceAll("-", "").slice(0, 20)}`;
    await client.playerIdentity.create({ data: { id, ...(registered ? { username, usernameKey: username.toLowerCase() } : {}) } });
    return id;
  }
  async function fresh(capacity = 2) {
    const host = await account();
    const lobby = await repository.createLobby(host, settings(capacity));
    matches.push(lobby.lobbyId);
    return { host, lobby, id: lobby.lobbyId };
  }
  async function activeCount(id: string) { return client.matchParticipant.count({ where: { matchId: id, active: true } }); }

  it("atomically creates immutable settings and opaque host membership without a world, turn, or deadline", async () => {
    const { host, lobby, id } = await fresh();
    expect(CreateLobbyResponseSchema.parse({ schemaVersion: 1, lobby }).lobby).toEqual(lobby);
    expect(lobby.viewer).toMatchObject({ role: "HOST", canLeave: false, canStart: false });
    expect(lobby.host.playerId).not.toBe(host);
    expect(await client.match.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "OPEN", hostIdentityId: host, createdAt: expect.any(Date), currentStateVersion: 0n });
    expect(await client.matchConfiguration.findUniqueOrThrow({ where: { matchId: id } })).toMatchObject({ name: lobby.settings.name, playerCapacity: 2, turnDurationMs: 300_000n, pinnedRuleset: null, simulationVersion: null });
    expect(await client.turn.count({ where: { matchId: id } })).toBe(0);
    expect(await client.gameSnapshotRecord.count({ where: { matchId: id } })).toBe(0);
    await expect(client.matchConfiguration.update({ where: { matchId: id }, data: { name: "Changed" } })).rejects.toThrow();
    await expect(client.match.update({ where: { id }, data: { createdAt: new Date(0) } })).rejects.toThrow();
  });

  it.each([
    { playerCapacity: 1 }, { playerCapacity: 41 }, { turnDurationMs: 0 },
    { turnDurationMs: 1.5 }, { turnDurationMs: Number.MAX_SAFE_INTEGER + 1 },
    { name: " padded " }, { visibility: "PRIVATE" }, { scenarioId: "empty-world" }
  ])("rejects invalid settings without creating any match: %j", async (change) => {
    const host = await account();
    await expect(repository.createLobby(host, { ...settings(), ...change })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await client.match.count({ where: { hostIdentityId: host } })).toBe(0);
  });

  it("accepts boundary capacities and contract durations without inventing a deadline", async () => {
    for (const playerCapacity of [2, 40]) {
      const host = await account();
      const lobby = await repository.createLobby(host, { ...settings(playerCapacity), turnDurationMs: Number.MAX_SAFE_INTEGER });
      matches.push(lobby.lobbyId);
      expect(lobby.settings.turnDurationMs).toBe(Number.MAX_SAFE_INTEGER);
      expect(lobby.durationCategory).toBe("UNCATEGORIZED");
    }
  });

  it("requires a known registered identity for every operation", async () => {
    const { id } = await fresh();
    const unregistered = await account(false);
    for (const identity of [unregistered, randomUUID()]) {
      const code = identity === unregistered ? "USERNAME_REQUIRED" : "UNAUTHENTICATED";
      for (const operation of [
        () => repository.createLobby(identity, settings()), () => repository.listLobbies(identity),
        () => repository.getLobby(id, identity), () => repository.joinLobby(id, identity), () => repository.leaveLobby(id, identity)
      ]) await expect(operation()).rejects.toMatchObject({ code });
    }
    expect(await activeCount(id)).toBe(1);
  });

  it("enforces unique identity membership in PostgreSQL, including inactive slots", async () => {
    const { id } = await fresh();
    const guest = await account();
    await repository.joinLobby(id, guest);
    await repository.leaveLobby(id, guest);
    await expect(client.matchParticipant.create({ data: { matchId: id, identityId: guest, playerId: randomUUID(), active: true } })).rejects.toMatchObject({ code: "P2002" });
    expect(await client.matchParticipant.count({ where: { matchId: id, identityId: guest } })).toBe(1);
  });

  it("acknowledges duplicate joins, including host and full-lobby retries, without allocating another ID", async () => {
    const { id, host, lobby } = await fresh();
    const guest = await account();
    const joined = await repository.joinLobby(id, guest);
    expect(JoinLobbyResponseSchema.parse({ schemaVersion: 1, ...joined }).outcome).toBe("JOINED");
    const repeated = await repository.joinLobby(id, guest);
    expect(repeated).toEqual({ ...joined, outcome: "ALREADY_JOINED" });
    expect((await repository.joinLobby(id, host)).lobby.host).toEqual(lobby.host);
    expect(await activeCount(id)).toBe(2);
  });

  it("serializes concurrent duplicate joins into one membership", async () => {
    const { id } = await fresh();
    const guest = await account();
    const results = await Promise.all([repository.joinLobby(id, guest), repository.joinLobby(id, guest)]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["ALREADY_JOINED", "JOINED"]);
    expect(results[0]?.lobby.viewer.playerId).toBe(results[1]?.lobby.viewer.playerId);
    expect(await activeCount(id)).toBe(2);
  });

  it("allows exactly one concurrent contender for the last slot across clients", async () => {
    const { id } = await fresh();
    const guests = await Promise.all([account(), account()]);
    const otherClient = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const otherRepository = new LobbyRepository(otherClient);
      const results = await Promise.allSettled([repository.joinLobby(id, guests[0]!), otherRepository.joinLobby(id, guests[1]!)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "LOBBY_FULL" } });
      expect(await activeCount(id)).toBe(2);
    } finally { await otherClient.$disconnect(); }
  });

  it("rejects full-lobby joins and reactivations without altering stored membership", async () => {
    const { id } = await fresh();
    const first = await account();
    const second = await account();
    await repository.joinLobby(id, first);
    await repository.leaveLobby(id, first);
    await repository.joinLobby(id, second);
    for (const guest of [first, await account()]) await expect(repository.joinLobby(id, guest)).rejects.toMatchObject({ code: "LOBBY_FULL" });
    expect(await activeCount(id)).toBe(2);
    expect(await client.matchParticipant.count({ where: { matchId: id } })).toBe(3);
  });

  it("leaves and rejoins with the same match-local ID, preserving host ownership", async () => {
    const { host, id, lobby } = await fresh();
    const guest = await account();
    const first = await repository.joinLobby(id, guest);
    const left = await repository.leaveLobby(id, guest);
    expect(LeaveLobbyResponseSchema.parse({ schemaVersion: 1, lobby: left }).lobby.viewer.role).toBe("NON_PARTICIPANT");
    expect(left.host).toEqual(lobby.host);
    expect((await repository.joinLobby(id, guest)).lobby.viewer.playerId).toBe(first.lobby.viewer.playerId);
    await expect(repository.leaveLobby(id, host)).rejects.toMatchObject({ code: "HOST_CANNOT_LEAVE" });
    await expect(repository.leaveLobby(id, await account())).rejects.toMatchObject({ code: "NOT_A_PARTICIPANT" });
    expect(await activeCount(id)).toBe(2);
  });

  it("rejects every RUNNING join/leave, including existing members and duplicate retries", async () => {
    const { host, id } = await fresh(3);
    const guest = await account();
    const outsider = await account();
    await repository.joinLobby(id, guest);
    // Simulate a future start transaction; no repository start API/Turn 1 is added.
    await client.match.update({ where: { id }, data: { status: "RUNNING" } });
    const before = await client.matchParticipant.findMany({ where: { matchId: id } });
    for (const identity of [host, guest, outsider]) {
      await expect(repository.joinLobby(id, identity)).rejects.toMatchObject({ code: "LOBBY_NOT_OPEN" });
      await expect(repository.leaveLobby(id, identity)).rejects.toMatchObject({ code: "LOBBY_NOT_OPEN" });
    }
    expect(await client.matchParticipant.findMany({ where: { matchId: id } })).toEqual(before);
    await expect(client.match.update({ where: { id }, data: { status: "OPEN" } })).rejects.toThrow();
  });

  it("reads committed lifecycle after waiting for the parent Match lock", async () => {
    const { id } = await fresh(3);
    await repository.joinLobby(id, await account());
    const guest = await account();
    let joining: ReturnType<LobbyRepository["joinLobby"]> | undefined;
    const contenderClient = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      await contenderClient.$connect();
      await client.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Match" WHERE "id" = ${id} FOR UPDATE`);
        const [holder] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        joining = new LobbyRepository(contenderClient).joinLobby(id, guest);
        // Attach a handler immediately, then prove the other connection actually
        // waits for our lock before changing status (rather than relying on timing).
        void joining.catch(() => undefined);
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          // pg_stat_activity otherwise caches a statistics snapshot for this
          // transaction, which can omit a newly connected contender backend.
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const [observed] = await tx.$queryRaw<{ waiting: boolean }[]>(Prisma.sql`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${holder!.pid} = ANY(pg_blocking_pids(pid))) AS waiting
          `);
          waiting = observed!.waiting;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await tx.match.update({ where: { id }, data: { status: "RUNNING" } });
      });
      await expect(joining).rejects.toMatchObject({ code: "LOBBY_NOT_OPEN" });
      expect(await activeCount(id)).toBe(2);
    } finally {
      await joining?.catch(() => undefined);
      await contenderClient.$disconnect();
    }
  });

  it("rolls back match/config creation when host membership insertion fails", async () => {
    const host = await account();
    const input = settings();
    const constraint = `test_lobby_${randomUUID().replaceAll("-", "")}`;
    // Force a real SQL failure at the final insert. Only this newly-created
    // identity is affected; NOT VALID leaves every pre-existing row untouched.
    await client.$executeRawUnsafe(`ALTER TABLE "MatchParticipant" ADD CONSTRAINT "${constraint}" CHECK ("identityId" <> '${host}') NOT VALID`);
    try {
      await expect(repository.createLobby(host, input)).rejects.toThrow();
      expect(await client.match.count({ where: { hostIdentityId: host } })).toBe(0);
      expect(await client.matchConfiguration.count({ where: { name: input.name } })).toBe(0);
      expect(await client.matchParticipant.count({ where: { identityId: host } })).toBe(0);
    } finally {
      await client.$executeRawUnsafe(`ALTER TABLE "MatchParticipant" DROP CONSTRAINT "${constraint}"`);
    }
    const recovered = await repository.createLobby(host, input);
    matches.push(recovered.lobbyId);
    expect(recovered.participantCount).toBe(1);
  });

  it("recovers safe public projections through a fresh client and preserves auth/legacy data", async () => {
    const auth = new AuthRepository(client);
    const player = await auth.signIn("discord", `lobby-${randomUUID()}`);
    identities.push(player.id);
    await auth.selectUsername(player.id, `U${randomUUID().replaceAll("-", "").slice(0, 20)}`);
    const profile = await auth.profile(player.id);
    const legacyId = randomUUID();
    matches.push(legacyId);
    await client.match.create({ data: { id: legacyId, participants: { create: { playerId: "legacy-player", identityId: player.id, active: true } } } });
    const legacyBefore = await client.match.findUniqueOrThrow({ where: { id: legacyId }, include: { participants: true } });
    const lobby = await repository.createLobby(player.id, settings());
    matches.push(lobby.lobbyId);
    const guest = await account();
    const joined = await repository.joinLobby(lobby.lobbyId, guest);
    const otherClient = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const restored = new LobbyRepository(otherClient);
      expect(await restored.getLobby(lobby.lobbyId, guest)).toEqual(joined.lobby);
      const list = await restored.listLobbies(guest, { schemaVersion: 1, status: "OPEN", durationCategory: "QUICK" });
      expect(list.some((item) => item.lobbyId === lobby.lobbyId)).toBe(true);
      expect(list.some((item) => item.lobbyId === legacyId)).toBe(false);
      const encoded = JSON.stringify([list, joined.lobby]);
      for (const secret of [player.id, guest, "identityId", "oauthAccounts", "session", "snapshot", "pinnedRuleset", "currentStateVersion"]) expect(encoded).not.toContain(secret);
      expect(joined.lobby.participants.map((member) => member.playerId)).not.toContain("legacy-player");
      expect(await auth.profile(player.id)).toEqual(profile);
      expect(await client.match.findUniqueOrThrow({ where: { id: legacyId }, include: { participants: true } })).toEqual(legacyBefore);
      await expect(restored.getLobby(legacyId, guest)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(restored.getLobby(randomUUID(), guest)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally { await otherClient.$disconnect(); }
  });
});
