import { CITY_BALANCE_V1 } from "@strategy-game/shared-types";
import { CITY_RUNTIME, InitialWorldArchiveSchema } from "@strategy-game/shared-types/server";
import { generateWorld } from "../src/world-generation.js";
import { planCityLoop } from "../src/combat-loop.js";

export function cityFixture(startingCredits = 2000) {
  const gameId = "city-fixture", playerIds = ["alpha", "beta"];
  const result = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: 1,
    players: playerIds, settings: { regionSide: 5 } });
  if (!result.ok) throw Error("Invalid city fixture");
  const archive = InitialWorldArchiveSchema.parse({ schemaVersion: 1, generatorVersion: "territory-grid-v1", matchId: gameId, payload: result.world });
  const runtime = { ...CITY_RUNTIME, balance: { ...CITY_BALANCE_V1, startingCredits } };
  const players = playerIds.map(playerId => ({ schemaVersion: 1, playerId, gameId, active: true }));
  return planCityLoop({ schemaVersion: 1, gameId, turnDurationMs: 300000 }, players, archive, runtime).snapshot;
}
