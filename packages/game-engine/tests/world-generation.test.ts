import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as publicContracts from "@strategy-game/shared-types";
import {
  GeneratedWorldSchema, WORLD_GENERATOR_VERSION, WORLD_MAX_TERRITORIES,
  WorldGenerationInputSchema, WorldGenerationResultSchema
} from "@strategy-game/shared-types/server";
import type { GeneratedWorld, WorldTerritory } from "@strategy-game/shared-types/server";
import { generateWorld } from "../src/index.js";

const input = (count = 2, seed = 42, regionSide: 3 | 5 | 7 = 5) => ({
  schemaVersion: 1, generatorVersion: WORLD_GENERATOR_VERSION, seed,
  players: Array.from({ length: count }, (_, index) => `player-${index.toString().padStart(2, "0")}`), settings: { regionSide }
});
function world(count = 2, seed = 42, regionSide: 3 | 5 | 7 = 5): GeneratedWorld {
  const result = generateWorld(input(count, seed, regionSide));
  if (!result.ok) throw new Error(`Generation failed: ${result.error.code}`);
  return result.world;
}
const area = (t: WorldTerritory) => (t.polygon[1].x - t.polygon[0].x) * (t.polygon[3].y - t.polygon[0].y);
function graph(w: GeneratedWorld) {
  const neighbors = new Map(w.territories.map((t) => [t.territoryId, [] as string[]]));
  for (const link of w.links) { neighbors.get(link.a)!.push(link.b); neighbors.get(link.b)!.push(link.a); }
  return neighbors;
}
function distances(neighbors: Map<string, string[]>, from: string) {
  const found = new Map([[from, 0]]); const queue = [from];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    for (const next of neighbors.get(id)!) if (!found.has(next)) { found.set(next, found.get(id)! + 1); queue.push(next); }
  }
  return found;
}

describe("deterministic procedural territory generation", () => {
  it.each([2, 4, 10, 40])("replays %i-player worlds without depending on input roster order", (count) => {
    const command = input(count, 0xffff_ffff); const before = JSON.stringify(command);
    const first = generateWorld(command); const second = generateWorld(command);
    expect(first.ok).toBe(true); expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(generateWorld({ ...command, players: [...command.players].reverse() })).toEqual(first);
    expect(JSON.stringify(command)).toBe(before); expect(Object.isFrozen(command)).toBe(false);
    expect(WorldGenerationResultSchema.safeParse(first).success).toBe(true);
  });

  it.each([2, 4, 10, 40])("pins the v1 canonical output for %i players", (count) => {
    const hashes: Record<number, string> = {
      2: "011fb055129a949562dcf196bab6c0d185c5673e63594f00d517255bd4f29f93",
      4: "9a1f8401c2e4c7ff7a96fcee59e9d8cb74c1c14a5e87b71522f81ac29c23a043",
      10: "b49e1ad93ab8cc8f689efed147d15e3a11bd1986c127be700f6055c3a7c6d8ef",
      40: "4010ddc74398efabf0dbdc07139452fa3950e8951212ffb9fee53f37c79944a5"
    };
    const fingerprint = createHash("sha256").update(JSON.stringify(world(count, 123456789))).digest("hex");
    expect(fingerprint).toBe(hashes[count]);
  });

  it("produces different real geometry/terrain/start assignments for different seeds", () => {
    const a = world(10, 0); const b = world(10, 1);
    expect(a.territories.map((t) => t.polygon)).not.toEqual(b.territories.map((t) => t.polygon));
    expect(a.territories.map((t) => t.terrain)).not.toEqual(b.territories.map((t) => t.terrain));
    expect(a.startingState.starts).not.toEqual(b.startingState.starts);
  });

  it.each([2, 4, 10, 40])("tiles a bounded world with no overlapping territory for %i players", (count) => {
    const w = world(count); const ids = new Set(w.territories.map((t) => t.territoryId));
    expect(ids.size).toBe(w.territories.length);
    expect(w.territories.length).toBeLessThanOrEqual(WORLD_MAX_TERRITORIES);
    let totalArea = 0;
    for (let i = 0; i < w.territories.length; i++) {
      const a = w.territories[i]!; totalArea += area(a); expect(area(a)).toBeGreaterThan(0);
      for (const p of [...a.polygon, a.center]) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(w.bounds.width);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(w.bounds.height);
      }
      for (let j = i + 1; j < w.territories.length; j++) {
        const b = w.territories[j]!;
        const overlap = Math.max(a.polygon[0].x, b.polygon[0].x) < Math.min(a.polygon[1].x, b.polygon[1].x) &&
          Math.max(a.polygon[0].y, b.polygon[0].y) < Math.min(a.polygon[3].y, b.polygon[3].y);
        if (overlap) throw new Error("Territory interiors overlap");
      }
    }
    expect(totalArea).toBe(w.bounds.width * w.bounds.height);
  });

  it.each([2, 4, 10, 40])("has a connected, undirected side-sharing graph with no isolated cells for %i players", (count) => {
    const w = world(count); const neighbors = graph(w);
    expect(distances(neighbors, w.territories[0]!.territoryId).size).toBe(w.territories.length);
    expect(new Set(w.links.map((edge) => JSON.stringify(edge))).size).toBe(w.links.length);
    const byId = new Map(w.territories.map((t) => [t.territoryId, t]));
    for (const edge of w.links) {
      expect(edge.a < edge.b).toBe(true);
      const a = byId.get(edge.a)!; const b = byId.get(edge.b)!;
      expect(a).toBeDefined(); expect(b).toBeDefined();
      const sharedVertices = a.polygon.filter((p) => b.polygon.some((q) => p.x === q.x && p.y === q.y));
      expect(sharedVertices).toHaveLength(2); // Corner contact alone is not adjacency.
    }
    for (const adjacent of neighbors.values()) expect(adjacent.length).toBeGreaterThanOrEqual(2);
    expect([...w.links]).toEqual([...w.links].sort((a, b) => a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : a.b > b.b ? 1 : 0));
  });

  it.each([2, 4, 10, 40])("guarantees balanced local starts across settings/seeds for %i players", (count) => {
    for (const side of [3, 5, 7] as const) for (const seed of [0, 1, 42, 0x8000_0000, 0xffff_ffff]) {
      const w = world(count, seed, side); const neighbors = graph(w);
      const byId = new Map(w.territories.map((t) => [t.territoryId, t]));
      const signatures = w.startingState.starts.map((s) => {
        const t = byId.get(s.capitalTerritoryId)!; const adjacent = neighbors.get(t.territoryId)!;
        const paths = distances(neighbors, t.territoryId);
        expect(adjacent).toHaveLength(4);
        expect(w.startingState.ownership.filter((o) => o.ownerPlayerId === s.playerId)).toEqual([{ territoryId: t.territoryId, ownerPlayerId: s.playerId }]);
        const cities = w.startingState.cities.filter((c) => c.ownerPlayerId === s.playerId);
        const resources = w.startingState.resourceNodes.filter((r) => r.ownerPlayerId === s.playerId);
        expect(cities).toHaveLength(1); expect(resources).toHaveLength(1);
        expect(cities[0]!.position).toEqual(t.center); expect(resources[0]!.position).toEqual(t.center);
        expect(resources[0]!.cityId).toBe(cities[0]!.cityId); expect(resources[0]!.stockpile).toBe(0);
        for (const other of w.startingState.starts) if (other.playerId !== s.playerId) {
          expect(paths.get(other.capitalTerritoryId)).toBeGreaterThanOrEqual(side);
          const point = byId.get(other.capitalTerritoryId)!.center;
          expect(Math.hypot(t.center.x - point.x, t.center.y - point.y)).toBeGreaterThanOrEqual(side * 100);
        }
        return JSON.stringify([area(t), t.terrain, adjacent.map((id) => byId.get(id)!.terrain).sort()]);
      });
      expect(new Set(signatures).size).toBe(1);
      expect(w.startingState.units).toEqual([]);
      expect(w.startingState.ownership.filter((o) => o.ownerPlayerId !== null)).toHaveLength(count);
    }
  });

  it("supports every roster size from two through forty, including unused neutral regions", () => {
    for (let count = 2; count <= 40; count++) expect(world(count).startingState.starts).toHaveLength(count);
    expect(world(10).territories.length).toBe(12 * 25);
    expect(world(40, 42, 7).territories).toHaveLength(WORLD_MAX_TERRITORIES);
  });

  it("uses no clock or ambient randomness and returns deeply readonly data", () => {
    const expected = world(4);
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Ambient random used"); });
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Clock used"); });
    try { expect(world(4)).toEqual(expected); } finally { random.mockRestore(); now.mockRestore(); }
    function frozen(value: unknown) {
      if (!value || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true); for (const child of Object.values(value)) frozen(child);
    }
    frozen(expected);
  });
});

describe("versioned authoritative world contracts", () => {
  it.each([undefined, null, {}, [], { ...input(), schemaVersion: 2 }, { ...input(), seed: -1 },
    { ...input(), seed: 0x1_0000_0000 }, { ...input(), seed: "42" }, { ...input(), seed: 1.5 },
    { ...input(), seed: NaN }, { ...input(), seed: Infinity }, { ...input(), players: ["one"] }, input(41),
    { ...input(), players: ["one", "one"] }, { ...input(), players: [" padded", "two"] },
    { ...input(), players: ["x".repeat(129), "two"] }, { ...input(), settings: { regionSide: 4 } },
    { ...input(), settings: { regionSide: "5" } }, { ...input(), settings: { regionSide: 5, era: "future" } },
    { ...input(), generatorVersion: null }, { ...input(), hostId: "spoofed" }])("rejects invalid generation input %# without partial output", (value) => {
    expect(generateWorld(value)).toEqual({ ok: false, error: { schemaVersion: 1, code: "INVALID_INPUT" } });
    expect(WorldGenerationInputSchema.safeParse(value).success).toBe(false);
  });
  it.each(["territory-grid-v2", "unknown", ""])("refuses unsupported generator %j without falling back", (generatorVersion) => {
    expect(generateWorld({ ...input(), generatorVersion })).toEqual({ ok: false,
      error: { schemaVersion: 1, code: "UNSUPPORTED_GENERATOR_VERSION" } });
  });

  it("keeps seeds and authoritative starting state out of the browser-facing barrel", () => {
    for (const key of ["GeneratedWorldSchema", "WorldGenerationInputSchema", "WorldStartingStateSchema", "WorldSeedSchema"]) {
      expect(publicContracts).not.toHaveProperty(key);
    }
  });

  type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
  const copy = (): Mutable<GeneratedWorld> => JSON.parse(JSON.stringify(world()));
  it.each([
    (w: Mutable<GeneratedWorld>) => { w.territories[1]!.territoryId = w.territories[0]!.territoryId; },
    (w: Mutable<GeneratedWorld>) => { w.territories[1]!.row = w.territories[0]!.row; w.territories[1]!.column = w.territories[0]!.column; },
    (w: Mutable<GeneratedWorld>) => { w.territories[0]!.polygon[0].x = w.bounds.width + 1; },
    (w: Mutable<GeneratedWorld>) => { w.territories[0]!.center.x = w.territories[0]!.polygon[0].x; },
    (w: Mutable<GeneratedWorld>) => { w.territories[0]!.polygon[1].x++; },
    (w: Mutable<GeneratedWorld>) => { w.links.pop(); },
    (w: Mutable<GeneratedWorld>) => { w.links[1] = w.links[0]!; },
    (w: Mutable<GeneratedWorld>) => { w.links[0]!.b = "missing"; },
    (w: Mutable<GeneratedWorld>) => { w.links[0]!.b = w.links[0]!.a; },
    (w: Mutable<GeneratedWorld>) => { [w.links[0]!.a, w.links[0]!.b] = [w.links[0]!.b, w.links[0]!.a]; },
    (w: Mutable<GeneratedWorld>) => { w.startingState.starts[1]!.capitalTerritoryId = w.startingState.starts[0]!.capitalTerritoryId; },
    (w: Mutable<GeneratedWorld>) => { w.startingState.starts[0]!.playerId = "outsider"; },
    (w: Mutable<GeneratedWorld>) => { w.startingState.ownership.pop(); },
    (w: Mutable<GeneratedWorld>) => { w.startingState.ownership[0]!.ownerPlayerId = "outsider"; },
    (w: Mutable<GeneratedWorld>) => { w.startingState.cities[0]!.position.x++; },
    (w: Mutable<GeneratedWorld>) => { w.startingState.cities[1]!.cityId = w.startingState.cities[0]!.cityId; },
    (w: Mutable<GeneratedWorld>) => { w.startingState.resourceNodes[0]!.cityId = "missing"; },
    (w: Mutable<GeneratedWorld>) => { w.startingState.resourceNodes[1]!.nodeId = w.startingState.resourceNodes[0]!.nodeId; }
  ])("rejects corrupt world references/geometry/topology %#", (change) => {
    const value = copy(); change(value); expect(GeneratedWorldSchema.safeParse(value).success).toBe(false);
  });

  it("rejects unknown/private/gameplay fields and nonempty starting armies", () => {
    const w = world();
    for (const value of [
      { ...w, accountId: "private" }, { ...w, schemaVersion: 2 }, { ...w, generatorVersion: "unknown" },
      { ...w, territories: [{ ...w.territories[0], terrain: "WATER" }, ...w.territories.slice(1)] },
      { ...w, territories: [{ ...w.territories[0], units: [] }, ...w.territories.slice(1)] },
      { ...w, startingState: { ...w.startingState, units: [{ unitId: "unsupported" }] } },
      { ...w, startingState: { ...w.startingState, treasury: 100 } }
    ]) expect(GeneratedWorldSchema.safeParse(value).success).toBe(false);
    expect(WorldGenerationResultSchema.safeParse({ ok: false, error: { schemaVersion: 1, code: "GENERATION_FAILED" } }).success).toBe(true);
    expect(WorldGenerationResultSchema.safeParse({ ok: false, error: { schemaVersion: 1, code: "GENERATION_FAILED", message: "private details" } }).success).toBe(false);
  });
});
