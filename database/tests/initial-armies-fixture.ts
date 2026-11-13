import { initializeArmiesTurnOne } from "@strategy-game/game-engine";
import { INITIAL_ARMIES_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import type { Prisma } from "../src/generated/prisma/client.js";
import { initialTurnFixture } from "./initial-turn-fixture.js";

export function initialArmiesFixture(count = 2) {
  const f = initialTurnFixture(count);
  const plan = initializeArmiesTurnOne(f.config, f.players, f.archive, 10_000);
  const json = (value: object) => JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
  Object.assign(f.row.match.configuration!, { rulesetId: "initial-armies", rulesetVersion: "1", simulationVersion: "initial-armies-v1", pinnedRuleset: json(INITIAL_ARMIES_RUNTIME_PROFILE) });
  Object.assign(f.row.startingSnapshot, { snapshotId: plan.snapshot.snapshotId, payload: json(plan.snapshot) });
  return { ...f, plan };
}
