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

// Separate strict Europe transport. A stale legacy command cannot enter Europe.
export const EuropeProfileIdentitySchema=z.strictObject({profileId:z.literal('europe-playtest-v1'),mapId:z.literal('europe-playtest-map-v1'),projectionId:z.literal('europe-mercator-fixed-v2'),maskId:z.literal('europe-ne10m-surface-v2'),distanceId:z.literal('europe-100-mask-per-game-v1'),scenarioId:z.literal('iberian-two-camps-v1')});
const europeCommon={schemaVersion:z.literal(2),turnNumber:LoopTurnNumberSchema,expectedRevision:nonnegativeInteger,profile:EuropeProfileIdentitySchema};
export const EuropeCommandSchema=z.discriminatedUnion('kind',[
 z.strictObject({...europeCommon,kind:z.literal('replace_orders'),orders:MovementDraftOrdersSchema}),
 z.strictObject({...europeCommon,kind:z.literal('cancel_order'),orderId:identifier.max(128)}),
 z.strictObject({...europeCommon,kind:z.literal('set_ready'),ready:z.boolean()})
]);
const europePointInScenario=(p:{x:number;y:number})=>p.x>=0&&p.y>=0&&p.x<=1000&&p.y<=500;
export const EuropeCurrentSchema=z.strictObject({...LoopCurrentSchema.shape,schemaVersion:z.literal(2),profile:EuropeProfileIdentitySchema}).superRefine((v,c)=>{if(v.turn.gameId!==v.matchId||!LoopTurnNumberSchema.safeParse(v.turn.turnNumber).success||!['open','closed'].includes(v.turn.status))c.addIssue({code:'custom',message:'Invalid Europe current turn'});if(v.formations.some(f=>!europePointInScenario(f.position))||v.own.orders.some(o=>!europePointInScenario(o.destination)))c.addIssue({code:'custom',message:'Europe projection outside scenario'})});
export const EuropeHistorySchema=z.strictObject({...LoopHistorySchema.shape,schemaVersion:z.literal(2),profile:EuropeProfileIdentitySchema}).superRefine((v,c)=>{if(v.matchId!==v.aftermath.matchId)c.addIssue({code:'custom',message:'Wrong match'});if(v.aftermath.formations.some(f=>!europePointInScenario(f.position))||v.aftermath.battles.some(b=>!europePointInScenario(b.position)))c.addIssue({code:'custom',message:'Europe aftermath outside scenario'})});
export const EuropeFormationGateSchema=z.strictObject({...LoopFormationGateSchema.shape,schemaVersion:z.literal(5),runtime:z.literal('europe-playtest-v1'),profile:EuropeProfileIdentitySchema});
export const RepeatingCommandSchema=z.union([LoopCommandSchema,EuropeCommandSchema]);
export const RepeatingCurrentSchema=z.union([LoopCurrentSchema,EuropeCurrentSchema]);
export const RepeatingHistorySchema=z.union([LoopHistorySchema,EuropeHistorySchema]);
export type RepeatingCommand=z.infer<typeof RepeatingCommandSchema>;
export type RepeatingCurrent=z.infer<typeof RepeatingCurrentSchema>;
