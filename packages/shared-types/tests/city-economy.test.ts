import { expect, test } from "vitest";
import { CITY_BALANCE_V1, CityBalanceSchema, CityEditSchema, DEFAULT_STARTING_CREDITS } from "../src/city-economy.js";
import { CITY_RUNTIME, CityRuntimeSchema, EuropeRuntimeSchema } from "../src/server.js";

test("city creation pin freezes validated host credits alongside versioned balance and scenario", () => {
  const value = { ...CITY_RUNTIME, balance: { ...CITY_BALANCE_V1, startingCredits: DEFAULT_STARTING_CREDITS } };
  const parsed = CityRuntimeSchema.parse(value);
  expect(parsed.balance.startingCredits).toBe(2000);
  expect(Object.isFrozen(parsed.balance)).toBe(true);
  expect(EuropeRuntimeSchema.safeParse(parsed).success).toBe(false);
  for (const startingCredits of [-1, 0.5, Infinity, 1_000_000_001, "2000"]) {
    expect(CityBalanceSchema.safeParse({ ...parsed.balance, startingCredits }).success).toBe(false);
  }
  expect(CityRuntimeSchema.safeParse({ ...value, balance: { ...value.balance, infantryPrice: 1 } }).success).toBe(false);
  expect(CityRuntimeSchema.safeParse({ ...value, europe: { ...value.europe, scenarioId: "iberian-two-camps-v1" } }).success).toBe(false);
});

test("recruitment edit accepts only owned-city intent fields and supported unit types", () => {
  const command = { kind: "recruit", cityId: "madrid", recruitmentId: "37d5bdee-08c1-4af6-b120-17a05ca161ff",
    unitType: "INFANTRY", quantity: 5 };
  expect(CityEditSchema.safeParse(command).success).toBe(true);
  for (const fields of [{ unitType: "CAPTAIN" }, { quantity: 6 }, { quantity: 0 }, { cityId: "city-0" },
    { paid: 0 }, { ownerPlayerId: "forged" }, { arrivalTurn: 1 }]) {
    expect(CityEditSchema.safeParse({ ...command, ...fields }).success).toBe(false);
  }
});
