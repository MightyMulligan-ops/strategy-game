import { describe, expect, it } from "vitest";
import * as transportContracts from "../src/index.js";
import { OrderResultSchema, PinnedRulesetSchema } from "../src/server.js";

describe("authoritative contract boundaries", () => {
  it("does not re-export snapshot, frozen inputs, or results through public transport contracts", () => {
    for (const name of ["GameSnapshotSchema", "FrozenTurnInputSchema", "TurnResultSchema", "DomainEventSchema"]) {
      expect(transportContracts).not.toHaveProperty(name);
    }
  });

  it("cannot describe unsupported gameplay as successful or accept executable rules", () => {
    const metadata = {
      schemaVersion: 1, ruleset: { rulesetId: "baseline", version: "1" }, simulationVersion: "empty-turn-v1"
    };
    const rejection = {
      ...metadata, orderResultId: "result-1", resolutionId: "resolution-1", playerId: "alice", orderId: "move-1",
      status: "rejected", reason: "unsupported_order"
    };
    expect(OrderResultSchema.safeParse(rejection).success).toBe(true);
    expect(OrderResultSchema.safeParse({ ...rejection, status: "succeeded" }).success).toBe(false);
    expect(OrderResultSchema.safeParse({ ...rejection, simulationVersion: undefined }).success).toBe(false);
    expect(PinnedRulesetSchema.safeParse({
      ...metadata, movementTieBreakPolicy: "seeded-shuffle-v1", execute: () => undefined
    }).success).toBe(false);
  });
});
