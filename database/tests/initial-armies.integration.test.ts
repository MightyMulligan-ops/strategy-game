import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateWorld, initializeArmiesTurnOne } from "@strategy-game/game-engine";
import { createDatabaseClient, LobbyRepository, MatchRepository, WorldRepository } from "../src/index.js";
import { testDatabaseUrl } from "../src/environment.js";
import { Prisma } from "../src/generated/prisma/client.js";
import { json } from "../src/mappings.js";
import { insertInitialWorld } from "../src/world-repository.js";
import { insertTurn } from "../src/turn-storage.js";
import { INITIAL_ARMIES_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { FormationReadRepository } from "../src/formation-read-repository.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("atomic initial-armies Turn 1 (fresh hosted CI only)", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  const matches: string[] = []; const accounts: string[] = [];
  beforeAll(async () => {
    if (process.env.GITHUB_ACTIONS !== "true") throw new Error("This suite requires the approved fresh hosted CI service; local DB execution is prohibited");
    client = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL)); await client.$connect();
  });
  afterEach(async () => {
    if (!client) return;
    await client.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { id: { in: matches } } });
      await tx.playerIdentity.deleteMany({ where: { id: { in: accounts }, participants: { none: {} }, hostedMatches: { none: {} } } });
    }); matches.length = 0; accounts.length = 0;
  });
  afterAll(async () => { if (client) await client.$disconnect(); });
  async function account() {
    const id = randomUUID(); accounts.push(id); const username = `U${id.replaceAll("-", "").slice(0, 20)}`;
    await client.playerIdentity.create({ data: { id, username, usernameKey: username.toLowerCase() } }); return id;
  }
  function world(players: readonly string[]) {
    const result = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: 123, settings: { regionSide: 5 }, players });
    if (!result.ok) throw new Error("Invalid test world"); return result.world;
  }
  async function fresh(count = 2, duration = 1000, clock = vi.fn(() => 10_000)) {
    const factory = vi.fn(world); const repository = new LobbyRepository(client, factory, clock, INITIAL_ARMIES_RUNTIME_PROFILE);
    const host = await account(); const lobby = await repository.createLobby(host, { name: "Initial turn", playerCapacity: 40, turnDurationMs: duration, visibility: "PUBLIC" });
    const id = lobby.lobbyId; matches.push(id); const members = [host];
    for (let i = 1; i < count; i++) { const member = await account(); members.push(member); await repository.joinLobby(id, member); }
    for (const member of members) await repository.setReady(id, member, true);
    return { id, host, members, repository, factory, clock };
  }
  async function legacy(status: "OPEN" | "RUNNING" = "OPEN", tx: Prisma.TransactionClient = client) {
    const host = await account(); const guest = await account(); const id = randomUUID(); matches.push(id);
    await tx.match.create({ data: { id, status, hostIdentityId: host, createdAt: new Date(0),
      configuration: { create: { schemaVersion: 1, name: "Legacy", playerCapacity: 2, turnDurationMs: 1000n, config: { schemaVersion: 1, gameId: id, turnDurationMs: 1000 } } },
      participants: { create: [host, guest].map((identityId) => ({ playerId: randomUUID(), identityId, active: true, lobbyReady: true })) }
    } }); return { id, host, guest };
  }
  async function inspect(id: string) {
    return client.match.findUniqueOrThrow({ where: { id }, include: { configuration: true, world: true, snapshots: true,
      turns: { include: { players: { include: { revisions: true, orders: true } } } } } });
  }
  async function assertRolledBack(id: string) {
    const row = await inspect(id); expect(row.status).toBe("OPEN"); expect(row.currentStateVersion).toBe(0n);
    expect(row.world).toBeNull(); expect(row.snapshots).toEqual([]); expect(row.turns).toEqual([]);
  }
  async function rawBundle(tx: Prisma.TransactionClient, id: string, change?: (payload: Record<string, unknown>) => void, omit?: "snapshot" | "turn" | "player" | "history" | "json-command") {
    const c = await tx.matchConfiguration.findUniqueOrThrow({ where: { matchId: id } });
    const roster = await tx.matchParticipant.findMany({ where: { matchId: id, active: true }, orderBy: { playerId: "asc" } });
    const archive = await insertInitialWorld(tx, id, world(roster.map((p) => p.playerId)), roster.map((p) => p.playerId));
    const plan = initializeArmiesTurnOne(c.config, roster.map((p) => ({ schemaVersion: 1, gameId: id, playerId: p.playerId, active: true })), archive, 10_000);
    const payload = json(plan.snapshot) as Record<string, Prisma.InputJsonValue>; change?.(payload);
    if (omit !== "snapshot") await tx.gameSnapshotRecord.create({ data: { matchId: id, stateVersion: 0n, completedTurnNumber: 0n, snapshotId: plan.snapshot.snapshotId, payload } });
    if (omit !== "turn") {
      if (!omit) await insertTurn(tx, plan.state, plan.snapshot);
      else {
        await tx.turn.create({ data: { matchId: id, number: 1n, startingStateVersion: 0n, status: "OPEN", openedAtMs: 10_000n, deadlineAtMs: 11_000n, lastObservedAtMs: 10_000n } });
        for (const [i, p] of roster.entries()) {
          if (omit === "player" && i === 0) continue;
          const scope = { matchId: id, turnNumber: 1n, playerId: p.playerId };
          await tx.playerTurnState.create({ data: { ...scope, active: true, revision: 0n, ready: false } });
          if (!(omit === "history" && i === 0)) await tx.playerSubmissionRevision.create({ data: { ...scope, revision: 0n, kind: "INITIAL", ready: false, orders: [], ...(omit === "json-command" ? { command: Prisma.JsonNull } : {}) } });
        }
      }
    }
    await tx.match.update({ where: { id }, data: { status: "RUNNING" } });
  }

  it.each([2, 4, 10, 40])("atomically persists and restores deterministic %i-player initialization", async (count) => {
    const f = await fresh(count); const config = await client.matchConfiguration.findUniqueOrThrow({ where: { matchId: f.id } });
    expect(config).toMatchObject({ rulesetId: "initial-armies", rulesetVersion: "1", simulationVersion: "initial-armies-v1" });
    expect((await f.repository.startLobby(f.id, f.host)).outcome).toBe("STARTED");
    const row = await inspect(f.id); expect(row.configuration).toEqual(config); expect(row.snapshots).toHaveLength(1); expect(row.turns).toHaveLength(1);
    expect(row.turns[0]!.players).toHaveLength(count); expect(f.clock).toHaveBeenCalledTimes(1); expect(f.factory).toHaveBeenCalledTimes(1);
    const other = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const restored = await new MatchRepository(other).loadTurn(f.id, 1);
      expect(restored.kind).toBe("initial_armies"); expect(restored.snapshot).toEqual(row.snapshots[0]!.payload);
      expect(restored.state.turn).toMatchObject({ status: "open", openedAtMs: 10_000, deadlineAtMs: 11_000 });
      expect(restored.state.drafts.every((p) => p.revision === 0 && !p.ready && p.orders.length === 0)).toBe(true);
      expect((await new LobbyRepository(other).startLobby(f.id, f.host)).outcome).toBe("ALREADY_STARTED");
      expect(await inspect(f.id)).toEqual(row);
    } finally { await other.$disconnect(); }
  }, 30_000);
  it("serializes concurrent starts and samples time/generation once", async () => {
    const f = await fresh(); const other = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const results = await Promise.all([f.repository.startLobby(f.id, f.host), new LobbyRepository(other, f.factory, f.clock).startLobby(f.id, f.host)]);
      expect(results.map((r) => r.outcome).sort()).toEqual(["ALREADY_STARTED", "STARTED"]);
      expect(f.clock).toHaveBeenCalledTimes(1); expect(f.factory).toHaveBeenCalledTimes(1);
      expect((await inspect(f.id)).turns).toHaveLength(1);
    } finally { await other.$disconnect(); }
  });
  it.each([1, Number.MAX_SAFE_INTEGER])("preserves duration rules for %i milliseconds and rolls overflow back", async (duration) => {
    const f = await fresh(2, duration);
    if (duration === 1) { await f.repository.startLobby(f.id, f.host); expect((await inspect(f.id)).turns[0]!.deadlineAtMs).toBe(10_001n); }
    else { await expect(f.repository.startLobby(f.id, f.host)).rejects.toThrow(); await assertRolledBack(f.id); }
  });
  it.each(["MatchWorld", "GameSnapshotRecord", "Turn", "PlayerTurnState", "PlayerSubmissionRevision"])("rolls all initialization back after a %s insertion failure", async (table) => {
    const f = await fresh(); const name = `fixture_${randomUUID().replaceAll("-", "")}`;
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK ("matchId" <> '${f.id}') NOT VALID`);
    try { await expect(f.repository.startLobby(f.id, f.host)).rejects.toThrow(); await assertRolledBack(f.id); expect((await f.repository.getLobby(f.id, f.host)).viewer.canStart).toBe(true); }
    finally { await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`); }
    expect((await f.repository.startLobby(f.id, f.host)).outcome).toBe("STARTED");
  });
  it("rolls back all children when the final RUNNING transition fails", async () => {
    const f = await fresh(); const name = `fixture_${randomUUID().replaceAll("-", "")}`;
    await client.$executeRawUnsafe(`ALTER TABLE "Match" ADD CONSTRAINT "${name}" CHECK ("id" <> '${f.id}' OR "status" = 'OPEN') NOT VALID`);
    try { await expect(f.repository.startLobby(f.id, f.host)).rejects.toThrow(); await assertRolledBack(f.id); }
    finally { await client.$executeRawUnsafe(`ALTER TABLE "Match" DROP CONSTRAINT "${name}"`); }
  });
  it.each(["snapshot", "turn", "player", "history", "json-command"] as const)("rejects a partial or invalid %s bundle", async (omit) => {
    const f = await fresh(); await expect(client.$transaction((tx) => rawBundle(tx, f.id, undefined, omit))).rejects.toThrow(); await assertRolledBack(f.id);
  });
  it.each(["schemaVersion", "kind", "config", "players", "worldRef", "stateVersion"])("rejects JSON null/missing %s at commit", async (field) => {
    const f = await fresh(); await expect(client.$transaction((tx) => rawBundle(tx, f.id, (p) => { p[field] = null; }))).rejects.toThrow(); await assertRolledBack(f.id);
  });
  it("rejects a same-size mismatched active roster", async () => {
    const f = await fresh(); await expect(client.$transaction((tx) => rawBundle(tx, f.id, (p) => {
      const players = p.players as { playerId: string }[]; players[0]!.playerId = "not-an-active-member";
    }))).rejects.toThrow(); await assertRolledBack(f.id);
  });
  it("recomputes the digest on restoration rather than trusting its SQL format", async () => {
    const f = await fresh(); await client.$transaction((tx) => rawBundle(tx, f.id, (p) => { (p.worldRef as Record<string, unknown>).digest = `sha256:${"a".repeat(64)}`; }));
    await expect(new MatchRepository(client).loadTurn(f.id, 1)).rejects.toMatchObject({ code: "invalid_storage" });
  });
  it.each(["turn", "snapshot", "history", "configuration"])("protects %s removal while allowing full parent cascade", async (kind) => {
    const f = await fresh(); await f.repository.startLobby(f.id, f.host);
    const deletion = kind === "turn" ? client.turn.deleteMany({ where: { matchId: f.id } }) : kind === "snapshot" ? client.gameSnapshotRecord.deleteMany({ where: { matchId: f.id } }) :
      kind === "history" ? client.playerSubmissionRevision.deleteMany({ where: { matchId: f.id } }) : client.matchConfiguration.delete({ where: { matchId: f.id } });
    await expect(deletion).rejects.toThrow(); await client.match.delete({ where: { id: f.id } });
    expect(await client.turn.count({ where: { matchId: f.id } })).toBe(0); expect(await client.gameSnapshotRecord.count({ where: { matchId: f.id } })).toBe(0);
  });
  it("preserves world-only legacy OPEN and never backfills RUNNING on retries or reads", async () => {
    const old = await legacy(); const clock = vi.fn(() => { throw new Error("Legacy must not read turn time"); });
    await new LobbyRepository(client, world, clock).startLobby(old.id, old.host);
    expect((await inspect(old.id)).turns).toEqual([]); expect((await inspect(old.id)).snapshots).toEqual([]); expect(clock).not.toHaveBeenCalled();
    const running = await legacy("RUNNING"); const before = await inspect(running.id); const generator = vi.fn(world);
    for (let i = 0; i < 2; i++) {
      expect((await new LobbyRepository(client, generator, clock).startLobby(running.id, running.host)).outcome).toBe("ALREADY_STARTED");
      expect((await new WorldRepository(client).getWorld(running.id, running.host)).state).toBe("UNINITIALIZED");
    }
    expect(await inspect(running.id)).toEqual(before); expect(generator).not.toHaveBeenCalled();
  });
  it("checks host/Ready authorization before generating or sampling time", async () => {
    const f = await fresh(); await expect(f.repository.startLobby(f.id, f.members[1]!)).rejects.toMatchObject({ code: "HOST_REQUIRED" });
    await f.repository.setReady(f.id, f.members[1]!, false); await expect(f.repository.startLobby(f.id, f.host)).rejects.toMatchObject({ code: "NOT_ALL_READY" });
    expect(f.clock).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled(); await assertRolledBack(f.id);
  });
  it.each(["partial", "unsupported"])("fails closed for %s runtime metadata", async (kind) => {
    const host = await account(); const id = randomUUID(); matches.push(id);
    const create = () => client.match.create({ data: { id, status: "OPEN", hostIdentityId: host, createdAt: new Date(0),
      configuration: { create: { schemaVersion: 1, name: "Unsupported", playerCapacity: 2, turnDurationMs: 1000n,
        config: { schemaVersion: 1, gameId: id, turnDurationMs: 1000 }, rulesetId: "future", rulesetVersion: "1", simulationVersion: "future-v1",
        ...(kind === "unsupported" ? { pinnedRuleset: { schemaVersion: 1, ruleset: { rulesetId: "future", version: "1" }, simulationVersion: "future-v1", movementTieBreakPolicy: "seeded-shuffle-v1" } } : {}) } },
      participants: { create: { playerId: randomUUID(), identityId: host, active: true, lobbyReady: true } } } });
    if (kind === "partial") await expect(create()).rejects.toThrow();
    else {
      await create(); const clock = vi.fn(() => 10_000); const generator = vi.fn(world);
      const guest = await account(); await new LobbyRepository(client).joinLobby(id, guest); await new LobbyRepository(client).setReady(id, guest, true);
      await expect(new LobbyRepository(client, generator, clock).startLobby(id, host)).rejects.toThrow();
      expect(generator).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled(); await assertRolledBack(id);
    }
  });

  it("reads only own persisted formations and rejects all mutation entry points", async () => {
    const f = await fresh(); await f.repository.startLobby(f.id, f.host);
    const before = await inspect(f.id); const reader = new FormationReadRepository(client);
    const own = await reader.getFormations(f.id, f.host); expect(own.state).toBe("READY");
    const guest = await reader.getFormations(f.id, f.members[1]!); expect(guest.state).toBe("READY");
    if (own.state === "READY" && guest.state === "READY") expect(own.formations[0]!.formationId).not.toBe(guest.formations[0]!.formationId);
    await expect(reader.getFormations(f.id, await account())).rejects.toMatchObject({ code: "NOT_FOUND" });
    const r = new MatchRepository(client);
    await expect(r.submitCommand(f.id, 1, "ignored", {}, () => 20_000)).rejects.toMatchObject({ code: "unsupported_runtime_operation" });
    await expect(r.observeDeadline(f.id, 1, () => 20_000)).rejects.toMatchObject({ code: "unsupported_runtime_operation" });
    await expect(r.prepareResolution(f.id, 1, 1)).rejects.toMatchObject({ code: "unsupported_runtime_operation" });
    await expect(r.openFollowingTurn(f.id, 1, 20_000)).rejects.toMatchObject({ code: "unsupported_runtime_operation" });
    await expect(client.match.update({ where: { id: f.id }, data: { currentStateVersion: 1n } })).rejects.toThrow();
    await expect(client.playerTurnState.updateMany({ where: { matchId: f.id }, data: { ready: true } })).rejects.toThrow();
    await expect(client.turn.updateMany({ where: { matchId: f.id }, data: { status: "CLOSED" } })).rejects.toThrow();
    await expect(client.matchParticipant.updateMany({ where: { matchId: f.id }, data: { active: false } })).rejects.toThrow();
    const target = await legacy();
    await expect(client.matchParticipant.updateMany({ where: { matchId: f.id }, data: { matchId: target.id } })).rejects.toThrow();
    expect(await inspect(f.id)).toEqual(before);
  });
  it.each(["policy", "source", "composition", "position", "member", "duplicate", "extra-field"])("SQL rejects malformed army %s and rolls back", async (kind) => {
    const f = await fresh();
    await expect(client.$transaction((tx) => rawBundle(tx, f.id, (p) => {
      const units = p.units as Record<string, unknown>[]; const formations = p.formations as Record<string, unknown>[];
      if (kind === "policy") (p.policy as Record<string, unknown>).rangePerTurn = 251;
      if (kind === "source") units[0]!.originalSpawnNodeId = "wrong-node";
      if (kind === "composition") units[0]!.kind = "CAVALRY";
      if (kind === "position") formations[0]!.position = { x: 0, y: 0 };
      if (kind === "member") (formations[0]!.unitIds as string[])[0] = `unit:${"0".repeat(64)}`;
      if (kind === "duplicate") units[0]!.unitId = units[1]!.unitId;
      if (kind === "extra-field") units[0]!.hp = 100;
    }))).rejects.toThrow(); await assertRolledBack(f.id);
  });
});
