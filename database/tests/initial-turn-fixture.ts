import { generateWorld, initializeTurnOne } from "@strategy-game/game-engine";
import { INITIAL_WORLD_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { turnFields } from "../src/mappings.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import type { StoredTurnRow } from "../src/turn-storage.js";

export function initialTurnFixture(count = 2) {
  const json = (value: object) => JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
  const id = "initial-fixture"; const config = { schemaVersion: 1 as const, gameId: id, turnDurationMs: 1000 };
  const players = Array.from({ length: count }, (_, i) => ({ schemaVersion: 1 as const, gameId: id, playerId: `p${String(i).padStart(2, "0")}`, active: true }));
  const generated = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: 123, settings: { regionSide: 5 }, players: players.map((p) => p.playerId) });
  if (!generated.ok) throw new Error("Invalid fixture");
  const archive = { matchId: id, schemaVersion: 1 as const, generatorVersion: "territory-grid-v1" as const, payload: generated.world };
  const plan = initializeTurnOne(config, players, archive, 10_000);
  const profile = INITIAL_WORLD_RUNTIME_PROFILE;
  const row: StoredTurnRow = {
    matchId: id, number: 1n, startingStateVersion: 0n, ...turnFields(plan.state), frozenInput: null, resolution: null,
    startingSnapshot: { matchId: id, stateVersion: 0n, completedTurnNumber: 0n, snapshotId: plan.snapshot.snapshotId, payload: json(plan.snapshot) },
    match: { id, status: "RUNNING", currentStateVersion: 0n, hostIdentityId: "account-p00", createdAt: new Date(0),
      configuration: { matchId: id, schemaVersion: 1, name: "Fixture", playerCapacity: count, turnDurationMs: 1000n, config,
        rulesetId: profile.ruleset.rulesetId, rulesetVersion: profile.ruleset.version, simulationVersion: profile.simulationVersion, pinnedRuleset: json(profile) },
      world: { matchId: id, schemaVersion: 1, generatorVersion: archive.generatorVersion, seed: 123n, payload: json(generated.world) },
      participants: players.map((p) => ({ matchId: id, playerId: p.playerId, identityId: `account-${p.playerId}`, active: true, lobbyReady: true })) },
    players: players.map((p) => ({ matchId: id, turnNumber: 1n, playerId: p.playerId, active: true, revision: 0n, ready: false, orders: [],
      revisions: [{ matchId: id, turnNumber: 1n, playerId: p.playerId, revision: 0n, kind: "INITIAL", ready: false, orders: [], command: null, recordedAt: new Date(0) }] }))
  };
  return { row, plan, archive, config, players };
}
