import { generateWorld, initializeArmiesTurnOne } from "../src/index.js";
export function armyFixture(count = 2, seed = 0, regionSide: 3 | 5 | 7 = 5) {
  const config = { schemaVersion: 1, gameId: "army-match", turnDurationMs: 1000 };
  const players = Array.from({ length: count }, (_, i) => ({ schemaVersion: 1, gameId: config.gameId, playerId: `p${String(i).padStart(2, "0")}`, active: true }));
  const world = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed, settings: { regionSide }, players: players.map((p) => p.playerId) });
  if (!world.ok) throw new Error("Fixture generation failed");
  const archive = { matchId: config.gameId, schemaVersion: 1, generatorVersion: "territory-grid-v1", payload: world.world };
  const plan = initializeArmiesTurnOne(config, players, archive, 1000);
  return { config, players, archive, plan };
}
