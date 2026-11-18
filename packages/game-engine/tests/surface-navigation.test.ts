import { describe, expect, it } from "vitest";
import { prepareSurfaceNavigation, SurfaceNavigationInputError } from "../src/surface-navigation.js";
import type { SurfaceMap, SurfacePoint } from "../src/surface-navigation.js";

const p = (x: number, y: number): SurfacePoint => ({ x, y });
const rect = (x: number, y: number, w: number, h: number) => ({ outer: [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)] });
function fixture(): SurfaceMap {
  return { schemaVersion: 1, maskId: "coast-fixture-v1", bounds: { width: 1000, height: 1000 },
    land: [rect(100, 100, 300, 800), rect(600, 100, 300, 800), rect(480, 480, 40, 40)],
    inlandWater: [rect(200, 350, 20, 20)] };
}
const route = (...points: [number, number][]) => points.map(([x, y]) => p(x, y));

describe("surface navigation", () => {
  it.each([1, 2] as const)("blocks rounded vertex contacts in both route directions for schema %s", (schemaVersion) => {
    const island = { outer: [p(56940, 600000), p(56700, 600111), p(57260, 600251)] };
    const map = prepareSurfaceNavigation({ schemaVersion, maskId: "rounded-contact", bounds: { width: 944444, height: 886082 }, land: [island], inlandWater: [] });
    const path = route([3, 600000], [908253, 600000]);
    for (const points of [path, [...path].reverse()]) {
      expect(map.validateRoute("NAVAL", points)).toMatchObject({ eligible: false, reason: "BOUNDARY_CONTACT", segmentIndex: 0 });
    }
    // A nearby integer route clears the island and must remain navigable.
    expect(map.validateRoute("NAVAL", route([3, 599999], [908253, 599999])).eligible).toBe(true);
  });
  it("blocks rounded lake vertex contacts for land routes and reports the affected segment", () => {
    const map = prepareSurfaceNavigation({ schemaVersion: 2, maskId: "lake-contact", bounds: { width: 944444, height: 886082 },
      land: [rect(1, 1, 944442, 886080)],
      inlandWater: [{ outer: [p(56940, 600000), p(56700, 600111), p(57260, 600251)] }] });
    const path = route([3, 599999], [3, 600000], [908253, 600000]);
    expect(map.validateRoute("LAND", path)).toMatchObject({ eligible: false, reason: "BOUNDARY_CONTACT", segmentIndex: 1 });
    expect(map.validateRoute("LAND", [...path].reverse())).toMatchObject({ eligible: false, reason: "BOUNDARY_CONTACT", segmentIndex: 0 });
    expect(map.validateRoute("LAND", route([3, 599999], [908253, 599999])).eligible).toBe(true);
  });
  it("classifies land, ocean, inland water, shore and out-of-bounds separately", () => {
    const map = prepareSurfaceNavigation(fixture());
    expect([p(150, 150), p(450, 150), p(210, 360), p(100, 150), p(-1, 2)].map(map.classifyPoint))
      .toEqual(["LAND", "OCEAN", "INLAND_WATER", "BOUNDARY", "OUT_OF_BOUNDS"]);
  });
  it("accepts an entirely land-based path", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("LAND", route([150, 150], [300, 300], [300, 800])))
      .toEqual({ eligible: true, reason: "ELIGIBLE", segmentIndex: null, maskId: "coast-fixture-v1" });
  });
  it("accepts an ocean route around an island", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("NAVAL", route([450, 450], [450, 550], [550, 550]))).toMatchObject({ eligible: true });
  });
  it("rejects a land destination in the ocean", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("LAND", route([150, 150], [450, 150]))).toMatchObject({ eligible: false, reason: "LAND_REQUIRED" });
  });
  it("rejects a naval destination on land", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("NAVAL", route([450, 150], [150, 150]))).toMatchObject({ eligible: false, reason: "OCEAN_REQUIRED" });
  });
  it("rejects a land-to-land route crossing a sea even with valid endpoints", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("LAND", route([150, 150], [800, 150]))).toMatchObject({ eligible: false, segmentIndex: 0 });
  });
  it("rejects a sea-to-sea route across an island", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("NAVAL", route([450, 500], [550, 500]))).toMatchObject({ eligible: false });
  });
  it("does not miss one-unit-wide water gaps", () => {
    const input = { ...fixture(), land: [rect(1, 1, 499, 998), rect(501, 1, 498, 998)], inlandWater: [] };
    expect(prepareSurfaceNavigation(input).validateRoute("LAND", route([2, 450], [998, 450])).eligible).toBe(false);
  });
  it("does not miss a narrow land strip between valid sea endpoints", () => {
    expect(prepareSurfaceNavigation({ ...fixture(), land: [rect(500, 1, 1, 998)], inlandWater: [] })
      .validateRoute("NAVAL", route([2, 450], [998, 450])).eligible).toBe(false);
  });
  it.each(["LAND", "NAVAL"] as const)("blocks inland-water destinations for %s until policy exists", (domain) => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute(domain, route([210, 360], [211, 361])))
      .toMatchObject({ eligible: false, reason: "INLAND_WATER_BLOCKED" });
  });
  it("blocks a lake crossed inside a mainland route", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("LAND", route([150, 360], [300, 360])).eligible).toBe(false);
  });
  it("checks every segment of a multi-waypoint route and reports the first invalid segment", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("LAND", route([150, 150], [350, 200], [650, 200], [800, 200])))
      .toMatchObject({ eligible: false, segmentIndex: 1 });
  });
  it("rejects tangent contact with an island", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("NAVAL", route([450, 510], [510, 450])).eligible).toBe(false);
    expect(prepareSurfaceNavigation(fixture()).validateRoute("NAVAL", route([450, 480], [550, 480])).eligible).toBe(false);
  });
  it.each(["LAND", "NAVAL"] as const)("rejects exact coastline positions for %s", (domain) => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute(domain, route([400, 200], [400, 300])))
      .toMatchObject({ eligible: false, reason: "BOUNDARY_CONTACT" });
  });
  it("validates zero-length moves against the same surface rules", () => {
    const map = prepareSurfaceNavigation(fixture());
    expect(map.validateRoute("LAND", route([150, 150], [150, 150])).eligible).toBe(true);
    expect(map.validateRoute("LAND", route([450, 150], [450, 150])).eligible).toBe(false);
  });
  it("respects polygon holes", () => {
    const map = prepareSurfaceNavigation({ ...fixture(), land: [{ ...rect(100, 100, 800, 800), holes: [rect(300, 300, 100, 100).outer] }], inlandWater: [] });
    expect(map.classifyPoint(p(350, 350))).toBe("OCEAN");
    expect(map.validateRoute("LAND", route([200, 350], [500, 350])).eligible).toBe(false);
  });
  it("accepts both polygon orientations", () => {
    const input = fixture();
    const reversed = { ...input, land: input.land.map((poly) => ({ outer: [...poly.outer].reverse() })) };
    expect(prepareSurfaceNavigation(input).validateRoute("LAND", route([150, 150], [300, 300])))
      .toEqual(prepareSurfaceNavigation(reversed).validateRoute("LAND", route([150, 150], [300, 300])));
  });
  it("copies the mask and exposes frozen results", () => {
    const input = JSON.parse(JSON.stringify(fixture())) as { land: { outer: { x: number; y: number }[] }[] };
    const map = prepareSurfaceNavigation(input);
    input.land[0]!.outer[0]!.x = 500;
    expect(map.classifyPoint(p(150, 150))).toBe("LAND");
    expect(Object.isFrozen(map.validateRoute("LAND", route([150, 150], [300, 300])))).toBe(true);
  });
  it("has no arbitrary waypoint-count gameplay cap", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("LAND", Array.from({ length: 501 }, () => p(150, 150))).eligible).toBe(true);
  });
  it("does not depend on image or camera state", () => {
    const map = prepareSurfaceNavigation(fixture()), path = route([150, 150], [300, 300]);
    expect(map.validateRoute("LAND", path)).toEqual(map.validateRoute("LAND", JSON.parse(JSON.stringify(path))));
    expect(path).toEqual(route([150, 150], [300, 300]));
  });
  it("reports out-of-bounds without validating a destination as ocean", () => {
    expect(prepareSurfaceNavigation(fixture()).validateRoute("NAVAL", route([450, 200], [1100, 200])))
      .toMatchObject({ eligible: false, reason: "OUT_OF_BOUNDS" });
  });
  it("fails closed on unsupported movement domains", () => {
    expect(() => prepareSurfaceNavigation(fixture()).validateRoute("AIR" as "LAND", route([150, 150], [300, 300])))
      .toThrow(SurfaceNavigationInputError);
  });
  it.each([[], [p(1, 1)], [p(NaN, 1), p(1, 1)], [p(1.5, 1), p(2, 2)], [{ x: 1, y: 2, domain: "LAND" }, p(2, 2)]].map((value) => ({ value })))("rejects malformed routes %#", ({ value }) => {
    expect(() => prepareSurfaceNavigation(fixture()).validateRoute("LAND", value)).toThrow(SurfaceNavigationInputError);
  });
  it("keeps point-touching components invalid in schema 1", () => {
    expect(() => prepareSurfaceNavigation({ ...fixture(), land: [rect(100, 100, 100, 100), rect(200, 200, 100, 100)], inlandWater: [] })).toThrow(SurfaceNavigationInputError);
  });
  it("admits isolated point contacts in schema 2 without opening either domain", () => {
    const map = prepareSurfaceNavigation({ ...fixture(), schemaVersion: 2, land: [rect(100, 100, 100, 100), rect(200, 200, 100, 100)], inlandWater: [] });
    expect(map.classifyPoint(p(200, 200))).toBe("BOUNDARY");
    expect(map.validateRoute("LAND", route([150, 150], [250, 250]))).toMatchObject({ eligible: false, reason: "BOUNDARY_CONTACT" });
    expect(map.validateRoute("NAVAL", route([150, 250], [250, 150]))).toMatchObject({ eligible: false, reason: "BOUNDARY_CONTACT" });
  });
  it.each([
    [rect(100, 100, 100, 100), rect(200, 100, 100, 100)], // shared edge
    [rect(100, 100, 200, 200), rect(150, 150, 50, 50)], // containment
    [rect(100, 200, 400, 100), rect(200, 100, 100, 400)], // crossing with no vertex inside
    [rect(100, 100, 200, 200), rect(200, 200, 200, 200)], // partial overlap
    [rect(100, 100, 100, 100), rect(100, 100, 100, 100)], // coincident
  ])("still rejects ambiguous schema 2 components %#", (first, second) => {
    for (const pair of [[first, second], [second, first]]) {
      expect(() => prepareSurfaceNavigation({ ...fixture(), schemaVersion: 2, land: pair, inlandWater: [] })).toThrow(SurfaceNavigationInputError);
    }
  });
  it("accepts an island touching a hole at one point but blocks the contact", () => {
    const map = prepareSurfaceNavigation({ ...fixture(), schemaVersion: 2, land: [
      { ...rect(100, 100, 800, 800), holes: [rect(300, 300, 400, 400).outer] },
      { outer: [p(300, 500), p(400, 400), p(500, 500), p(400, 600)] },
    ], inlandWater: [] });
    expect(map.classifyPoint(p(400, 500))).toBe("LAND");
    expect(map.classifyPoint(p(300, 500))).toBe("BOUNDARY");
    expect(map.validateRoute("LAND", route([200, 500], [400, 500])).eligible).toBe(false);
  });
  it("retains ring self-contact rejection in schema 2", () => {
    expect(() => prepareSurfaceNavigation({ ...fixture(), schemaVersion: 2, land: [{ outer: [p(100, 100), p(300, 300), p(100, 300), p(300, 100)] }], inlandWater: [] })).toThrow(SurfaceNavigationInputError);
  });
  it.each([
    { ...fixture(), schemaVersion: 3 },
    { ...fixture(), maskId: " " },
    { ...fixture(), waterAllowed: true },
    { ...fixture(), bounds: { width: 0, height: 1000 } },
    { ...fixture(), land: [{ outer: [p(1, 1), p(5, 5), p(1, 5), p(5, 1)] }] },
    { ...fixture(), land: [{ outer: [p(1, 1), p(2, 2), p(3, 3)] }] },
    { ...fixture(), land: [{ outer: [p(1, 1), p(3, 1), p(3, 3), p(1, 1)] }] },
    { ...fixture(), land: [{ ...rect(100, 100, 200, 200), holes: [rect(10, 10, 20, 20).outer] }] },
    { ...fixture(), land: [{ ...rect(100, 100, 200, 200), holes: [rect(120, 120, 50, 50).outer, rect(130, 130, 20, 20).outer] }] },
    { ...fixture(), land: [rect(100, 100, 100, 100), rect(200, 100, 100, 100)] },
    { ...fixture(), land: [rect(100, 100, 100, 100), rect(150, 150, 100, 100)] }
  ])("rejects malformed masks %#", (value) => {
    expect(() => prepareSurfaceNavigation(value)).toThrow(SurfaceNavigationInputError);
  });
});
