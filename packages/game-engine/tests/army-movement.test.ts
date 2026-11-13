import { describe, expect, it } from "vitest";
import { classifyEncounter, evaluateLeadership, evaluateStartingFootMovement, geographicDistance, squaredDistance } from "../src/index.js";
import { armyFixture } from "./initial-armies-fixture.js";

describe("pure geographic foundations (never execute movement)", () => {
  const units = armyFixture().plan.snapshot.units.filter((u) => u.ownerPlayerId === "p00");
  const movement = { ownerPlayerId: "p00", from: { x: 0, y: 0 }, bounds: { width: 1000, height: 500 }, members: units };
  it("uses integer map coordinates, exact squared distance and Euclidean distance", () => {
    expect(squaredDistance({ x: 0, y: 0 }, { x: 150, y: 200 })).toBe(62500);
    expect(geographicDistance({ x: 0, y: 0 }, { x: 150, y: 200 })).toBe(250);
    for (const p of [{ x: -1, y: 0 }, { x: .5, y: 0 }, { x: NaN, y: 0 }, { x: 5000, y: 0 }]) expect(() => squaredDistance(p, { x: 0, y: 0 })).toThrow();
  });
  it.each([[0, true], [250, true], [251, false]])("assesses %i distance eligibility", (x, eligible) => {
    expect(evaluateStartingFootMovement({ ...movement, destinations: [{ x, y: 0 }] }).eligible).toBe(eligible);
  });
  it("counts every numbered segment cumulatively, including returns, without resetting budget", () => {
    const path = { ...movement, destinations: [{ x: 150, y: 0 }, { x: 0, y: 0 }] }; const before = JSON.stringify(path);
    expect(evaluateStartingFootMovement(path)).toMatchObject({ eligible: false, reason: "RANGE_EXCEEDED", distance: 300, remainingBudget: 0 });
    expect(JSON.stringify(path)).toBe(before);
    expect(evaluateStartingFootMovement({ ...movement, destinations: [{ x: 150, y: 0 }, { x: 250, y: 0 }] })).toMatchObject({ eligible: true, remainingBudget: 0 });
    // Eligibility is the cumulative distance; no unapproved numbered-order count cap.
    expect(evaluateStartingFootMovement({ ...movement, destinations: Array.from({ length: 101 }, () => ({ x: 0, y: 0 })) })).toMatchObject({ eligible: true, distance: 0 });
    expect(evaluateStartingFootMovement({ ...movement, bounds: { width: 100, height: 100 }, destinations: [{ x: 101, y: 0 }] }).reason).toBe("OUT_OF_BOUNDS");
  });
  it("derives the highest unique rank and refuses duplicate rank/ID", () => {
    const leaders = [{ unitId: "lt", kind: "LEADER", rank: "LIEUTENANT" }, { unitId: "gen", kind: "LEADER", rank: "GENERAL" }];
    expect(evaluateLeadership(leaders)).toMatchObject({ primaryLeaderId: "gen", primaryRank: "GENERAL" });
    expect(() => evaluateLeadership([...leaders, { ...leaders[0], unitId: "lt2" }])).toThrow();
    expect(() => evaluateLeadership([leaders[0], leaders[0]])).toThrow();
  });
  it("keeps single leaderless radius non-executable and rejects five leaderless Infantry", () => {
    const infantry = units.filter((u) => u.kind === "INFANTRY");
    expect(evaluateStartingFootMovement({ ...movement, members: infantry, destinations: [{ x: 1, y: 0 }] }).reason).toBe("LEADER_REQUIRED");
    expect(evaluateStartingFootMovement({ ...movement, members: infantry.slice(0, 1), destinations: [{ x: 0, y: 0 }] }).reason).toBe("SOURCE_RADIUS_UNAPPROVED");
    expect(() => evaluateStartingFootMovement({ ...movement, ownerPlayerId: "other", destinations: [{ x: 1, y: 0 }] })).toThrow();
    expect(() => evaluateStartingFootMovement({ ...movement, members: [{ ...units[0], kind: "CAVALRY" }], destinations: [{ x: 1, y: 0 }] })).toThrow();
  });
  const contact = { destination: { x: 10, y: 10 }, occupant: { position: { x: 10, y: 10 } }, relationship: "hostile", situation: "converging_destinations" };
  it("separates explicit relationship from exact-point/city geometry", () => {
    expect(classifyEncounter(contact)).toBe("CONTESTED_POINT");
    expect(classifyEncounter({ ...contact, destinationCityId: "city", occupant: { position: { x: 11, y: 10 }, cityId: "city" } })).toBe("CONTESTED_CITY");
    expect(classifyEncounter({ ...contact, relationship: "friendly" })).toBe("FRIENDLY_COLOCATION");
    expect(classifyEncounter({ ...contact, relationship: "unknown" })).toBe("POLICY_REQUIRED");
    expect(classifyEncounter({ ...contact, situation: "occupied_destination" })).toBe("HOSTILE_OCCUPIED_DESTINATION");
    expect(classifyEncounter({ ...contact, occupant: null })).toBe("CLEAR");
  });
  it("does not invent tolerance, interception, vacating policy or foreign-owner hostility", () => {
    for (const situation of ["crossing_paths", "vacating_position"]) expect(classifyEncounter({ ...contact, situation })).toBe("POLICY_REQUIRED");
    expect(classifyEncounter({ ...contact, occupant: { position: { x: 11, y: 10 } } })).toBe("POLICY_REQUIRED");
    expect(() => classifyEncounter({ ...contact, relationship: undefined, ownerPlayerId: "other" })).toThrow();
  });
});
