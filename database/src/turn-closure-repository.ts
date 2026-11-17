import {freezeCombatInput} from "@strategy-game/game-engine/server";
import { ClosureMovementReadySchema, ResolutionMovementReadySchema, MovementDraftPathSchema, MovementDraftRequestSchema, SetTurnReadyRequestSchema, SetTurnReadyResponseSchema, UsernameSchema } from "@strategy-game/shared-types";
import type { MovementDraftErrorCode } from "@strategy-game/shared-types";
import { applyClosureCommand, freezeClosureInput, observeClosureDeadline, previewMovementDraft, freezeMovementInput } from "@strategy-game/game-engine";
import type { TurnState } from "@strategy-game/game-engine";
import { Prisma } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { readStoredTurn } from "./turn-storage.js";
import type { StoredTurn } from "./turn-storage.js";
import { json, orderRows, turnFields, safeNumber } from "./mappings.js";
import { restoreWorldArchive } from "./world-repository.js";
import { MovementDraftError } from "./movement-draft-repository.js";
type Aggregate = Extract<StoredTurn, { kind: "turn_closure" | "movement_resolution" | "combat_turn" }>;
type Transaction = Prisma.TransactionClient;
function expiredSql(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const v = error as Record<string, unknown>;
  return v.code === "P0059" || v.originalCode === "P0059" || [v.meta,v.cause,v.driverAdapterError].some((next) => expiredSql(next, depth+1));
}
export function closureView(aggregate: Aggregate, actor: string, state: TurnState = aggregate.state) {
  const own = state.drafts.find((d) => d.playerId === actor);
  if (!own || !aggregate.row.match.world) throw new MovementDraftError("INTERNAL_ERROR");
  return ((aggregate.kind==="movement_resolution"||aggregate.kind==="combat_turn")?ResolutionMovementReadySchema:ClosureMovementReadySchema).parse({ ...((aggregate.kind==="movement_resolution"||aggregate.kind==="combat_turn")?{initialPosition:aggregate.snapshot.formations.find(f=>f.ownerPlayerId===actor)!.position}:{}),schemaVersion: (aggregate.kind==="movement_resolution"||aggregate.kind==="combat_turn")?3:2, matchId: aggregate.row.matchId, state: "READY", turn: state.turn,
    own: { schemaVersion: 1, gameId: state.config.gameId, turnNumber: 1, revision: own.revision, ready: own.ready, orders: own.orders },
    route: previewMovementDraft(aggregate.snapshot, restoreWorldArchive(aggregate.row.match.world), actor, own.orders) });
}
async function member(tx: Transaction, matchId: string, identityId: string) {
  const profile = await tx.playerIdentity.findUnique({ where: { id: identityId }, select: { username: true } });
  if (!profile) throw new MovementDraftError("UNAUTHENTICATED");
  if (!UsernameSchema.safeParse(profile.username).success) throw new MovementDraftError("USERNAME_REQUIRED");
  const participant = await tx.matchParticipant.findUnique({ where: { matchId_identityId: { matchId, identityId } }, select: { active: true, playerId: true } });
  if (!participant?.active) throw new MovementDraftError("NOT_FOUND");
  return participant.playerId;
}
async function persistLifecycle(tx: Transaction, aggregate: Aggregate, state: TurnState) {
  if (aggregate.state.turn.status !== "open" || aggregate.state === state) return;
  await tx.turn.update({ where: { matchId_number: { matchId: state.config.gameId, number: 1n } }, data: turnFields(state) });
  if (state.turn.status === "closed") {
    const archive=restoreWorldArchive(aggregate.row.match.world!);
    const frozen = aggregate.kind==="combat_turn"?freezeCombatInput(state,aggregate.snapshot,archive):aggregate.kind==="movement_resolution"?freezeMovementInput(state,aggregate.snapshot,archive):freezeClosureInput(state, aggregate.snapshot, archive);
    await tx.frozenTurnInputRecord.create({ data: { matchId: state.config.gameId, turnNumber: 1n, payload: json(frozen), seed: "resolutionSeed" in frozen?BigInt(frozen.resolutionSeed):null } });
  }
}
/** Parent-first serialization shared by queue writes, readiness and deadline workers. No retries. */
export class TurnClosureRepository {
  constructor(private readonly client: PrismaClient, private readonly clock: () => number = Date.now) {}
  async mutate(matchId: string, turnNumber: number, identityId: string, input: unknown, readiness = false) {
    if (!MovementDraftPathSchema.safeParse({ matchId, turnNumber }).success ||
      !(readiness ? SetTurnReadyRequestSchema : MovementDraftRequestSchema).safeParse(input).success) throw new MovementDraftError("INVALID_REQUEST");
    try {
      const result = await this.client.$transaction(async (tx) => {
        await member(tx, matchId, identityId);
        const locks = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
        if (!locks.length) throw new MovementDraftError("NOT_FOUND");
        const actor = await member(tx, matchId, identityId);
        if (turnNumber !== 1) throw new MovementDraftError("WRONG_TURN");
        const c = await tx.matchConfiguration.findUnique({ where: { matchId } });
        if (c?.simulationVersion !== "turn-closure-v1" && c?.simulationVersion !== "movement-resolution-v1" && c?.simulationVersion !== "combat-turn-v1") throw new MovementDraftError("UNSUPPORTED_RUNTIME");
        const match = await tx.match.findUnique({ where: { id: matchId }, select: { status: true } });
        if (match?.status === "OPEN") throw new MovementDraftError("TURN_UNAVAILABLE");
        const a = await readStoredTurn(tx, matchId, 1);
        if ((a.kind !== "turn_closure" && a.kind !== "movement_resolution" && a.kind !== "combat_turn") || !a.row.match.world) throw new MovementDraftError("INTERNAL_ERROR");
        if (!a.state.drafts.some((d) => d.playerId === actor)) throw new MovementDraftError("NOT_FOUND");
        const request = readiness ? SetTurnReadyRequestSchema.parse(input) : MovementDraftRequestSchema.parse(input);
        const command = { ...request, ...(readiness ? { kind: "set_ready" as const } : {}), gameId: matchId, turnNumber: 1 };
        const outcome = applyClosureCommand(a.state, a.snapshot, restoreWorldArchive(a.row.match.world), actor, command, this.clock());
        if (outcome.draft) {
          const next = outcome.draft, scope = { matchId, turnNumber: 1n, playerId: actor };
          if (await tx.orderDependency.count({ where: scope })) throw new MovementDraftError("INTERNAL_ERROR");
          // The immutable history precedes the revision CAS; readiness never touches order rows.
          await tx.playerSubmissionRevision.create({ data: { ...scope, revision: BigInt(next.revision), ready: next.ready,
            kind: readiness ? "SET_READY" : "kind" in request && request.kind === "replace_orders" ? "REPLACE_ORDERS" : "CANCEL_ORDER",
            orders: json(next.orders), command: json(command) } });
          const updated = await tx.playerTurnState.updateMany({ where: { ...scope, revision: BigInt(request.expectedRevision), active: true },
            data: { revision: BigInt(next.revision), ready: next.ready } });
          if (updated.count !== 1) throw new MovementDraftError("STALE_REVISION");
          if (!readiness) {
            await tx.playerOrder.updateMany({ where: { ...scope, active: true }, data: { active: false, draftPosition: null, moveNumber: null, lastRevision: BigInt(next.revision) } });
            for (const row of orderRows(matchId, 1, next)) await tx.playerOrder.upsert({ where: { matchId_turnNumber_playerId_orderId: { ...scope, orderId: row.orderId } },
              create: row, update: { payload: row.payload, kind: row.kind, active: true, draftPosition: row.draftPosition, moveNumber: row.moveNumber, lastRevision: row.lastRevision } });
          }
        }
        await persistLifecycle(tx, a, outcome.state);
        return outcome.error ? { error: outcome.error } : { view: closureView(a, actor, outcome.state) };
      }, { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 10_000 });
      // Throw after successful transaction: a rejected late command cannot undo deadline closure.
      if (result.error) throw new MovementDraftError(result.error);
      return result.view!;
    } catch (error) {
      if (expiredSql(error)) {
        // Candidate transaction rolled back. Observe the independently valid SQL deadline once;
        // this never retries the rejected command or changes its revision.
        await this.closeWithClock(matchId, 5000, true);
        throw new MovementDraftError("TURN_CLOSED");
      }
      if (error instanceof MovementDraftError) throw error;
      throw new MovementDraftError("INTERNAL_ERROR");
    }
  }
  async setReady(matchId: string, turnNumber: number, identityId: string, input: unknown) {
    const view = await this.mutate(matchId, turnNumber, identityId, input, true);
    return SetTurnReadyResponseSchema.parse({ schemaVersion: 1, matchId, state: "READY", turn: view.turn, own: view.own });
  }
  async closeDue(matchId: string, timeoutMs = 5_000): Promise<boolean> {
    return this.closeWithClock(matchId, timeoutMs, false);
  }
  private async closeWithClock(matchId: string, timeoutMs: number, sqlClock: boolean): Promise<boolean> {
    return this.client.$transaction(async (tx) => {
      // Bounded wait/statement time as well as Prisma callback timeout.
      await tx.$queryRaw(Prisma.sql`SELECT set_config('lock_timeout', ${String(timeoutMs)}, true)`);
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`);
      await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
      const c = await tx.matchConfiguration.findUnique({ where: { matchId } });
      if (c?.simulationVersion !== "turn-closure-v1" && c?.simulationVersion !== "movement-resolution-v1" && c?.simulationVersion !== "combat-turn-v1") return false;
      const a = await readStoredTurn(tx, matchId, 1);
      if ((a.kind !== "turn_closure" && a.kind !== "movement_resolution" && a.kind !== "combat_turn") || a.state.turn.status !== "open") return false;
      const now = sqlClock ? safeNumber((await tx.$queryRaw<{ now: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now`)[0]!.now) : this.clock();
      const state = observeClosureDeadline(a.state, now);
      if (state.turn.status === "open") return false;
      await persistLifecycle(tx, a, state); return true;
    }, { isolationLevel: "ReadCommitted", timeout: timeoutMs + 1000, maxWait: timeoutMs });
  }
  async dueMatches(limit: number): Promise<readonly string[]> {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid deadline scan");
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = 5000`;
      return (await tx.turn.findMany({ where: { number: 1n, status: "OPEN", deadlineAtMs: { lte: BigInt(now) },
      match: { status: "RUNNING", configuration: { simulationVersion: {in:["turn-closure-v1","movement-resolution-v1","combat-turn-v1"]} } } },
      orderBy: [{ deadlineAtMs: "asc" }, { matchId: "asc" }], take: limit, select: { matchId: true } })).map((r) => r.matchId);
    }, { timeout: 6000, maxWait: 5000 });
  }
}
export type ClosureErrorCode = MovementDraftErrorCode;
