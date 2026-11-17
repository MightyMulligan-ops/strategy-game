import {z} from "zod";
import {identifier,nonnegativeInteger} from "./primitives.js";
import {OwnFormationUnitSchema,FormationIdSchema} from "./formations-view.js";
const ResolvedPointSchema=z.strictObject({x:z.number().finite().min(0).max(4900),y:z.number().finite().min(0).max(4200)}).readonly();
export const CombatOwnFormationSchema=z.strictObject({schemaVersion:z.literal(1),formationId:FormationIdSchema,ownerPlayerId:identifier,
 position:ResolvedPointSchema,units:z.array(z.union([
  OwnFormationUnitSchema.options[0].extend({hp:nonnegativeInteger.min(1),maxHp:nonnegativeInteger.min(1)}),
  OwnFormationUnitSchema.options[1].extend({hp:nonnegativeInteger.min(1),maxHp:nonnegativeInteger.min(1)})
 ])).min(1).max(240).readonly()}).readonly();
export const CombatFormationViewSchema=z.strictObject({schemaVersion:z.literal(3),matchId:identifier,state:z.literal("READY"),
 collisionRadius:z.literal(10),pendingEncounter:z.literal(false),formations:z.array(CombatOwnFormationSchema).max(80).readonly()}).readonly();
export const CombatAftermathSchema=z.strictObject({schemaVersion:z.literal(2),matchId:identifier,state:z.literal("RESOLVED"),
 formations:z.array(CombatOwnFormationSchema).max(80).readonly(),
 battles:z.array(z.strictObject({outcome:z.enum(["victory","defeat","mutual_destruction"]),
  ownFormationIds:z.array(FormationIdSchema).max(80).readonly(),lostUnitIds:z.array(identifier).max(240).readonly(),
  survivingUnitIds:z.array(identifier).max(240).readonly(),position:ResolvedPointSchema,
  ownership:z.strictObject({locationId:identifier,recipient:z.enum(["own","ally","opponent","unchanged"])}).nullable()
 }).readonly()).max(40).readonly()}).readonly();
export type CombatAftermath=z.infer<typeof CombatAftermathSchema>;

export const CombatAftermathViewSchema=z.union([CombatAftermathSchema,z.strictObject({schemaVersion:z.literal(1),matchId:identifier,state:z.enum(["WAITING","NOT_STARTED","UNSUPPORTED"])}).readonly()]);
