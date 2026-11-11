import { describe, expect, it } from "vitest";
import { generateWorld } from "@strategy-game/game-engine";
import { PublicWorldSchema, ReadWorldResponseSchema } from "@strategy-game/shared-types";
import type { MatchWorld, Prisma } from "../src/generated/prisma/client.js";
import { projectWorld } from "../src/world-repository.js";

export function projectionFixture(count = 2) {
  const players = Array.from({ length: count }, (_, i) => ({ playerId: `public-${i}`, username: `Player_${i}` }));
  const result = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: 4294967295, players: players.map((p) => p.playerId), settings: { regionSide: 5 } });
  if (!result.ok) throw new Error("Invalid fixture");
  const stored: MatchWorld = { matchId: "fixture", schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: BigInt(result.world.seed), payload: JSON.parse(JSON.stringify(result.world)) as Prisma.JsonValue };
  return { stored, players, world: projectWorld(stored, players) };
}
describe("initial world public projection", () => {
  it.each([2, 4, 10, 40])("projects %i-player worlds without private metadata", (count) => {
    const { stored, world } = projectionFixture(count);
    expect(PublicWorldSchema.safeParse(world).success).toBe(true);
    const encoded = JSON.stringify(world);
    for (const key of ["seed", "payload", "generatorVersion", "schemaVersion", "startingState", "units", "identityId", "settings"]) expect(encoded).not.toContain(`"${key}"`);
    expect(world.territories.filter((t) => t.capital)).toHaveLength(count);
    expect(Buffer.byteLength(encoded)).toBeLessThan(2 * 1024 * 1024);
    expect(PublicWorldSchema.safeParse(stored.payload).success).toBe(false);
    expect(PublicWorldSchema.safeParse({ ...world, seed: 1 }).success).toBe(false);
    expect(PublicWorldSchema.safeParse({ ...world, territories: [{ ...world.territories[0], hiddenUnits: [] }, ...world.territories.slice(1)] }).success).toBe(false);
  });
  it("rejects corrupted metadata/rosters instead of regenerating or leaking payloads", () => {
    const { stored, players } = projectionFixture();
    for (const change of [{ seed: 0n }, { schemaVersion: 2 }, { generatorVersion: "unknown" }, { payload: {} }]) expect(() => projectWorld({ ...stored, ...change }, players)).toThrow();
    expect(() => projectWorld(stored, [{ playerId: "outsider", username: "Other" }])).toThrow();
    for (const state of ["NOT_STARTED", "UNINITIALIZED"]) {
      expect(ReadWorldResponseSchema.safeParse({ schemaVersion: 1, matchId: "fixture", state }).success).toBe(true);
      expect(ReadWorldResponseSchema.safeParse({ schemaVersion: 1, matchId: "fixture", state, world: {} }).success).toBe(false);
    }
  });
});
