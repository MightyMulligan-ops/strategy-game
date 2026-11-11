import {
  GeneratedWorldSchema, WORLD_GENERATOR_VERSION, WorldGenerationErrorSchema, WorldGenerationInputSchema
} from "@strategy-game/shared-types/server";
import type {
  GeneratedWorld, WorldGenerationError, WorldGenerationInput, WorldGenerationResult, WorldTerritory
} from "@strategy-game/shared-types/server";
import { compareIds } from "./determinism.js";

// Algorithm and consumption order are pinned by territory-grid-v1. This stream
// is deterministic, not secret or suitable for authentication/security tokens.
function randomStream(seed: number) {
  let state = seed;
  return (span: number) => {
    const limit = Math.floor(0x1_0000_0000 / span) * span;
    do { state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0; } while (state >= limit);
    return state % span;
  };
}

function axisLines(regions: number, side: number, offsets: readonly number[]): number[] {
  return Array.from({ length: regions * side + 1 }, (_, index) => index * 100 + offsets[index % side]!);
}

function generate(input: WorldGenerationInput): GeneratedWorld {
  const players = [...input.players].sort(compareIds);
  const side = input.settings.regionSide;
  const draw = randomStream(input.seed);
  let regionColumns = 1;
  while (regionColumns * regionColumns < players.length) regionColumns++;
  const regionRows = Math.ceil(players.length / regionColumns);
  const columns = regionColumns * side; const rows = regionRows * side;
  // Repeat one seeded local geometry/terrain motif. Every occupied region's
  // capital and immediate neighborhood are congruent; seams stay shared.
  const xOffsets = [0, ...Array.from({ length: side - 1 }, () => draw(41) - 20)];
  const yOffsets = [0, ...Array.from({ length: side - 1 }, () => draw(41) - 20)];
  const terrainKinds = ["PLAINS", "FOREST", "HILLS"] as const;
  const terrain = Array.from({ length: side * side }, () => terrainKinds[draw(3)]!);
  const middle = Math.floor(side / 2);
  terrain[middle * side + middle] = "PLAINS";
  const slots = Array.from({ length: regionColumns * regionRows }, (_, index) => index);
  for (let index = slots.length - 1; index > 0; index--) {
    const selected = draw(index + 1);
    [slots[index], slots[selected]] = [slots[selected]!, slots[index]!];
  }
  const xs = axisLines(regionColumns, side, xOffsets);
  const ys = axisLines(regionRows, side, yOffsets);
  const territoryId = (row: number, column: number) => `t-${row}-${column}`;
  const territories: WorldTerritory[] = [];
  const links: { a: string; b: string }[] = [];
  function addLink(a: string, b: string) { links.push(a < b ? { a, b } : { a: b, b: a }); }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const id = territoryId(row, column);
      const x0 = xs[column]!; const x1 = xs[column + 1]!;
      const y0 = ys[row]!; const y1 = ys[row + 1]!;
      territories.push({ territoryId: id, row, column,
        polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
        center: { x: Math.floor((x0 + x1) / 2), y: Math.floor((y0 + y1) / 2) },
        terrain: terrain[(row % side) * side + column % side]! });
      if (column + 1 < columns) addLink(id, territoryId(row, column + 1));
      if (row + 1 < rows) addLink(id, territoryId(row + 1, column));
    }
  }
  links.sort((a, b) => compareIds(a.a, b.a) || compareIds(a.b, b.b));
  const starts = players.map((playerId, index) => {
    const slot = slots[index]!;
    return { playerId, capitalTerritoryId: territoryId(Math.floor(slot / regionColumns) * side + middle, (slot % regionColumns) * side + middle) };
  });
  const byId = new Map(territories.map((t) => [t.territoryId, t]));
  const capitalOwners = new Map(starts.map((s) => [s.capitalTerritoryId, s.playerId]));
  const cities = starts.map((start, index) => ({ cityId: `city-${index}`, territoryId: start.capitalTerritoryId,
    ownerPlayerId: start.playerId, kind: "CAPITAL" as const, position: byId.get(start.capitalTerritoryId)!.center }));
  return GeneratedWorldSchema.parse({
    schemaVersion: 1, generatorVersion: WORLD_GENERATOR_VERSION, seed: input.seed, players, settings: input.settings,
    bounds: { width: columns * 100, height: rows * 100 }, grid: { columns, rows }, territories, links,
    startingState: {
      starts, ownership: territories.map((t) => ({ territoryId: t.territoryId, ownerPlayerId: capitalOwners.get(t.territoryId) ?? null })),
      cities, resourceNodes: cities.map((c, index) => ({ nodeId: `supply-${index}`, cityId: c.cityId, territoryId: c.territoryId,
        ownerPlayerId: c.ownerPlayerId, kind: "MILITARY_SUPPLIES", position: c.position, stockpile: 0 })), units: []
    }
  });
}

const failure = (code: WorldGenerationError["code"]): WorldGenerationResult => Object.freeze({
  ok: false, error: WorldGenerationErrorSchema.parse({ schemaVersion: 1, code })
});

/** Pure server-side generation. No storage, ambient seed/clock, match mutation,
 * turn initialization or public DTO. Invalid inputs never produce partial data.
 */
export function generateWorld(input: unknown): WorldGenerationResult {
  if (input && typeof input === "object" && "generatorVersion" in input && typeof input.generatorVersion === "string" &&
      input.generatorVersion !== WORLD_GENERATOR_VERSION) return failure("UNSUPPORTED_GENERATOR_VERSION");
  const parsed = WorldGenerationInputSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  try { return Object.freeze({ ok: true, world: generate(parsed.data) }); }
  catch { return failure("GENERATION_FAILED"); }
}
