import {z} from 'zod';
import {TurnRecordSchema} from './index.js';
import {identifier,nonnegativeInteger,positiveInteger} from './primitives.js';
import {MovementDraftOrdersSchema} from './movement-drafts.js';
import {CombatOwnFormationSchema,CombatAftermathSchema} from './combat-turn-view.js';
export const LoopTurnNumberSchema=positiveInteger.max(0xffffffff);
const common={schemaVersion:z.literal(1),turnNumber:LoopTurnNumberSchema,expectedRevision:nonnegativeInteger};
export const LoopCommandSchema=z.discriminatedUnion('kind',[
 z.strictObject({...common,kind:z.literal('replace_orders'),orders:MovementDraftOrdersSchema}),
 z.strictObject({...common,kind:z.literal('cancel_order'),orderId:identifier.max(128)}),
 z.strictObject({...common,kind:z.literal('set_ready'),ready:z.boolean()})
]);
export type LoopCommand=z.infer<typeof LoopCommandSchema>;
export const LoopCurrentSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('loop_current'),matchId:identifier,
 turn:z.lazy(()=>TurnRecordSchema),own:z.strictObject({revision:nonnegativeInteger,ready:z.boolean(),orders:MovementDraftOrdersSchema}),
 formations:z.array(CombatOwnFormationSchema).max(80),ownedLocationIds:z.array(identifier).max(40)
}).superRefine((v,c)=>{if(v.turn.gameId!==v.matchId||!LoopTurnNumberSchema.safeParse(v.turn.turnNumber).success||!['open','closed'].includes(v.turn.status))c.addIssue({code:'custom',message:'Invalid current loop turn'})});
export type LoopCurrent=z.infer<typeof LoopCurrentSchema>;
export const LoopHistorySchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('loop_aftermath'),matchId:identifier,
 turnNumber:LoopTurnNumberSchema,aftermath:CombatAftermathSchema}).superRefine((v,c)=>{if(v.matchId!==v.aftermath.matchId)c.addIssue({code:'custom',message:'Wrong match'})});
export const LoopFormationGateSchema=z.strictObject({schemaVersion:z.literal(4),runtime:z.literal('combat-loop-v1'),matchId:identifier,state:z.literal('READY'),
 collisionRadius:z.literal(10),pendingEncounter:z.literal(false),turnNumber:LoopTurnNumberSchema,formations:z.array(CombatOwnFormationSchema).max(80)});
