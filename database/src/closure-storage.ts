import { MovementDraftOrdersSchema } from "@strategy-game/shared-types";
import type { TurnClosureSnapshot, InitialWorldArchive } from "@strategy-game/shared-types/server";
import { ClosureCommandSchema } from "@strategy-game/shared-types/server";
import { previewMovementDraft, reviseClosureDraft } from "@strategy-game/game-engine";
import { isDeepStrictEqual as same } from "node:util";
import type { StoredTurnRow } from "./turn-storage.js";
import { json, orderRows, restoreDraft, safeNumber } from "./mappings.js";
import { PersistenceError } from "./errors.js";

function invalid(): never { throw new PersistenceError("invalid_storage", "Movement draft history is inconsistent"); }
/** Replay every accepted revision and compare current and retired rows. Never repair storage. */
export function restoreClosureDrafts(row: StoredTurnRow, snapshot: TurnClosureSnapshot, archive: InitialWorldArchive) {
  return Object.freeze([...row.players].sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0).map((p) => {
    const current = restoreDraft(p), revision = safeNumber(p.revision);
    if (p.matchId !== row.matchId || p.turnNumber !== 1n || !p.active || p.revisions.length !== revision + 1) return invalid();
    const history = [...p.revisions].sort((a, b) => a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0);
    let draft = { playerId: p.playerId, revision: 0, ready: false, orders: MovementDraftOrdersSchema.parse([]) };
    type ExpectedOrder = Omit<ReturnType<typeof orderRows>[number], "draftPosition" | "moveNumber" | "active"> & { active: boolean; draftPosition: number | null; moveNumber: number | null };
    const expected = new Map<string, ExpectedOrder>();
    for (const [index, h] of history.entries()) {
      if (h.matchId !== row.matchId || h.turnNumber !== 1n || h.playerId !== p.playerId || h.revision !== BigInt(index)) return invalid();
      if (index === 0) {
        if (h.kind !== "INITIAL" || h.command !== null || h.ready || !same(h.orders, [])) return invalid();
      } else {
        const command = ClosureCommandSchema.parse(h.command);
        if (h.kind !== (command.kind === "set_ready" ? "SET_READY" : command.kind === "replace_orders" ? "REPLACE_ORDERS" : "CANCEL_ORDER")) return invalid();
        // Opening instant replays semantics without reading a clock or extending acceptance.
        const next = reviseClosureDraft(snapshot, archive, draft, command);
        if (!same(json(next.orders), h.orders)) return invalid();
        if (next.ready !== h.ready) return invalid();
        draft = { ...next, orders: MovementDraftOrdersSchema.parse(next.orders) };
        if (command.kind === "set_ready") continue;
        for (const [id, old] of expected) if (old.active) expected.set(id, { ...old, active: false, draftPosition: null, moveNumber: null, lastRevision: BigInt(index) });
        for (const order of orderRows(row.matchId, 1, draft)) expected.set(order.orderId, order);
      }
    }
    previewMovementDraft(snapshot, archive, p.playerId, current.orders);
    if (!same(current, draft) || p.orders.length !== expected.size) return invalid();
    for (const stored of p.orders) {
      const want = expected.get(stored.orderId);
      if (!want) return invalid();
      for (const key of Object.keys(want) as (keyof typeof want)[]) if (!same(want[key], stored[key])) return invalid();
    }
    return Object.freeze(draft);
  }));
}
