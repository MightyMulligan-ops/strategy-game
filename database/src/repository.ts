import { TurnCommandSchema } from "@strategy-game/shared-types";
import { FrozenTurnInputSchema, GameSnapshotSchema, PinnedRulesetSchema, SeedSchema, TurnResultSchema } from "@strategy-game/shared-types/server";
import type { TurnResult } from "@strategy-game/shared-types/server";
import { applyTurnCommand, createTurn, freezeTurnInput, observeDeadline, openNextTurn, resolveTurn } from "@strategy-game/game-engine";
import type { TurnState } from "@strategy-game/game-engine";
import { Prisma } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { PersistenceError } from "./errors.js";
import { json, orderRows, safeNumber, turnFields } from "./mappings.js";
import { storedTurnInclude, restoreStoredTurn, insertSnapshot, insertTurn, requireEmptyRuntime } from "./turn-storage.js";
import type { StoredTurn } from "./turn-storage.js";

type Transaction = Prisma.TransactionClient;
const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

async function readTurn(tx: Transaction, matchId: string, turnNumber: number) {
  const row = await tx.turn.findUnique({ where: { matchId_number: { matchId, number: BigInt(turnNumber) } }, include: storedTurnInclude });
  if (!row) throw new PersistenceError("not_found", "Turn not found");
  return restoreStoredTurn(row);
}
type Aggregate = Extract<StoredTurn, { kind: "empty" }>;

async function persistLifecycle(tx: Transaction, previous: Aggregate, next: TurnState) {
  await tx.turn.update({
    where: { matchId_number: { matchId: next.config.gameId, number: BigInt(next.turn.turnNumber) } }, data: turnFields(next)
  });
  if (previous.state.turn.status === "open" && next.turn.status === "closed") {
    await tx.frozenTurnInputRecord.create({ data: {
      matchId: next.config.gameId, turnNumber: BigInt(next.turn.turnNumber), payload: json(freezeTurnInput(next, previous.snapshot))
    } });
  }
}

async function persistCommand(tx: Transaction, aggregate: Aggregate, next: TurnState, actor: string, input: unknown) {
  const command = TurnCommandSchema.parse(input);
  const draft = next.drafts.find((player) => player.playerId === actor);
  if (!draft) throw new PersistenceError("invalid_storage", "Accepted command has no player draft");
  const scope = { matchId: next.config.gameId, turnNumber: BigInt(next.turn.turnNumber), playerId: actor };
  if (command.kind !== "set_ready" && await tx.orderDependency.count({ where: scope }) > 0) {
    throw new PersistenceError("dependencies_not_supported", "Dependency editing requires an approved cancellation policy");
  }
  const kinds = { replace_orders: "REPLACE_ORDERS", cancel_order: "CANCEL_ORDER", set_ready: "SET_READY" } as const;
  await tx.playerSubmissionRevision.create({ data: {
    ...scope, revision: BigInt(draft.revision), kind: kinds[command.kind], ready: draft.ready,
    orders: json(draft.orders), command: json(command)
  } });
  await tx.playerTurnState.update({
    where: { matchId_turnNumber_playerId: scope }, data: { revision: BigInt(draft.revision), ready: draft.ready }
  });
  if (command.kind !== "set_ready") {
    // Free partial unique queue slots first, so swaps and compaction cannot
    // collide. Canceled identities remain addressable by future dependencies.
    await tx.playerOrder.updateMany({ where: { ...scope, active: true }, data: {
      active: false, draftPosition: null, moveNumber: null, lastRevision: BigInt(draft.revision)
    } });
    for (const row of orderRows(next.config.gameId, next.turn.turnNumber, draft)) {
      await tx.playerOrder.upsert({
        where: { matchId_turnNumber_playerId_orderId: { ...scope, orderId: row.orderId } }, create: row,
        update: { kind: row.kind, payload: row.payload, active: true, draftPosition: row.draftPosition,
          moveNumber: row.moveNumber, lastRevision: row.lastRevision }
      });
    }
  }
  await persistLifecycle(tx, aggregate, next);
}

function prepared(aggregate: StoredTurn) {
  requireEmptyRuntime(aggregate);
  const stored = aggregate.row.frozenInput;
  if (!stored || stored.seed === null) throw new PersistenceError("seed_required", "Prepare a closed turn with an explicit seed first");
  return {
    snapshot: aggregate.snapshot, frozen: FrozenTurnInputSchema.parse(stored.payload),
    pinned: aggregate.pinned, seed: SeedSchema.parse(safeNumber(stored.seed))
  };
}

/** Server-only persistence. The caller owns/disconnects the Prisma client. */
export class MatchRepository {
  constructor(private readonly client: PrismaClient) {}

  private async withTurn<T>(matchId: string, turnNumber: number, work: (tx: Transaction, aggregate: Aggregate) => Promise<T>): Promise<T> {
    return this.client.$transaction(async (tx) => {
      // All draft/Ready/closure/resolution writes take the same lock. Reads
      // happen after it is acquired, and the server clock is sampled afterward.
      const rows = await tx.$queryRaw<{ matchId: string }[]>(Prisma.sql`
        SELECT "matchId" FROM "Turn" WHERE "matchId" = ${matchId} AND "number" = ${BigInt(turnNumber)} FOR UPDATE
      `);
      if (rows.length === 0) throw new PersistenceError("not_found", "Turn not found");
      const aggregate = await readTurn(tx, matchId, turnNumber);
      requireEmptyRuntime(aggregate); // Before callback clocks, seed pinning or any writes.
      return work(tx, aggregate);
    }, { timeout: 15_000, maxWait: 10_000 });
  }

  async createMatch(snapshotInput: unknown, pinnedInput: unknown,
    identities: readonly { playerId: string; identityId: string }[], openedAtMs: number): Promise<TurnState> {
    const snapshot = GameSnapshotSchema.parse(snapshotInput);
    const pinned = PinnedRulesetSchema.parse(pinnedInput);
    if (pinned.simulationVersion !== "empty-turn-v1") throw new PersistenceError("unsupported_runtime_operation", "Only empty runtime creation is supported here");
    if (snapshot.completedTurnNumber !== 0 || snapshot.stateVersion !== 0 ||
        !same(snapshot.ruleset, pinned.ruleset) || snapshot.simulationVersion !== pinned.simulationVersion ||
        identities.length !== snapshot.players.length || new Set(identities.map((item) => item.playerId)).size !== identities.length ||
        identities.some((item) => !item.identityId || item.identityId.trim() !== item.identityId) ||
        snapshot.players.some((player) => !identities.some((item) => item.playerId === player.playerId))) {
      throw new PersistenceError("conflict", "Initial snapshot, ruleset, or complete player identity mapping is invalid");
    }
    const state = createTurn(snapshot.config, snapshot.players, openedAtMs);
    await this.client.$transaction(async (tx) => {
      const matchId = snapshot.config.gameId;
      await tx.match.create({ data: { id: matchId } });
      await tx.matchConfiguration.create({ data: {
        matchId, schemaVersion: snapshot.schemaVersion, turnDurationMs: BigInt(snapshot.config.turnDurationMs),
        rulesetId: pinned.ruleset.rulesetId, rulesetVersion: pinned.ruleset.version, simulationVersion: pinned.simulationVersion,
        config: json(snapshot.config), pinnedRuleset: json(pinned)
      } });
      for (const player of snapshot.players) {
        const identityId = identities.find((item) => item.playerId === player.playerId)!.identityId;
        await tx.playerIdentity.upsert({ where: { id: identityId }, create: { id: identityId }, update: {} });
        await tx.matchParticipant.create({ data: { matchId, playerId: player.playerId, identityId, active: player.active } });
      }
      await insertSnapshot(tx, snapshot);
      await insertTurn(tx, state, snapshot);
    }, { timeout: 15_000 });
    return state;
  }

  async loadTurn(matchId: string, turnNumber: number) {
    return this.client.$transaction(async (tx) => {
      const aggregate = await readTurn(tx, matchId, turnNumber);
      return { kind: aggregate.kind, state: aggregate.state, snapshot: aggregate.snapshot, pinned: aggregate.pinned };
    }, { isolationLevel: "RepeatableRead" });
  }

  async submitCommand(matchId: string, turnNumber: number, actor: string, input: unknown, clock: () => number = Date.now) {
    return this.withTurn(matchId, turnNumber, async (tx, aggregate) => {
      const result = applyTurnCommand(aggregate.state, actor, input, clock());
      if (result.accepted) await persistCommand(tx, aggregate, result.state, actor, input);
      else await persistLifecycle(tx, aggregate, result.state);
      return result; // Promise resolves only after commit, never before it.
    });
  }

  async observeDeadline(matchId: string, turnNumber: number, clock: () => number = Date.now) {
    return this.withTurn(matchId, turnNumber, async (tx, aggregate) => {
      const next = observeDeadline(aggregate.state, clock());
      await persistLifecycle(tx, aggregate, next);
      return next;
    });
  }

  async prepareResolution(matchId: string, turnNumber: number, seedInput?: number) {
    return this.withTurn(matchId, turnNumber, async (tx, aggregate) => {
      if (aggregate.state.turn.status === "open" || !aggregate.row.frozenInput) {
        throw new PersistenceError("conflict", "Turn must be closed and frozen before resolution");
      }
      const stored = aggregate.row.frozenInput;
      if (stored.seed === null && seedInput === undefined) {
        throw new PersistenceError("seed_required", "First resolution preparation requires an explicit seed");
      }
      const seed = stored.seed === null ? SeedSchema.parse(seedInput) : safeNumber(stored.seed);
      if (seedInput !== undefined && SeedSchema.parse(seedInput) !== seed) {
        throw new PersistenceError("conflict", "Resolution seed is already pinned");
      }
      if (stored.seed === null) {
        await tx.frozenTurnInputRecord.update({ where: { matchId_turnNumber: { matchId, turnNumber: BigInt(turnNumber) } }, data: { seed: BigInt(seed) } });
      }
      if (aggregate.state.turn.status === "closed") {
        await tx.turn.update({ where: { matchId_number: { matchId, number: BigInt(turnNumber) } }, data: { status: "RESOLVING" } });
      }
      return { snapshot: aggregate.snapshot, frozen: FrozenTurnInputSchema.parse(stored.payload), pinned: aggregate.pinned, seed };
    });
  }

  async commitResolution(matchId: string, turnNumber: number, resultInput: unknown): Promise<TurnResult> {
    const context = await this.client.$transaction(async (tx) => prepared(await readTurn(tx, matchId, turnNumber)), { isolationLevel: "RepeatableRead" });
    const result = TurnResultSchema.parse(resultInput);
    // Execute/revalidate the existing pure empty-turn resolver outside the write
    // transaction. Immutable frozen data and a pinned seed make retries stable.
    const expected = resolveTurn(context.snapshot, context.frozen, context.pinned, context.seed);
    if (!expected.ok || !same(expected.result, result)) {
      throw new PersistenceError("invalid_resolution", "Result does not match the stored frozen resolution inputs");
    }
    return this.withTurn(matchId, turnNumber, async (tx, aggregate) => {
      if (aggregate.row.resolution) {
        const cached = TurnResultSchema.parse(aggregate.row.resolution.payload);
        if (!same(cached, result)) throw new PersistenceError("conflict", "Turn already has a different committed result");
        return cached;
      }
      if (aggregate.state.turn.status !== "resolving" || prepared(aggregate).seed !== result.seed) {
        throw new PersistenceError("conflict", "Turn is not prepared for this resolution");
      }
      const changed = await tx.match.updateMany({
        where: { id: matchId, currentStateVersion: BigInt(context.snapshot.stateVersion) },
        data: { currentStateVersion: BigInt(result.nextState.stateVersion) }
      });
      if (changed.count !== 1) throw new PersistenceError("conflict", "Match state has already advanced");
      await insertSnapshot(tx, result.nextState);
      await tx.resolutionResult.create({ data: {
        matchId, turnNumber: BigInt(turnNumber), resolutionId: result.resolutionId,
        nextStateVersion: BigInt(result.nextState.stateVersion), payload: json(result)
      } });
      await tx.turn.update({ where: { matchId_number: { matchId, number: BigInt(turnNumber) } }, data: { status: "RESOLVED" } });
      return result;
    });
  }

  async openFollowingTurn(matchId: string, completedTurn: number, openedAtMs: number): Promise<TurnState> {
    return this.withTurn(matchId, completedTurn, async (tx, aggregate) => {
      if (!aggregate.row.resolution) throw new PersistenceError("conflict", "Previous turn has no committed resolution");
      const snapshot = TurnResultSchema.parse(aggregate.row.resolution.payload).nextState;
      const next = openNextTurn(aggregate.state, openedAtMs);
      await insertTurn(tx, next, snapshot);
      return next;
    });
  }
}
