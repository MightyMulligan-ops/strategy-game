// Authoritative generation data, exported only through ./server. This is not a
// player-visible projection and does not extend empty-turn snapshots.
import { z } from "zod";
import { identifier, nonnegativeInteger, version } from "./primitives.js";

export const WORLD_GENERATOR_VERSION = "territory-grid-v1";
export const WORLD_MAX_TERRITORIES = 2_058; // 42 regions * 7 * 7 cells
const worldId = identifier.max(128);
export const WorldSeedSchema = nonnegativeInteger.max(0xffff_ffff);
export const WorldGenerationSettingsSchema = z.strictObject({
  regionSide: z.union([z.literal(3), z.literal(5), z.literal(7)])
}).readonly();
const roster = z.array(worldId).min(2).max(40).refine(
  (players) => new Set(players).size === players.length, "Player IDs must be unique"
).readonly();
export const WorldGenerationInputSchema = z.strictObject({
  schemaVersion: version, generatorVersion: z.literal(WORLD_GENERATOR_VERSION),
  seed: WorldSeedSchema, players: roster, settings: WorldGenerationSettingsSchema
}).readonly();
export type WorldGenerationInput = z.infer<typeof WorldGenerationInputSchema>;

export const WorldPointSchema = z.strictObject({
  x: nonnegativeInteger.max(4_900), y: nonnegativeInteger.max(4_900)
}).readonly();
export const WorldTerrainSchema = z.enum(["PLAINS", "FOREST", "HILLS"]);
export const WorldTerritorySchema = z.strictObject({
  territoryId: worldId, row: nonnegativeInteger.max(41), column: nonnegativeInteger.max(48),
  // Clockwise in map space (positive y points down); no duplicated closing point.
  polygon: z.tuple([WorldPointSchema, WorldPointSchema, WorldPointSchema, WorldPointSchema]).readonly(),
  center: WorldPointSchema, terrain: WorldTerrainSchema
}).readonly();
export type WorldTerritory = z.infer<typeof WorldTerritorySchema>;
const link = z.strictObject({ a: worldId, b: worldId }).readonly();
const ownership = z.strictObject({ territoryId: worldId, ownerPlayerId: worldId.nullable() }).readonly();
const city = z.strictObject({
  cityId: worldId, territoryId: worldId, ownerPlayerId: worldId,
  kind: z.literal("CAPITAL"), position: WorldPointSchema
}).readonly();
const resource = z.strictObject({
  nodeId: worldId, cityId: worldId, territoryId: worldId, ownerPlayerId: worldId,
  kind: z.literal("MILITARY_SUPPLIES"), position: WorldPointSchema, stockpile: z.literal(0)
}).readonly();
export const WorldStartingStateSchema = z.strictObject({
  starts: z.array(z.strictObject({ playerId: worldId, capitalTerritoryId: worldId }).readonly()).min(2).max(40).readonly(),
  ownership: z.array(ownership).min(1).max(WORLD_MAX_TERRITORIES).readonly(),
  cities: z.array(city).min(2).max(40).readonly(),
  resourceNodes: z.array(resource).min(2).max(40).readonly(),
  // No approved starting armies yet. Never silently accept/drop gameplay state.
  units: z.array(z.never()).length(0).readonly()
}).readonly();
export type WorldStartingState = z.infer<typeof WorldStartingStateSchema>;

const worldBase = z.strictObject({
  schemaVersion: version, generatorVersion: z.literal(WORLD_GENERATOR_VERSION), seed: WorldSeedSchema,
  settings: WorldGenerationSettingsSchema, players: roster,
  bounds: z.strictObject({ width: z.number().int().min(1).max(4_900), height: z.number().int().min(1).max(4_200) }).readonly(),
  grid: z.strictObject({ columns: z.number().int().min(1).max(49), rows: z.number().int().min(1).max(42) }).readonly(),
  territories: z.array(WorldTerritorySchema).min(1).max(WORLD_MAX_TERRITORIES).readonly(),
  links: z.array(link).min(1).max(4_025).readonly(),
  startingState: WorldStartingStateSchema
});
type World = z.infer<typeof worldBase>;
const samePoint = (a: z.infer<typeof WorldPointSchema>, b: z.infer<typeof WorldPointSchema>) => a.x === b.x && a.y === b.y;

function checkGeometry(world: World, context: z.RefinementCtx): void {
  const reject = (message: string) => context.addIssue({ code: "custom", message });
  let regionColumns = 1;
  while (regionColumns * regionColumns < world.players.length) regionColumns++;
  const columns = regionColumns * world.settings.regionSide;
  const rows = Math.ceil(world.players.length / regionColumns) * world.settings.regionSide;
  if (world.grid.columns !== columns || world.grid.rows !== rows || world.bounds.width !== columns * 100 ||
      world.bounds.height !== rows * 100 || world.territories.length !== columns * rows) reject("Invalid grid scaling");
  const byId = new Map(world.territories.map((t) => [t.territoryId, t]));
  const cells = new Set<string>();
  if (byId.size !== world.territories.length) reject("Duplicate territory ID");
  for (const t of world.territories) {
    const [a, b, c, d] = t.polygon;
    const cell = `${t.row}:${t.column}`;
    if (cells.has(cell) || t.row >= rows || t.column >= columns) reject("Invalid/duplicate grid cell");
    cells.add(cell);
    if (a.x >= b.x || a.y >= d.y || a.y !== b.y || b.x !== c.x || c.y !== d.y || d.x !== a.x ||
        b.x > world.bounds.width || d.y > world.bounds.height ||
        t.center.x !== Math.floor((a.x + b.x) / 2) || t.center.y !== Math.floor((a.y + d.y) / 2) ||
        t.center.x <= a.x || t.center.y <= a.y || t.center.x >= b.x || t.center.y >= d.y ||
        (t.column === 0 && a.x !== 0) || (t.row === 0 && a.y !== 0) ||
        (t.column === columns - 1 && b.x !== world.bounds.width) || (t.row === rows - 1 && d.y !== world.bounds.height)) {
      reject("Invalid territory rectangle/bounds/center");
    }
  }
  const edges = new Set<string>();
  for (const edge of world.links) {
    const a = byId.get(edge.a); const b = byId.get(edge.b); const key = JSON.stringify([edge.a, edge.b]);
    if (edge.a >= edge.b || edges.has(key) || !a || !b) { reject("Invalid/duplicate undirected link"); continue; }
    edges.add(key);
    if (Math.abs(a.row - b.row) + Math.abs(a.column - b.column) !== 1) { reject("Link must join side-neighbor cells"); continue; }
    const [left, right] = a.column < b.column ? [a, b] : [b, a];
    const [top, bottom] = a.row < b.row ? [a, b] : [b, a];
    const shared = a.row === b.row
      ? samePoint(left.polygon[1], right.polygon[0]) && samePoint(left.polygon[2], right.polygon[3])
      : samePoint(top.polygon[3], bottom.polygon[0]) && samePoint(top.polygon[2], bottom.polygon[1]);
    if (!shared) reject("Linked territories must share a complete side");
  }
  // Every possible grid edge exactly once implies connectedness, no isolation,
  // and full shared-border coverage (not merely a plausible edge count).
  if (edges.size !== 2 * columns * rows - columns - rows) reject("Missing grid adjacency");
}

function checkStarts(world: World, context: z.RefinementCtx): void {
  const reject = (message: string) => context.addIssue({ code: "custom", message });
  const state = world.startingState;
  const byId = new Map(world.territories.map((t) => [t.territoryId, t]));
  const owners = new Map(state.ownership.map((o) => [o.territoryId, o.ownerPlayerId]));
  const cities = new Map(state.cities.map((c) => [c.ownerPlayerId, c]));
  const nodes = new Map(state.resourceNodes.map((n) => [n.ownerPlayerId, n]));
  const starts = new Map(state.starts.map((s) => [s.playerId, s.capitalTerritoryId]));
  if (state.starts.length !== world.players.length || starts.size !== world.players.length ||
      state.cities.length !== world.players.length || cities.size !== world.players.length ||
      state.resourceNodes.length !== world.players.length || nodes.size !== world.players.length ||
      new Set(state.starts.map((s) => s.capitalTerritoryId)).size !== world.players.length ||
      new Set(state.cities.map((c) => c.cityId)).size !== world.players.length ||
      new Set(state.resourceNodes.map((n) => n.nodeId)).size !== world.players.length) reject("Invalid/duplicate starting records");
  if (state.ownership.length !== world.territories.length || owners.size !== world.territories.length ||
      state.ownership.some((o) => !byId.has(o.territoryId) || (o.ownerPlayerId !== null && starts.get(o.ownerPlayerId) !== o.territoryId))) {
    reject("Ownership must cover all territories; only capitals start owned");
  }
  for (const playerId of world.players) {
    const capitalId = starts.get(playerId); const t = capitalId ? byId.get(capitalId) : undefined;
    const c = cities.get(playerId); const n = nodes.get(playerId);
    if (!t || !c || !n || owners.get(t.territoryId) !== playerId || t.terrain !== "PLAINS" ||
        t.row % world.settings.regionSide !== Math.floor(world.settings.regionSide / 2) ||
        t.column % world.settings.regionSide !== Math.floor(world.settings.regionSide / 2) ||
        c.territoryId !== t.territoryId || n.territoryId !== t.territoryId || n.cityId !== c.cityId ||
        !samePoint(c.position, t.center) || !samePoint(n.position, t.center)) reject("Invalid capital/city/supply fixture");
  }
}

export const GeneratedWorldSchema = worldBase.superRefine((world, context) => {
  checkGeometry(world, context); checkStarts(world, context);
}).readonly();
export type GeneratedWorld = z.infer<typeof GeneratedWorldSchema>;
export const WorldGenerationErrorSchema = z.strictObject({
  schemaVersion: version, code: z.enum(["INVALID_INPUT", "UNSUPPORTED_GENERATOR_VERSION", "GENERATION_FAILED"])
}).readonly();
export type WorldGenerationError = z.infer<typeof WorldGenerationErrorSchema>;
export const WorldGenerationResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), world: GeneratedWorldSchema }).readonly(),
  z.strictObject({ ok: z.literal(false), error: WorldGenerationErrorSchema }).readonly()
]);
export type WorldGenerationResult = z.infer<typeof WorldGenerationResultSchema>;
