import { validateCitySites } from "../src/city-scenario.js";
import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";
import { CITY_SCENARIO } from "../src/city-scenario.js";
import { europeLandPoint, europeMaskLandPoint } from "../src/europe-playtest.js";
import { cityFixture } from "./city-fixture.js";

// Prepare the pinned surface once in this worker before timing gameplay assertions.
beforeAll(validateCitySites, 20_000);

test("active city anchors match the real Europe map and both coordinate grids are land", () => {
  const geography = JSON.parse(readFileSync(new URL("../../../apps/web/src/europe/geography.json", import.meta.url), "utf8"));
  expect(CITY_SCENARIO.map(c => [c.name, c.position.x, c.position.y])).toEqual([
    ["Madrid", 368, 463], ["Andorra la Vella", 946, 152], ["Bilbao", 452, 38]
  ]);
  for (const city of CITY_SCENARIO) {
    expect(geography.cities).toContainEqual(expect.objectContaining({ name: city.name, lat: city.lat, lon: city.lon }));
    expect(europeMaskLandPoint(city.maskPoint)).toBe(true);
    expect(europeLandPoint(city.position)).toBe(true);
  }
});

test("city genesis replaces camp origins and positions, pins funds, and keeps Bilbao neutral", () => {
  const state = cityFixture(1234);
  expect(state).toEqual(cityFixture(1234));
  expect(state.snapshotId).not.toBe(cityFixture(0).snapshotId);
  expect(state.cityOwners).toEqual([
    { cityId: "madrid", ownerPlayerId: "alpha" },
    { cityId: "andorra-la-vella", ownerPlayerId: "beta" },
    { cityId: "bilbao", ownerPlayerId: null }
  ]);
  expect(state.economy.treasury).toEqual([{ playerId: "alpha", credits: 1234 }, { playerId: "beta", credits: 1234 }]);
  for (const formation of state.formations) {
    const city = CITY_SCENARIO.find(c => c.cityId === formation.garrisonCityId)!;
    expect(formation.position).toEqual({ xMilli: city.position.x * 1000, yMilli: city.position.y * 1000 });
    const units = state.units.filter(u => formation.unitIds.includes(u.unitId));
    expect(units).toHaveLength(6);
    expect(units.every(u => u.originalSpawnNodeId === city.cityId)).toBe(true);
  }
});
