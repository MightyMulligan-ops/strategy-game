import {z} from "zod";
import {identifier,nonnegativeInteger,version} from "./primitives.js";
import {OwnFormationSchema,ReadFormationsResponseSchema} from "./formations-view.js";
const coordinate=z.number().finite().min(0).max(4900).multipleOf(0.001);
export const ResolvedPointSchema=z.strictObject({x:coordinate,y:coordinate}).readonly();
export const ResolvedOwnFormationSchema=z.strictObject({...OwnFormationSchema.unwrap().shape,position:ResolvedPointSchema})
 .superRefine((f,ctx)=>{if(!OwnFormationSchema.safeParse({...f,position:{x:0,y:0}}).success)ctx.addIssue({code:"custom",message:"Invalid resolved formation"})}).readonly();
export const ReadFormationViewSchema=z.union([ReadFormationsResponseSchema,z.strictObject({schemaVersion:z.literal(2),matchId:identifier.max(128),state:z.literal("READY"),
 collisionRadius:z.literal(10),pendingEncounter:z.boolean(),formations:z.array(ResolvedOwnFormationSchema).length(1)}).readonly()]);
export type ReadFormationView=z.infer<typeof ReadFormationViewSchema>;
const event=z.strictObject({eventId:identifier,sequence:nonnegativeInteger,orderId:identifier.nullable(),moveNumber:nonnegativeInteger,
 type:z.enum(["executed","blocked_encounter","not_executed_after_encounter","initial_contact"]),from:ResolvedPointSchema,to:ResolvedPointSchema,
 traveled:z.number().finite().min(0).max(250),encounterId:identifier.nullable()}).readonly();
const audit=z.strictObject({auditId:identifier,orderId:identifier,moveNumber:nonnegativeInteger.min(1),
 outcome:z.enum(["executed","blocked_encounter","not_executed_after_encounter"]),from:ResolvedPointSchema,to:ResolvedPointSchema,
 traveled:z.number().finite().min(0).max(250),remaining:z.number().finite().min(0).max(250),encounterId:identifier.nullable()}).readonly();
export const ResolutionViewSchema=z.union([
 z.strictObject({schemaVersion:version,matchId:identifier.max(128),state:z.enum(["WAITING","NOT_STARTED","UNSUPPORTED"])}).readonly(),
 z.strictObject({schemaVersion:version,matchId:identifier.max(128),state:z.literal("RESOLVED"),formation:ResolvedOwnFormationSchema,
 summary:z.strictObject({completed:nonnegativeInteger,stopped:nonnegativeInteger,notExecuted:nonnegativeInteger,pendingEncounters:nonnegativeInteger}).readonly(),
 audits:z.array(audit).readonly(),eventOffset:nonnegativeInteger,eventTotal:nonnegativeInteger,nextEventCursor:nonnegativeInteger.nullable(),events:z.array(event).max(256).readonly(),pendingEncounterIds:z.array(identifier).readonly()
 }).superRefine((v,ctx)=>{
  if(v.summary.completed!==v.audits.filter(a=>a.outcome==="executed").length||v.summary.stopped!==v.audits.filter(a=>a.outcome==="blocked_encounter").length||
   v.summary.notExecuted!==v.audits.filter(a=>a.outcome==="not_executed_after_encounter").length||v.summary.pendingEncounters!==v.pendingEncounterIds.length||
   new Set(v.events.map(e=>e.eventId)).size!==v.events.length||v.events.some((e,i)=>e.sequence!==v.eventOffset+i))ctx.addIssue({code:"custom",message:"Inconsistent own movement summary"});
 }).readonly()
]);
export type ResolutionView=z.infer<typeof ResolutionViewSchema>;
