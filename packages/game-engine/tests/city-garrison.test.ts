import { validateCitySites } from "../src/city-scenario.js";
import { beforeAll, expect, test } from "vitest";
import { cityFixture } from "./city-fixture.js";
import { cityCommander, consolidateGarrison, ownGarrison } from "../src/city-garrison.js";
import { applyCityEdit, initialCityDraft, settleCityEconomy } from "../src/city-economy.js";

// Prepare the pinned surface once in this worker before timing gameplay assertions.
beforeAll(validateCitySites, 20_000);

test("preferred duplicate Lieutenant commands, with deterministic unit-ID fallback", () => {
  const state = cityFixture();
  const draft = applyCityEdit(state, initialCityDraft(state, "alpha"), {
    kind: "recruit", recruitmentId: "37d5bdee-08c1-4af6-b120-17a05ca161ff",
    cityId: "madrid", unitType: "LIEUTENANT", quantity: 2
  });
  const after = settleCityEconomy(state, [draft, initialCityDraft(state, "beta")], [], state.units, state.formations);
  const leaders = after.units.filter(u => u.ownerPlayerId === "alpha" && u.kind === "LEADER");
  expect(leaders).toHaveLength(3);
  const preferred = leaders[2]!.unitId;
  expect(cityCommander(leaders, preferred)).toBe(preferred);
  expect(cityCommander(leaders.slice(0, 2).reverse(), preferred)).toBe(leaders[0]!.unitId);
});

test("same owner's units consolidate without transferring a different owner's formation", () => {
  const state = cityFixture(), madrid = ownGarrison(state, "alpha", "madrid")!;
  const foreign = ownGarrison(state, "beta", "andorra-la-vella")!;
  expect(() => consolidateGarrison(state, state.formations, "alpha", "madrid", [foreign])).toThrow();
  const departure = { ...madrid, garrisonCityId: null, formationId: "formation:" + "a".repeat(64), unitIds: madrid.unitIds.slice(0, 1) };
  const remainder = { ...madrid, unitIds: madrid.unitIds.slice(1) };
  expect(consolidateGarrison(state, [remainder, foreign, departure], "alpha", "madrid", [departure]))
    .toEqual([...state.formations].sort((a,b) => a.formationId < b.formationId ? -1 : 1));
});
