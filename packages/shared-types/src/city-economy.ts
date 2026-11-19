import { z } from "zod";
import { FormationIdSchema, ArmyUnitIdSchema } from "./formations-view.js";
import { identifier, nonnegativeInteger, positiveInteger } from "./primitives.js";
import { WorldPointSchema } from "./world-geometry.js";

export const DEFAULT_STARTING_CREDITS = 2_000;
export const StartingCreditsSchema = nonnegativeInteger.max(1_000_000_000);
export const CITY_BALANCE_V1 = Object.freeze({
  schemaVersion: 1, infantryPrice: 100, lieutenantPrice: 200, cityIncome: 200,
  capitalIncome: 400, capacity: 5, recruitmentTurns: 1
} as const);
export const CityBalanceSchema = z.strictObject({
  schemaVersion: z.literal(1), startingCredits: StartingCreditsSchema,
  infantryPrice: z.literal(CITY_BALANCE_V1.infantryPrice),
  lieutenantPrice: z.literal(CITY_BALANCE_V1.lieutenantPrice),
  cityIncome: z.literal(CITY_BALANCE_V1.cityIncome), capitalIncome: z.literal(CITY_BALANCE_V1.capitalIncome),
  capacity: z.literal(CITY_BALANCE_V1.capacity), recruitmentTurns: z.literal(CITY_BALANCE_V1.recruitmentTurns)
}).readonly();
export type CityBalance = z.infer<typeof CityBalanceSchema>;
export const CityIdSchema = z.enum(["madrid", "andorra-la-vella", "bilbao"]);
export type CityId = z.infer<typeof CityIdSchema>;
export const CityUnitTypeSchema = z.enum(["INFANTRY", "LIEUTENANT"]);
const requestId = z.uuid();
const quantity = positiveInteger.max(CITY_BALANCE_V1.capacity);
export const RecruitmentSchema = z.strictObject({
  recruitmentId: requestId, cityId: CityIdSchema, unitType: CityUnitTypeSchema,
  quantity, paid: positiveInteger, arrivalTurn: positiveInteger
}).readonly();
export type Recruitment = z.infer<typeof RecruitmentSchema>;
export const DispatchSchema = z.strictObject({
  dispatchId: requestId, cityId: CityIdSchema, unitIds: z.array(ArmyUnitIdSchema).min(1).max(2048)
    .refine(ids => new Set(ids).size === ids.length).readonly(),
  destination: WorldPointSchema
}).readonly();
export type Dispatch = z.infer<typeof DispatchSchema>;
export const CityPlanSchema = z.strictObject({
  credits: nonnegativeInteger, recruitment: z.array(RecruitmentSchema).max(15).readonly(),
  dispatches: z.array(DispatchSchema).max(80).readonly(),
  commanders: z.array(z.strictObject({ cityId: CityIdSchema, unitId: ArmyUnitIdSchema }).readonly()).max(3).readonly()
}).readonly();
export type CityPlan = z.infer<typeof CityPlanSchema>;
export const CityReportEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("completed"), order: RecruitmentSchema }),
  z.strictObject({ kind: z.literal("canceled"), reason: z.enum(["manual", "capture"]), order: RecruitmentSchema, refund: positiveInteger }),
  z.strictObject({ kind: z.literal("income"), cityId: CityIdSchema, amount: positiveInteger })
]).readonly();
export type CityReportEntry = z.infer<typeof CityReportEntrySchema>;

export const CityProjectionSchema = z.strictObject({
  cityId: CityIdSchema, name: identifier, capital: z.boolean(), position: WorldPointSchema,
  owned: z.boolean(), neutral: z.boolean(), garrisonId: FormationIdSchema.nullable(), commanderId: ArmyUnitIdSchema.nullable()
}).readonly();

export type CityProjection = z.infer<typeof CityProjectionSchema>;

export const CityEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("recruit"), cityId: CityIdSchema, recruitmentId: requestId, unitType: CityUnitTypeSchema, quantity }),
  z.strictObject({ kind: z.literal("cancel_recruitment"), recruitmentId: requestId }),
  z.strictObject({ kind: z.literal("choose_commander"), cityId: CityIdSchema, unitId: ArmyUnitIdSchema }),
  z.strictObject({ kind: z.literal("dispatch"), dispatch: DispatchSchema }),
  z.strictObject({ kind: z.literal("cancel_dispatch"), dispatchId: requestId })
]).readonly();
export type CityEdit = z.infer<typeof CityEditSchema>;
