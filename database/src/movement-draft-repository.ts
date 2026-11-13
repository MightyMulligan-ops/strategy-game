import { GameConfigSchema, MovementDraftPathSchema, MovementDraftRequestSchema, MovementDraftReadySchema, UsernameSchema } from "@strategy-game/shared-types";
import type { MovementDraftErrorCode, MovementDraftRequest, ReadMovementQueue } from "@strategy-game/shared-types";
import { MovementDraftFailure, previewMovementDraft, reviseMovementDraft } from "@strategy-game/game-engine";
import { Prisma } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { TurnClosureRepository, closureView } from "./turn-closure-repository.js";
import { configurationRuntime, readStoredTurn } from "./turn-storage.js";
import type { StoredTurn } from "./turn-storage.js";
import { json, orderRows } from "./mappings.js";
import { restoreWorldArchive } from "./world-repository.js";

export class MovementDraftError extends Error {
  constructor(readonly code: MovementDraftErrorCode) { super(code); }
}
type Transaction = Prisma.TransactionClient;
type Aggregate = Extract<StoredTurn, { kind: "movement_drafts" }>;
function expiredSql(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const value = error as Record<string, unknown>;
  return value.code === "P0051" || value.originalCode === "P0051" || [value.meta, value.cause, value.driverAdapterError].some((next) => expiredSql(next, depth + 1));
}
function invalid(): never { throw new MovementDraftError("INTERNAL_ERROR"); }
async function participant(tx: Transaction, matchId: string, identityId: string) {
  const profile = await tx.playerIdentity.findUnique({ where: { id: identityId }, select: { username: true } });
  if (!profile) throw new MovementDraftError("UNAUTHENTICATED");
  if (!UsernameSchema.safeParse(profile.username).success) throw new MovementDraftError("USERNAME_REQUIRED");
  const member = await tx.matchParticipant.findUnique({ where: { matchId_identityId: { matchId, identityId } }, select: { active: true, playerId: true } });
  if (!member?.active) throw new MovementDraftError("NOT_FOUND");
  return member;
}
function view(aggregate: Aggregate, actor: string, draft = aggregate.state.drafts.find((p) => p.playerId === actor)) {
  if (!draft || draft.ready || !aggregate.row.match.world) return invalid();
  const turn = aggregate.state.turn;
  return MovementDraftReadySchema.parse({ schemaVersion: 1, matchId: aggregate.row.matchId, state: "READY",
    turn: { schemaVersion: 1, gameId: turn.gameId, turnNumber: turn.turnNumber, status: turn.status, openedAtMs: turn.openedAtMs, deadlineAtMs: turn.deadlineAtMs },
    own: { schemaVersion: 1, gameId: turn.gameId, turnNumber: turn.turnNumber, revision: draft.revision, ready: false, orders: draft.orders },
    route: previewMovementDraft(aggregate.snapshot, restoreWorldArchive(aggregate.row.match.world), actor, draft.orders) });
}
async function context(tx: Transaction, matchId: string) {
  const match = await tx.match.findUnique({ where: { id: matchId }, select: { id: true, status: true, currentStateVersion: true,
    configuration: true, world: { select: { matchId: true } }, turns: { select: { number: true }, orderBy: { number: "asc" }, take: 2 } } });
  if (!match) throw new MovementDraftError("NOT_FOUND");
  const c = match.configuration;
  if (!c) return invalid();
  const config = GameConfigSchema.parse(c.config);
  if (match.id !== matchId || c.matchId !== matchId || c.schemaVersion !== 1 || config.gameId !== matchId || c.turnDurationMs !== BigInt(config.turnDurationMs)) return invalid();
  const runtime = configurationRuntime(c);
  if (match.status === "OPEN") {
    if (match.world || match.turns.length || match.currentStateVersion !== 0n) return invalid();
    return { match, runtime, state: "NOT_STARTED" as const };
  }
  if (match.status !== "RUNNING") return invalid();
  if (runtime === "legacy") {
    if (match.turns.length) return invalid();
    return { match, runtime, state: "UNINITIALIZED" as const };
  }
  if (runtime === "empty") return { match, runtime, state: "UNSUPPORTED" as const };
  if (!match.world || match.currentStateVersion !== 0n || match.turns.length !== 1 || match.turns[0]?.number !== 1n) return invalid();
  return { match, runtime, state: "READY" as const };
}
/** Dedicated production adapter. Does not use lifecycle commands, clocks or writes on GET. */
export class MovementDraftRepository {
  constructor(private readonly client: PrismaClient, private readonly clock: () => number = Date.now) {}
  async getDraft(matchId: string, turnNumber: number, identityId: string): Promise<ReadMovementQueue> {
    if (!MovementDraftPathSchema.safeParse({ matchId, turnNumber }).success) throw new MovementDraftError("INVALID_REQUEST");
    try {
      return await this.client.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const member = await participant(tx, matchId, identityId);
        if (turnNumber !== 1) throw new MovementDraftError("WRONG_TURN");
        const metadata = await context(tx, matchId);
        if (metadata.state !== "READY") return { schemaVersion: 1, matchId, state: metadata.state };
        const aggregate = await readStoredTurn(tx, matchId, 1);
        if (aggregate.kind === "turn_closure") return closureView(aggregate, member.playerId);
        if (aggregate.kind !== "movement_drafts") return { schemaVersion: 1, matchId, state: "UNSUPPORTED" };
        return view(aggregate, member.playerId);
      }, { isolationLevel: "RepeatableRead" });
    } catch (error) { if (error instanceof MovementDraftError) throw error; return invalid(); }
  }
  async submitDraft(matchId: string, turnNumber: number, identityId: string, input: MovementDraftRequest) {
    if (!MovementDraftPathSchema.safeParse({ matchId, turnNumber }).success || !MovementDraftRequestSchema.safeParse(input).success) throw new MovementDraftError("INVALID_REQUEST");
    const existing = await this.getDraft(matchId, turnNumber, identityId);
    if (existing.schemaVersion === 2) return new TurnClosureRepository(this.client, this.clock).mutate(matchId, turnNumber, identityId, input);
    try {
      return await this.client.$transaction(async (tx) => {
        await participant(tx, matchId, identityId); // Deny before locks or private metadata.
        // Same parent-first lock ordering as initialization and SQL guards. Revision races serialize.
        const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`);
        if (!rows.length) throw new MovementDraftError("NOT_FOUND");
        const member = await participant(tx, matchId, identityId); // Recheck after any lock wait.
        if (turnNumber !== 1) throw new MovementDraftError("WRONG_TURN");
        const metadata = await context(tx, matchId);
        if (metadata.runtime !== "movement_drafts") throw new MovementDraftError("UNSUPPORTED_RUNTIME");
        if (metadata.state !== "READY") throw new MovementDraftError("TURN_UNAVAILABLE");
        const aggregate = await readStoredTurn(tx, matchId, 1);
        if (aggregate.kind !== "movement_drafts" || !aggregate.row.match.world) return invalid();
        const previous = aggregate.state.drafts.find((p) => p.playerId === member.playerId);
        if (!previous) return invalid();
        const command = { ...input, gameId: matchId, turnNumber: 1 as const };
        const next = reviseMovementDraft(aggregate.snapshot, restoreWorldArchive(aggregate.row.match.world), previous, command,
          this.clock(), aggregate.state.turn.openedAtMs, aggregate.state.turn.deadlineAtMs);
        const scope = { matchId, turnNumber: 1n, playerId: member.playerId };
        if (await tx.orderDependency.count({ where: scope })) return invalid();
        await tx.playerSubmissionRevision.create({ data: { ...scope, revision: BigInt(next.draft.revision),
          kind: input.kind === "replace_orders" ? "REPLACE_ORDERS" : "CANCEL_ORDER", ready: false, orders: json(next.draft.orders), command: json(command) } });
        const changed = await tx.playerTurnState.updateMany({ where: { ...scope, revision: BigInt(input.expectedRevision), ready: false, active: true },
          data: { revision: BigInt(next.draft.revision), ready: false } });
        if (changed.count !== 1) throw new MovementDraftError("STALE_REVISION");
        await tx.playerOrder.updateMany({ where: { ...scope, active: true }, data: { active: false, draftPosition: null, moveNumber: null, lastRevision: BigInt(next.draft.revision) } });
        for (const order of orderRows(matchId, 1, next.draft)) await tx.playerOrder.upsert({
          where: { matchId_turnNumber_playerId_orderId: { ...scope, orderId: order.orderId } }, create: order,
          update: { kind: order.kind, payload: order.payload, active: true, draftPosition: order.draftPosition, moveNumber: order.moveNumber, lastRevision: order.lastRevision } });
        return view(aggregate, member.playerId, next.draft);
      }, { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 10_000 }); // Acknowledge only after commit.
    } catch (error) {
      if (expiredSql(error)) throw new MovementDraftError("DEADLINE_PASSED");
      if (error instanceof MovementDraftFailure) throw new MovementDraftError(error.code);
      if (error instanceof MovementDraftError) throw error;
      return invalid();
    }
  }
}
