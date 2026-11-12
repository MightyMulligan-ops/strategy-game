import { describe, expect, it } from "vitest";
import * as transportContracts from "../src/index.js";
import {
  INITIAL_WORLD_RUNTIME_PROFILE, GameSnapshotSchema, InitialWorldRuntimeProfileSchema,
  InitialWorldSnapshotSchema, OrderResultSchema, PinnedRulesetSchema
} from "../src/server.js";

describe("authoritative contract boundaries", () => {
  it("does not re-export snapshot, frozen inputs, or results through public transport contracts", () => {
    for (const name of ["GameSnapshotSchema", "FrozenTurnInputSchema", "TurnResultSchema", "DomainEventSchema",
      "InitialWorldSnapshotSchema", "InitialWorldRuntimeProfileSchema", "InitialWorldArchiveSchema",
      "InitialWorldReferenceSchema", "INITIAL_WORLD_RUNTIME_PROFILE", "INITIAL_WORLD_SIMULATION_VERSION"]) {
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

const initialSnapshot = {
  schemaVersion: 2, kind: "initial_world", snapshotId: `initial-world:${"a".repeat(64)}`,
  ruleset: { rulesetId: "initial-world", version: "1" }, simulationVersion: "initial-world-v1",
  config: { schemaVersion: 1, gameId: "match", turnDurationMs: 1_000 }, completedTurnNumber: 0, stateVersion: 0,
  players: ["alice", "bob"].map((playerId) => ({ schemaVersion: 1, gameId: "match", playerId, active: true })),
  worldRef: { matchId: "match", archiveSchemaVersion: 1, generatorVersion: "territory-grid-v1", digest: `sha256:${"b".repeat(64)}` }
};
describe("initial-world server-only contracts", () => {
  it("keeps snapshot v2 distinct while retaining config/profile v1", () => {
    expect(InitialWorldSnapshotSchema.parse(initialSnapshot)).toEqual(initialSnapshot);
    expect(GameSnapshotSchema.safeParse(initialSnapshot).success).toBe(false);
    expect(PinnedRulesetSchema.parse(INITIAL_WORLD_RUNTIME_PROFILE)).toEqual(INITIAL_WORLD_RUNTIME_PROFILE);
    expect(Object.isFrozen(INITIAL_WORLD_RUNTIME_PROFILE)).toBe(true);
    expect(Object.isFrozen(INITIAL_WORLD_RUNTIME_PROFILE.ruleset)).toBe(true);
  });
  it.each([
    { ...initialSnapshot, schemaVersion: 1 }, { ...initialSnapshot, kind: "empty" },
    { ...initialSnapshot, stateVersion: 1 }, { ...initialSnapshot, completedTurnNumber: 1 },
    { ...initialSnapshot, simulationVersion: "empty-turn-v1" }, { ...initialSnapshot, seed: 42 },
    { ...initialSnapshot, ruleset: { rulesetId: "initial-world", version: "2" } },
    { ...initialSnapshot, snapshotId: "initial-world:short" },
    { ...initialSnapshot, players: [...initialSnapshot.players].reverse() },
    { ...initialSnapshot, players: [initialSnapshot.players[0], initialSnapshot.players[0]] },
    { ...initialSnapshot, players: [initialSnapshot.players[0]] },
    { ...initialSnapshot, players: initialSnapshot.players.map((p) => ({ ...p, active: false })) },
    { ...initialSnapshot, players: initialSnapshot.players.map((p) => ({ ...p, gameId: "other" })) },
    ...[{ matchId: "other" }, { archiveSchemaVersion: 2 }, { generatorVersion: "unknown" }, { digest: "sha256:short" },
      { digest: `sha256:${"A".repeat(64)}` }, { digest: `sha512:${"b".repeat(64)}` }, { seed: 42 }]
      .map((extra) => ({ ...initialSnapshot, worldRef: { ...initialSnapshot.worldRef, ...extra } }))
  ])("rejects malformed, noncanonical or mismatched snapshot %#", (value) => {
    expect(InitialWorldSnapshotSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    { ...INITIAL_WORLD_RUNTIME_PROFILE, schemaVersion: 2 },
    { ...INITIAL_WORLD_RUNTIME_PROFILE, simulationVersion: "empty-turn-v1" },
    { ...INITIAL_WORLD_RUNTIME_PROFILE, movementTieBreakPolicy: "unknown" },
    { ...INITIAL_WORLD_RUNTIME_PROFILE, ruleset: { rulesetId: "other", version: "1" } },
    { ...INITIAL_WORLD_RUNTIME_PROFILE, execute: () => undefined }
  ])("accepts only the supported initialization profile %#", (value) => {
    expect(InitialWorldRuntimeProfileSchema.safeParse(value).success).toBe(false);
  });
});
