import { initializeMovementDrafts, reviseMovementDraft } from "@strategy-game/game-engine";
import { MOVEMENT_DRAFT_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { initialArmiesFixture } from "./initial-armies-fixture.js";
import { json, orderRows } from "../src/mappings.js";
import type { Prisma } from "../src/generated/prisma/client.js";

const value = (v: object) => JSON.parse(JSON.stringify(v)) as Prisma.JsonValue;
export function movementDraftFixture(count = 2) {
  const f = initialArmiesFixture(count), plan = initializeMovementDrafts(f.config, f.players, f.archive, 10_000);
  Object.assign(f.row.match.configuration!, { rulesetId: "movement-drafts", rulesetVersion: "1", simulationVersion: "movement-drafts-v1", pinnedRuleset: value(MOVEMENT_DRAFT_RUNTIME_PROFILE) });
  Object.assign(f.row.startingSnapshot, { snapshotId: plan.snapshot.snapshotId, payload: value(plan.snapshot) });
  return { ...f, plan };
}
export function fixtureRevision(f: ReturnType<typeof movementDraftFixture>, actor: string, orders: readonly unknown[]) {
  const row = f.row.players.find((p) => p.playerId === actor)!;
  const previous = row.revisions.at(-1)!;
  const command = { schemaVersion: 1, gameId: f.row.matchId, turnNumber: 1, kind: "replace_orders", expectedRevision: Number(row.revision), orders };
  const next = reviseMovementDraft(f.plan.snapshot, f.archive, { playerId: actor, revision: Number(row.revision), ready: false, orders: previous.orders as never }, command, 10_001, 10_000, 11_000).draft;
  row.revision++;
  row.revisions.push({ ...row.revisions[0]!, revision: row.revision, kind: "REPLACE_ORDERS", orders: value(next.orders), command: value(command) });
  for (const o of row.orders) if (o.active) Object.assign(o, { active: false, draftPosition: null, moveNumber: null, lastRevision: row.revision });
  for (const o of orderRows(f.row.matchId, 1, next)) {
    const old = row.orders.find((r) => r.orderId === o.orderId);
    if (old) Object.assign(old, o); else row.orders.push({ ...o, payload: json(o.payload as object) as Prisma.JsonValue });
  }
  return next;
}
