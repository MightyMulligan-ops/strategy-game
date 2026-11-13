import { z } from "zod";
import { identifier, version } from "./primitives.js";
import { WorldPointSchema } from "./world-geometry.js";

export const ArmyUnitIdSchema = z.string().regex(/^unit:[a-f0-9]{64}$/);
export const FormationIdSchema = z.string().regex(/^formation:[a-f0-9]{64}$/);
const memberFields = { schemaVersion: version, unitId: ArmyUnitIdSchema, originalSpawnNodeId: identifier.max(128) };
export const OwnFormationUnitSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...memberFields, kind: z.literal("INFANTRY") }),
  z.strictObject({ ...memberFields, kind: z.literal("LEADER"), rank: z.literal("LIEUTENANT"), specialization: z.literal("INFANTRY") })
]);
export const OwnFormationSchema = z.strictObject({
  schemaVersion: version, formationId: FormationIdSchema, ownerPlayerId: identifier.max(128),
  position: WorldPointSchema, units: z.array(OwnFormationUnitSchema).length(6)
}).superRefine((formation, ctx) => {
  if (new Set(formation.units.map((u) => u.unitId)).size !== 6 || formation.units.filter((u) => u.kind === "LEADER").length !== 1 ||
      new Set(formation.units.map((u) => u.originalSpawnNodeId)).size !== 1) ctx.addIssue({ code: "custom", message: "Invalid own starting formation" });
}).readonly();
export const ReadFormationsRequestSchema = z.strictObject({ schemaVersion: version, matchId: identifier.max(128) }).readonly();
export const ReadFormationsResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ schemaVersion: version, matchId: identifier.max(128), state: z.literal("READY"), formations: z.array(OwnFormationSchema).length(1) }).readonly(),
  z.strictObject({ schemaVersion: version, matchId: identifier.max(128), state: z.enum(["NOT_STARTED", "UNINITIALIZED", "UNSUPPORTED"]) }).readonly()
]);
export type ReadFormationsResponse = z.infer<typeof ReadFormationsResponseSchema>;
export type OwnFormation = z.infer<typeof OwnFormationSchema>;
