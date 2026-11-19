import { validateCitySites } from "../src/city-scenario.js";
import { beforeAll, expect, test } from "vitest";
import { cityFixture } from "./city-fixture.js";
import { ownGarrison, validateDispatch } from "../src/city-garrison.js";
import { applyCityEdit, initialCityDraft, settleCityEconomy } from "../src/city-economy.js";

// Prepare the pinned surface once in this worker before timing gameplay assertions.
beforeAll(validateCitySites, 20_000);

test("dispatch admits own led units and rejects duplicate reservations, field rank excess, and invalid destinations", () => {
  const initial = cityFixture();
  const paid = applyCityEdit(initial, initialCityDraft(initial, "alpha"), {
    kind: "recruit", recruitmentId: "37d5bdee-08c1-4af6-b120-17a05ca161ff",
    cityId: "madrid", unitType: "LIEUTENANT", quantity: 1
  });
  const settled = settleCityEconomy(initial, [paid, initialCityDraft(initial, "beta")], [], initial.units, initial.formations);
  const state = { ...initial, units: settled.units, formations: settled.formations, economy: settled.economy };
  const garrison = ownGarrison(state, "alpha", "madrid")!;
  const owned = state.units.filter(u => garrison.unitIds.includes(u.unitId));
  const leaders = owned.filter(u => u.kind === "LEADER").map(u => u.unitId);
  const infantry = owned.find(u => u.kind === "INFANTRY")!.unitId;
  const order = { dispatchId: "7b2111b2-76a5-4bd4-ab97-89dc7f1c06ac", cityId: "madrid",
    unitIds: [leaders[0]!, infantry], destination: { x: 368, y: 453 } } as const;
  expect(() => validateDispatch(state, "alpha", order, [])).not.toThrow();
  expect(() => validateDispatch(state, "beta", order, [])).toThrow();
  expect(() => validateDispatch(state, "alpha", order, [order])).toThrow();
  expect(() => validateDispatch(state, "alpha", { ...order, unitIds: leaders }, [])).toThrow();
  expect(() => validateDispatch(state, "alpha", { ...order, unitIds: [infantry] }, [])).toThrow();
  expect(() => validateDispatch(state, "alpha", { ...order, destination: { x: 946, y: 152 } }, [])).toThrow();
});
