import { OrderSchema, OwnTurnSubmissionSchema, TurnRecordSchema } from "@strategy-game/shared-types";
import type { PlayerTurnDraft, TurnState } from "@strategy-game/game-engine";
import type { PlayerOrder, PlayerTurnState, Prisma, Turn, TurnStatus } from "./generated/prisma/client.js";
import { PersistenceError } from "./errors.js";

export function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PersistenceError("invalid_storage", "Stored integer is outside the contract's safe range");
  }
  return Number(value);
}

// Inputs to this helper are validated contracts, never raw client JSON.
export function json(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function orderRows(matchId: string, turnNumber: number, draft: PlayerTurnDraft) {
  const validated = OwnTurnSubmissionSchema.parse({
    schemaVersion: 1, gameId: matchId, turnNumber,
    revision: draft.revision, ready: draft.ready, orders: draft.orders
  });
  let moveNumber = 0;
  return validated.orders.map((order, index) => ({
    matchId, turnNumber: BigInt(turnNumber), playerId: draft.playerId, orderId: order.orderId,
    kind: order.type === "move" ? "MOVE" : "ATTACK",
    payload: json(order), active: true, draftPosition: index + 1,
    moveNumber: order.type === "move" ? ++moveNumber : null,
    lastRevision: BigInt(draft.revision)
  } satisfies Prisma.PlayerOrderCreateManyInput));
}

export function restoreDraft(row: PlayerTurnState & { orders: PlayerOrder[] }): PlayerTurnDraft {
  const activeOrders = row.orders.filter((order) => order.active).sort((a, b) => (a.draftPosition ?? 0) - (b.draftPosition ?? 0));
  let moveNumber = 0;
  const orders = activeOrders.map((stored, index) => {
    const order = OrderSchema.parse(stored.payload);
    const expectedMoveNumber = order.type === "move" ? ++moveNumber : null;
    if (stored.matchId !== row.matchId || stored.turnNumber !== row.turnNumber || stored.playerId !== row.playerId ||
        stored.orderId !== order.orderId || stored.kind !== (order.type === "move" ? "MOVE" : "ATTACK") ||
        stored.draftPosition !== index + 1 || stored.moveNumber !== expectedMoveNumber || !row.active ||
        stored.lastRevision < 1n || stored.lastRevision > row.revision) {
      throw new PersistenceError("invalid_storage", "Stored order identity or queue position does not match its payload");
    }
    return order;
  });
  const draft = OwnTurnSubmissionSchema.parse({
    schemaVersion: 1, gameId: row.matchId, turnNumber: safeNumber(row.turnNumber),
    revision: safeNumber(row.revision), ready: row.ready, orders
  });
  return Object.freeze({ playerId: row.playerId, revision: draft.revision, ready: draft.ready, orders: draft.orders });
}

export function turnFields(state: TurnState) {
  const status: Record<TurnState["turn"]["status"], TurnStatus> = {
    open: "OPEN", closed: "CLOSED", resolving: "RESOLVING", resolved: "RESOLVED"
  };
  return {
    status: status[state.turn.status],
    openedAtMs: BigInt(state.turn.openedAtMs), deadlineAtMs: BigInt(state.turn.deadlineAtMs),
    lastObservedAtMs: BigInt(state.lastObservedAtMs),
    closedAtMs: state.turn.status === "open" ? null : BigInt(state.turn.closedAtMs),
    closeReason: state.turn.status === "open" ? null : state.turn.closeReason === "deadline" ? "DEADLINE" as const : "ALL_READY" as const
  };
}

export function restoreTurnRecord(row: Turn) {
  return TurnRecordSchema.parse({
    schemaVersion: 1, gameId: row.matchId, turnNumber: safeNumber(row.number),
    status: row.status.toLowerCase(), openedAtMs: safeNumber(row.openedAtMs), deadlineAtMs: safeNumber(row.deadlineAtMs),
    ...(row.status === "OPEN" ? {} : {
      closedAtMs: row.closedAtMs === null ? undefined : safeNumber(row.closedAtMs),
      closeReason: row.closeReason?.toLowerCase()
    })
  });
}
