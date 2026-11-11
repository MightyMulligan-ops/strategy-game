import { z } from "zod";
import { UsernameSchema } from "./auth.js";
import { identifier, version } from "./primitives.js";
import { WorldPointSchema, WorldTerrainSchema } from "./world-geometry.js";

// Explicit participant-visible DTO. Never extend/spread GeneratedWorld here.
const id = identifier.max(128);
export const ReadWorldRequestSchema = z.strictObject({ schemaVersion: version, matchId: id }).readonly();
export const PublicWorldSchema = z.strictObject({
  visibility: z.literal("INITIAL_SHARED"),
  bounds: z.strictObject({ width: z.number().int().min(1).max(4900), height: z.number().int().min(1).max(4200) }).readonly(),
  grid: z.strictObject({ columns: z.number().int().min(1).max(49), rows: z.number().int().min(1).max(42) }).readonly(),
  players: z.array(z.strictObject({ playerId: id, username: UsernameSchema }).readonly()).min(2).max(40).readonly(),
  territories: z.array(z.strictObject({
    territoryId: id, row: z.number().int().min(0).max(41), column: z.number().int().min(0).max(48),
    polygon: z.tuple([WorldPointSchema, WorldPointSchema, WorldPointSchema, WorldPointSchema]).readonly(),
    center: WorldPointSchema, terrain: WorldTerrainSchema, ownerPlayerId: id.nullable(), capital: z.boolean(),
    city: z.strictObject({ cityId: id, kind: z.literal("CAPITAL") }).readonly().nullable(),
    resources: z.array(z.strictObject({ nodeId: id, kind: z.literal("MILITARY_SUPPLIES"), stockpile: z.literal(0) }).readonly()).max(1).readonly()
  }).readonly()).min(1).max(2058).readonly(),
  links: z.array(z.strictObject({ a: id, b: id }).readonly()).min(1).max(4025).readonly()
}).superRefine((world, ctx) => {
  const players = new Set(world.players.map((p) => p.playerId));
  const territories = new Set(world.territories.map((t) => t.territoryId));
  if (players.size !== world.players.length || territories.size !== world.territories.length ||
      world.territories.length !== world.grid.columns * world.grid.rows ||
      world.territories.some((t) => t.ownerPlayerId !== null && !players.has(t.ownerPlayerId)) ||
      world.links.some((e) => !territories.has(e.a) || !territories.has(e.b) || e.a >= e.b)) {
    ctx.addIssue({ code: "custom", message: "Invalid public world references" });
  }
}).readonly();
export type PublicWorld = z.infer<typeof PublicWorldSchema>;
export const ReadWorldResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ schemaVersion: version, matchId: id, state: z.literal("READY"), world: PublicWorldSchema }).readonly(),
  z.strictObject({ schemaVersion: version, matchId: id, state: z.enum(["NOT_STARTED", "UNINITIALIZED"]) }).readonly()
]);
export type ReadWorldResponse = z.infer<typeof ReadWorldResponseSchema>;
