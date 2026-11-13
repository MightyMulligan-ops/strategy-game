import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MOVEMENT_DRAFT_RUNTIME_PROFILE, INITIAL_ARMIES_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { generateWorld } from "@strategy-game/game-engine";
import { createDatabaseClient, LobbyRepository, MatchRepository, MovementDraftRepository, FormationReadRepository } from "../src/index.js";
import { testDatabaseUrl } from "../src/environment.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("movement drafts (separately approved fresh hosted PostgreSQL only)", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  const matches: string[] = [], accounts: string[] = [];
  beforeAll(async () => {
    if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Fresh hosted CI authorization required; no local database execution");
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
  async function fresh(count = 2, old = false, duration = 300_000, openingClock: () => number = Date.now) {
    const world = (players: readonly string[]) => {
      const result = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: 123, players, settings: { regionSide: 5 } });
      if (!result.ok) throw new Error("Fixture world failed"); return result.world;
    };
    const lobbies = new LobbyRepository(client, world, openingClock, old ? INITIAL_ARMIES_RUNTIME_PROFILE : MOVEMENT_DRAFT_RUNTIME_PROFILE);
    const host = await account(), lobby = await lobbies.createLobby(host, { name: "Movement drafts", playerCapacity: 40, turnDurationMs: duration, visibility: "PUBLIC" });
    const id = lobby.lobbyId; matches.push(id); const members = [host];
    for (let i = 1; i < count; i++) { const identity = await account(); members.push(identity); await lobbies.joinLobby(id, identity); }
    for (const member of members) await lobbies.setReady(id, member, true);
    await lobbies.startLobby(id, host);
    const projected = await new FormationReadRepository(client).getFormations(id, host);
    if (projected.state !== "READY") throw new Error("Missing own formation");
    const formation = projected.formations[0]!, dir = formation.position.x < 500 ? 1 : -1;
    const order = (name: string, offset: number) => ({ type: "move" as const, orderId: name, stackId: formation.formationId, destination: { x: formation.position.x + dir * offset, y: formation.position.y } });
    const repo = new MovementDraftRepository(client);
    const submit = (orders: ReturnType<typeof order>[], expectedRevision = 0) => repo.submitDraft(id, 1, host, { schemaVersion: 1, kind: "replace_orders", expectedRevision, orders });
    return { id, host, members, lobbies, formation, order, repo, submit };
  }
  const inspect = (id: string) => client.match.findUniqueOrThrow({ where: { id }, include: { configuration: true, world: true, snapshots: true,
    turns: { include: { players: { include: { orders: true, revisions: true } }, frozenInput: true, resolution: true } } } });
  it.each([2, 4, 10, 40])("initializes/restores %i-player v4 and persists only the caller draft", async (count) => {
    const f = await fresh(count), before = await inspect(f.id);
    const accepted = await f.submit([f.order("first", 250)]); expect(accepted.route.remaining).toBe(0);
    const second = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      expect(await new MovementDraftRepository(second).getDraft(f.id, 1, f.host)).toEqual(accepted);
      const other = await new MovementDraftRepository(second).getDraft(f.id, 1, f.members[1]!);
      expect(other.state).toBe("READY"); if (other.state === "READY") expect(other.own.orders).toEqual([]);
    } finally { await second.$disconnect(); }
    const after = await inspect(f.id); expect(after.world).toEqual(before.world); expect(after.snapshots).toEqual(before.snapshots); expect(after.configuration).toEqual(before.configuration);
    expect(after.turns[0]).toMatchObject({ status: "OPEN", openedAtMs: before.turns[0]!.openedAtMs, lastObservedAtMs: before.turns[0]!.openedAtMs, frozenInput: null, resolution: null });
    expect((await new MatchRepository(client).loadTurn(f.id, 1)).kind).toBe("movement_drafts");
  });
  it("serializes concurrent revisions across connections and preserves independent players", async () => {
    const f = await fresh(), second = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const competing = await Promise.allSettled([f.submit([f.order("a", 100)]), new MovementDraftRepository(second).submitDraft(f.id, 1, f.host, { schemaVersion: 1, kind: "replace_orders", expectedRevision: 0, orders: [f.order("b", 150)] })]);
      expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(competing.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "STALE_REVISION" } });
      await new MovementDraftRepository(second).submitDraft(f.id, 1, f.members[1]!, { schemaVersion: 1, kind: "replace_orders", expectedRevision: 0, orders: [] });
      expect((await client.playerTurnState.findMany({ where: { matchId: f.id } })).map((r) => r.revision)).toEqual([1n, 1n]);
    } finally { await second.$disconnect(); }
  });
  it("edits, swaps and compacts stable IDs while history reconstructs current and retired rows", async () => {
    const f = await fresh(); await f.submit([f.order("a", 50), f.order("b", 100)]);
    await f.submit([f.order("b", 100), f.order("a", 60)], 1);
    const canceled = await f.repo.submitDraft(f.id, 1, f.host, { schemaVersion: 1, kind: "cancel_order", expectedRevision: 2, orderId: "b" });
    expect(canceled.route.segments.map((s) => [s.orderId, s.moveNumber])).toEqual([["a", 1]]);
    expect((await new MatchRepository(client).loadTurn(f.id, 1)).state.drafts.find((p) => p.playerId === f.formation.ownerPlayerId)!.revision).toBe(3);
    expect(await client.playerSubmissionRevision.count({ where: { matchId: f.id, playerId: f.formation.ownerPlayerId } })).toBe(4);
  });
  it.each(["PlayerSubmissionRevision", "PlayerTurnState", "PlayerOrder"])("rolls the full command back when %s fails", async (table) => {
    const f = await fresh(), before = await inspect(f.id), name = `fixture_${randomUUID().replaceAll("-", "")}`;
    const column = table === "PlayerOrder" ? '"lastRevision"' : '"revision"';
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK ("matchId" <> '${f.id}' OR ${column} = 0) NOT VALID`);
    try { await expect(f.submit([f.order("a", 50)])).rejects.toThrow(); expect(await inspect(f.id)).toEqual(before); }
    finally { await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`); }
  });
  it("rejects stale, foreign, over-budget and exact-deadline submissions without closure", async () => {
    const f = await fresh(), before = await inspect(f.id), turn = before.turns[0]!;
    await expect(f.submit([f.order("a", 251)])).rejects.toMatchObject({ code: "INVALID_DRAFT" });
    await expect(f.submit([], 1)).rejects.toMatchObject({ code: "STALE_REVISION" });
    await expect(new MovementDraftRepository(client, () => Number(turn.deadlineAtMs)).submitDraft(f.id, 1, f.host, { schemaVersion: 1, kind: "replace_orders", expectedRevision: 0, orders: [] })).rejects.toMatchObject({ code: "DEADLINE_PASSED" });
    await expect(f.repo.submitDraft(f.id, 1, f.members[1]!, { schemaVersion: 1, kind: "replace_orders", expectedRevision: 0, orders: [f.order("foreign", 0)] })).rejects.toMatchObject({ code: "INVALID_DRAFT" });
    expect(await inspect(f.id)).toEqual(before);
  });
  it("SQL validates exact fractional JSONB coordinates and trimmed IDs before float conversion", async () => {
    const f = await fresh(), order = f.order("a", 0);
    const fractional = JSON.stringify([order]).replace(`"x":${order.destination.x}`, `"x":${order.destination.x}.000000000000000001`);
    const padded = JSON.stringify([{ ...order, orderId: "\tpad" }]);
    for (const raw of [fractional, padded]) {
      const checked = await client.$queryRaw<{ valid: boolean }[]>`SELECT movement_draft_queue_ok(${f.id}, ${f.formation.ownerPlayerId}, ${raw}::jsonb) AS valid`;
      expect(checked[0]!.valid).toBe(false);
    }
    const validId = JSON.stringify([{ ...order, orderId: "\u0085allowed" }]);
    const valid = await client.$queryRaw<{ valid: boolean }[]>`SELECT movement_draft_queue_ok(${f.id}, ${f.formation.ownerPlayerId}, ${validId}::jsonb) AS valid`;
    expect(valid[0]!.valid).toBe(true); // U+0085 is not trimmed by the JS contract.
    expect((await f.repo.getDraft(f.id, 1, f.host)).state).toBe("READY");
  });
  it("SQL rejects an expired persistence window even if the injected application clock is behind", async () => {
    const f = await fresh(2, false, 1, () => Date.now() - 10_000), before = await inspect(f.id), opening = Number(before.turns[0]!.openedAtMs);
    await expect(new MovementDraftRepository(client, () => opening).submitDraft(f.id, 1, f.host,
      { schemaVersion: 1, kind: "replace_orders", expectedRevision: 0, orders: [] })).rejects.toMatchObject({ code: "DEADLINE_PASSED" });
    expect(await inspect(f.id)).toEqual(before); expect(before.turns[0]!.status).toBe("OPEN");
  });
  it.each(["ready", "snapshot", "world", "turn", "history", "version", "numbering", "gap", "frozen", "turn-two"])("SQL refuses %s bypass and preserves the accepted aggregate", async (kind) => {
    const f = await fresh(); await f.submit([f.order("a", 50)]); const before = await inspect(f.id);
    const action = async () => {
      if (kind === "ready") return client.playerTurnState.updateMany({ where: { matchId: f.id }, data: { ready: true } });
      if (kind === "snapshot") return client.gameSnapshotRecord.updateMany({ where: { matchId: f.id }, data: { payload: {} } });
      if (kind === "world") return client.matchWorld.update({ where: { matchId: f.id }, data: { payload: {} } });
      if (kind === "turn") return client.turn.updateMany({ where: { matchId: f.id }, data: { status: "CLOSED", closeReason: "DEADLINE", closedAtMs: before.turns[0]!.deadlineAtMs } });
      if (kind === "history") return client.playerSubmissionRevision.deleteMany({ where: { matchId: f.id } });
      if (kind === "version") return client.match.update({ where: { id: f.id }, data: { currentStateVersion: 1n } });
      if (kind === "numbering") return client.playerOrder.updateMany({ where: { matchId: f.id }, data: { moveNumber: 2 } });
      if (kind === "gap") return client.playerTurnState.updateMany({ where: { matchId: f.id }, data: { revision: 3n } });
      if (kind === "frozen") return client.frozenTurnInputRecord.create({ data: { matchId: f.id, turnNumber: 1n, payload: {} } });
      return client.turn.create({ data: { matchId: f.id, number: 2n, startingStateVersion: 0n, status: "OPEN", openedAtMs: 1n, deadlineAtMs: 2n, lastObservedAtMs: 1n } });
    };
    await expect(action()).rejects.toThrow(); expect(await inspect(f.id)).toEqual(before);
  });
  it("keeps old initial-armies immutable and refuses dependencies/Ready/execution APIs", async () => {
    const f = await fresh(2, true), before = await inspect(f.id);
    await expect(f.submit([])).rejects.toMatchObject({ code: "UNSUPPORTED_RUNTIME" });
    await expect(client.playerTurnState.updateMany({ where: { matchId: f.id }, data: { revision: 1n } })).rejects.toThrow();
    expect(await inspect(f.id)).toEqual(before);
  });
  it("uses a consistent read-only snapshot while another connection commits and permits parent cleanup", async () => {
    const f = await fresh(), second = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const [read, accepted] = await Promise.all([new MovementDraftRepository(second).getDraft(f.id, 1, f.host), f.submit([f.order("a", 50)])]);
      expect(read.state).toBe("READY"); if (read.state === "READY") expect([0, 1]).toContain(read.own.revision);
      expect((await f.repo.getDraft(f.id, 1, f.host))).toEqual(accepted);
      await expect(client.$transaction(async (tx) => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; await tx.match.update({ where: { id: f.id }, data: { currentStateVersion: 0n } }); })).rejects.toThrow();
    } finally { await second.$disconnect(); }
    await client.match.delete({ where: { id: f.id } }); expect(await client.playerOrder.count({ where: { matchId: f.id } })).toBe(0); expect(await client.playerSubmissionRevision.count({ where: { matchId: f.id } })).toBe(0);
  });
});
