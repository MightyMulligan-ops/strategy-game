import { europeDisplayToGame, europeLonLatToDisplay } from "@strategy-game/shared-types";
import type { CityId } from "@strategy-game/shared-types";
import { europeLandPoint, europeMaskLandPoint } from "./europe-playtest.js";
import { europeLonLatToMask } from "@strategy-game/shared-types";

// The explicit gameplay set uses the same geographic anchors as the display.
const anchors = [
  { cityId: "madrid", name: "Madrid", capital: true, lon: -3.685298, lat: 40.401972 },
  { cityId: "andorra-la-vella", name: "Andorra la Vella", capital: true, lon: 1.516486, lat: 42.500001 },
  { cityId: "bilbao", name: "Bilbao", capital: false, lon: -2.929987, lat: 43.249982 }
] as const;

export const CITY_SCENARIO = Object.freeze(anchors.map(anchor => {
  const position = europeDisplayToGame(europeLonLatToDisplay(anchor.lon, anchor.lat));
  const maskPoint = europeLonLatToMask(anchor.lon, anchor.lat);
  return Object.freeze({ ...anchor, position: Object.freeze(position), maskPoint: Object.freeze(maskPoint) });
}));

export function scenarioCity(cityId: CityId) {
  const city = CITY_SCENARIO.find(city => city.cityId === cityId);
  if (!city) throw Error("Unknown scenario city");
  return city;
}

export function validateCitySites() {
  for (const { maskPoint, position } of CITY_SCENARIO) {
    if (!europeMaskLandPoint(maskPoint) || !europeLandPoint(position)) throw Error("City anchor must be on land");
  }
}

export function initialCityOwners(players: readonly string[]) {
  const [first, second] = [...players].sort();
  if (!first || !second || first === second || players.length !== 2) throw Error("City scenario requires two distinct players");
  return CITY_SCENARIO.map((city, i) => ({
    cityId: city.cityId,
    ownerPlayerId: [first, second, null][i]!
  }));
}
