// Public-safe geometry primitives only; no seed or authoritative world state.
import { z } from "zod";
import { nonnegativeInteger } from "./primitives.js";
export const WorldPointSchema = z.strictObject({
  x: nonnegativeInteger.max(4_900), y: nonnegativeInteger.max(4_900)
}).readonly();
export const WorldTerrainSchema = z.enum(["PLAINS", "FOREST", "HILLS"]);
