// Authoritative contracts for server code and tests only. Never broadcast these
// records or import this entry point into the browser; use filtered DTOs instead.
import { z } from "zod";
import { GameConfigSchema, GamePlayerSchema, ReadyChangeSchema, OrderListSchema, TurnRecordSchema } from "./index.js";
import { identifier, nonnegativeInteger, positiveInteger, version } from "./primitives.js";
import { GeneratedWorldSchema } from "./world.js";
import { MovementDraftOrdersSchema, MovementDraftCommandSchema } from "./movement-drafts.js";
import { ArmyUnitIdSchema, FormationIdSchema } from "./formations-view.js";
import { WorldPointSchema } from "./world-geometry.js";
export {
  WORLD_GENERATOR_VERSION, WORLD_MAX_TERRITORIES, WorldSeedSchema, WorldGenerationSettingsSchema,
  WorldGenerationInputSchema, WorldPointSchema, WorldTerrainSchema, WorldTerritorySchema,
  WorldStartingStateSchema, GeneratedWorldSchema, WorldGenerationErrorSchema, WorldGenerationResultSchema
} from "./world.js";
export type {
  WorldGenerationInput, WorldTerritory, WorldStartingState, GeneratedWorld, WorldGenerationError, WorldGenerationResult
} from "./world.js";

export const SeedSchema = nonnegativeInteger.max(0xffff_ffff);
export const RulesetReferenceSchema = z.strictObject({
  rulesetId: identifier,
  version: identifier
}).readonly();

const metadata = {
  schemaVersion: version,
  ruleset: RulesetReferenceSchema,
  simulationVersion: identifier
};

export const PinnedRulesetSchema = z.strictObject({
  ...metadata,
  movementTieBreakPolicy: identifier
}).readonly();
export type PinnedRuleset = z.infer<typeof PinnedRulesetSchema>;

// This version supports an empty world only. Unknown gameplay fields are
// rejected, never silently dropped when a snapshot advances.
export const GameSnapshotSchema = z.strictObject({
  ...metadata,
  snapshotId: identifier,
  config: GameConfigSchema,
  completedTurnNumber: nonnegativeInteger,
  stateVersion: nonnegativeInteger,
  players: z.array(GamePlayerSchema).min(1).readonly()
}).superRefine((snapshot, context) => {
  if (snapshot.players.some((player) => player.gameId !== snapshot.config.gameId) ||
      new Set(snapshot.players.map((player) => player.playerId)).size !== snapshot.players.length ||
      !snapshot.players.some((player) => player.active)) {
    context.addIssue({ code: "custom", message: "Invalid same-game active roster" });
  }
}).readonly();
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

export const FrozenPlayerOrdersSchema = z.strictObject({
  playerId: identifier,
  revision: nonnegativeInteger,
  orders: OrderListSchema
}).readonly();
export const FrozenPlayerOrderListSchema = z.array(FrozenPlayerOrdersSchema).refine(
  (players) => new Set(players.map((player) => player.playerId)).size === players.length,
  "Each player must have exactly one frozen queue"
).readonly();
export type FrozenPlayerOrders = z.infer<typeof FrozenPlayerOrdersSchema>;

export const FrozenTurnInputSchema = z.strictObject({
  ...metadata,
  startingSnapshotId: identifier,
  turn: TurnRecordSchema.refine((turn) => turn.status === "closed", "Only closed turns may be frozen"),
  playerOrders: FrozenPlayerOrderListSchema
}).readonly();
export type FrozenTurnInput = z.infer<typeof FrozenTurnInputSchema>;

// No successful gameplay result variant exists until execution is implemented.
export const OrderResultSchema = z.strictObject({
  ...metadata,
  orderResultId: identifier,
  resolutionId: identifier,
  playerId: identifier,
  orderId: identifier,
  status: z.literal("rejected"),
  reason: z.literal("unsupported_order")
}).readonly();
export type OrderResult = z.infer<typeof OrderResultSchema>;

export const DomainEventSchema = z.strictObject({
  ...metadata,
  eventId: identifier,
  type: z.literal("turn_resolved"),
  resolutionId: identifier,
  gameId: identifier,
  turnNumber: positiveInteger,
  startingSnapshotId: identifier,
  nextSnapshotId: identifier,
  stateVersion: positiveInteger
}).readonly();
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const TurnResultSchema = z.strictObject({
  ...metadata,
  resolutionId: identifier,
  startingSnapshotId: identifier,
  turnNumber: positiveInteger,
  seed: SeedSchema,
  nextState: GameSnapshotSchema,
  orderResults: z.array(OrderResultSchema).length(0).readonly(),
  domainEvents: z.array(DomainEventSchema).length(1).readonly(),
  phases: z.tuple([
    z.literal("validate_inputs"), z.literal("check_supported_orders"),
    z.literal("advance_empty_state"), z.literal("emit_audit_event")
  ]).readonly()
}).readonly();
export type TurnResult = z.infer<typeof TurnResultSchema>;

export const ResolutionErrorSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.enum(["invalid_input", "version_mismatch", "snapshot_mismatch", "counter_overflow"]),
    message: z.string()
  }),
  z.strictObject({
    code: z.literal("unsupported_orders"),
    message: z.string(),
    orderResults: z.array(OrderResultSchema).min(1).readonly()
  })
]).readonly();
export type ResolutionError = z.infer<typeof ResolutionErrorSchema>;

// Initialization only. This profile does not authorize freezing or resolution.
export const INITIAL_WORLD_SIMULATION_VERSION = "initial-world-v1";
export const InitialWorldRuntimeProfileSchema = z.strictObject({
  schemaVersion: version,
  ruleset: z.strictObject({ rulesetId: z.literal("initial-world"), version: z.literal("1") }).readonly(),
  simulationVersion: z.literal(INITIAL_WORLD_SIMULATION_VERSION),
  movementTieBreakPolicy: z.literal("seeded-shuffle-v1")
}).readonly();
export type InitialWorldRuntimeProfile = z.infer<typeof InitialWorldRuntimeProfileSchema>;
export const INITIAL_WORLD_RUNTIME_PROFILE = InitialWorldRuntimeProfileSchema.parse({
  schemaVersion: 1, ruleset: { rulesetId: "initial-world", version: "1" },
  simulationVersion: INITIAL_WORLD_SIMULATION_VERSION, movementTieBreakPolicy: "seeded-shuffle-v1"
});

// Pure archive envelope, not a Prisma row or a public transport contract.
// Pin this profile to v1 rather than following a future generator default.
const initialWorldGeneratorVersion = z.literal("territory-grid-v1");
export const InitialWorldArchiveSchema = z.strictObject({
  matchId: identifier.max(128), schemaVersion: version,
  generatorVersion: initialWorldGeneratorVersion, payload: GeneratedWorldSchema
}).superRefine((archive, context) => {
  if (archive.schemaVersion !== archive.payload.schemaVersion || archive.generatorVersion !== archive.payload.generatorVersion) {
    context.addIssue({ code: "custom", message: "Archive metadata must match its payload" });
  }
}).readonly();
export type InitialWorldArchive = z.infer<typeof InitialWorldArchiveSchema>;
export const InitialWorldReferenceSchema = z.strictObject({
  matchId: identifier.max(128), archiveSchemaVersion: version,
  generatorVersion: initialWorldGeneratorVersion, digest: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).readonly();
export type InitialWorldReference = z.infer<typeof InitialWorldReferenceSchema>;
export const InitialWorldRosterSchema = z.array(GamePlayerSchema.refine(
  (player) => player.active && player.playerId.length <= 128, "Initial roster must contain active world players"
)).min(2).max(40).refine((players) => new Set(players.map((p) => p.playerId)).size === players.length,
  "Initial player IDs must be unique").readonly();

// A separate v2 contract: never parse/drop its world reference as an empty v1.
export const InitialWorldSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(2), kind: z.literal("initial_world"),
  snapshotId: z.string().regex(/^initial-world:[a-f0-9]{64}$/),
  ruleset: InitialWorldRuntimeProfileSchema.unwrap().shape.ruleset,
  simulationVersion: z.literal(INITIAL_WORLD_SIMULATION_VERSION),
  config: GameConfigSchema, completedTurnNumber: z.literal(0), stateVersion: z.literal(0),
  players: InitialWorldRosterSchema, worldRef: InitialWorldReferenceSchema
}).superRefine((snapshot, context) => {
  if (snapshot.worldRef.matchId !== snapshot.config.gameId || snapshot.players.some((p) => p.gameId !== snapshot.config.gameId) ||
      snapshot.players.some((p, i) => i > 0 && snapshot.players[i - 1]!.playerId >= p.playerId)) {
    context.addIssue({ code: "custom", message: "Initial snapshot needs matching match IDs and a canonical active roster" });
  }
}).readonly();
export type InitialWorldSnapshot = z.infer<typeof InitialWorldSnapshotSchema>;

// Separate initialization-only cohort. Old v1/v2 contracts and archive stay unchanged.
export const INITIAL_ARMIES_RUNTIME_PROFILE = Object.freeze({ schemaVersion: 1 as const,
  ruleset: Object.freeze({ rulesetId: "initial-armies" as const, version: "1" as const }),
  simulationVersion: "initial-armies-v1" as const, movementTieBreakPolicy: "seeded-shuffle-v1" as const });
export const InitialArmiesRuntimeProfileSchema = z.strictObject({ schemaVersion: version,
  ruleset: z.strictObject({ rulesetId: z.literal("initial-armies"), version: z.literal("1") }),
  simulationVersion: z.literal("initial-armies-v1"), movementTieBreakPolicy: z.literal("seeded-shuffle-v1") }).readonly();
export const INITIAL_ARMIES_POLICY = Object.freeze({ schemaVersion: 1 as const, armyVersion: "initial-armies-v1" as const,
  movementVersion: "starting-foot-v1" as const, rangePerTurn: 250 as const, budget: "cumulative" as const, leaderlessRadius: null });
export const InitialArmiesPolicySchema = z.strictObject({ schemaVersion: version, armyVersion: z.literal("initial-armies-v1"),
  movementVersion: z.literal("starting-foot-v1"), rangePerTurn: z.literal(250), budget: z.literal("cumulative"), leaderlessRadius: z.null() }).readonly();
const unitFields = { schemaVersion: version, unitId: ArmyUnitIdSchema, ownerPlayerId: identifier.max(128), originalSpawnNodeId: identifier.max(128) };
export const ArmyUnitSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...unitFields, kind: z.literal("INFANTRY") }),
  z.strictObject({ ...unitFields, kind: z.literal("LEADER"), rank: z.literal("LIEUTENANT"), specialization: z.literal("INFANTRY") })
]).readonly();
export type ArmyUnit = z.infer<typeof ArmyUnitSchema>;
export const InitialFormationSchema = z.strictObject({ schemaVersion: version, formationId: FormationIdSchema,
  ownerPlayerId: identifier.max(128), unitIds: z.array(ArmyUnitIdSchema).length(6).readonly(), position: WorldPointSchema }).readonly();
export type InitialFormation = z.infer<typeof InitialFormationSchema>;
export const InitialArmiesSnapshotSchema = z.strictObject({ schemaVersion: z.literal(3), kind: z.literal("initial_armies"),
  snapshotId: z.string().regex(/^initial-armies:[a-f0-9]{64}$/), ruleset: InitialArmiesRuntimeProfileSchema.unwrap().shape.ruleset,
  simulationVersion: z.literal("initial-armies-v1"), config: GameConfigSchema,
  completedTurnNumber: z.literal(0), stateVersion: z.literal(0), players: InitialWorldRosterSchema,
  worldRef: InitialWorldReferenceSchema, policy: InitialArmiesPolicySchema,
  units: z.array(ArmyUnitSchema).min(12).max(240).readonly(), formations: z.array(InitialFormationSchema).min(2).max(40).readonly()
}).superRefine((snapshot, ctx) => {
  const owners = snapshot.players.map((p) => p.playerId);
  const units = new Map(snapshot.units.map((u) => [u.unitId, u]));
  const memberships = snapshot.formations.flatMap((f) => f.unitIds);
  if (snapshot.worldRef.matchId !== snapshot.config.gameId || snapshot.players.some((p, i) => p.gameId !== snapshot.config.gameId ||
      (i > 0 && snapshot.players[i - 1]!.playerId >= p.playerId)) || snapshot.units.length !== owners.length * 6 || units.size !== snapshot.units.length ||
      snapshot.formations.length !== owners.length || new Set(snapshot.formations.map((f) => f.formationId)).size !== owners.length ||
      new Set(snapshot.formations.map((f) => f.ownerPlayerId)).size !== owners.length || new Set(memberships).size !== snapshot.units.length ||
      snapshot.formations.some((f) => !owners.includes(f.ownerPlayerId) || f.unitIds.some((id) => units.get(id)?.ownerPlayerId !== f.ownerPlayerId) ||
        f.unitIds.filter((id) => units.get(id)?.kind === "LEADER").length !== 1 ||
        new Set(f.unitIds.map((id) => units.get(id)?.originalSpawnNodeId)).size !== 1)) {
    ctx.addIssue({ code: "custom", message: "Invalid initial army membership/ownership" });
  }
}).readonly();
export type InitialArmiesSnapshot = z.infer<typeof InitialArmiesSnapshotSchema>;

// New cohort and identity, retaining the v3 army composition/reference invariants.
export const MOVEMENT_DRAFT_RUNTIME_PROFILE = Object.freeze({ schemaVersion: 1 as const,
  ruleset: Object.freeze({ rulesetId: "movement-drafts" as const, version: "1" as const }),
  simulationVersion: "movement-drafts-v1" as const, movementTieBreakPolicy: "seeded-shuffle-v1" as const });
export const MovementDraftRuntimeProfileSchema = z.strictObject({ schemaVersion: version,
  ruleset: z.strictObject({ rulesetId: z.literal("movement-drafts"), version: z.literal("1") }).readonly(),
  simulationVersion: z.literal("movement-drafts-v1"), movementTieBreakPolicy: z.literal("seeded-shuffle-v1") }).readonly();
export const MovementDraftSnapshotSchema = z.strictObject({
  ...InitialArmiesSnapshotSchema.unwrap().shape,
  schemaVersion: z.literal(4), kind: z.literal("movement_drafts"), snapshotId: z.string().regex(/^movement-drafts:[a-f0-9]{64}$/),
  ruleset: MovementDraftRuntimeProfileSchema.unwrap().shape.ruleset, simulationVersion: z.literal("movement-drafts-v1"),
  initialArmiesSnapshotId: z.string().regex(/^initial-armies:[a-f0-9]{64}$/)
}).superRefine((snapshot, ctx) => {
  const { initialArmiesSnapshotId, ...army } = snapshot;
  // Reuse v3 composition/reference validation without accepting a v3 stored payload.
  if (!InitialArmiesSnapshotSchema.safeParse({ ...army, schemaVersion: 3, kind: "initial_armies",
    snapshotId: initialArmiesSnapshotId, ruleset: INITIAL_ARMIES_RUNTIME_PROFILE.ruleset, simulationVersion: "initial-armies-v1" }).success) {
    ctx.addIssue({ code: "custom", message: "Invalid v4 initial army structure" });
  }
}).readonly();
export type MovementDraftSnapshot = z.infer<typeof MovementDraftSnapshotSchema>;

// Server-only validation for pure helpers, not executable command contracts.
export const MovementLeadershipInputSchema = z.array(z.discriminatedUnion("kind", [
  z.strictObject({ unitId: identifier.max(128), kind: z.literal("INFANTRY") }),
  z.strictObject({ unitId: identifier.max(128), kind: z.literal("LEADER"), rank: z.enum(["GENERAL", "COLONEL", "CAPTAIN", "LIEUTENANT"]) })
])).min(1).max(240);
export const StartingFootMovementInputSchema = z.strictObject({
  ownerPlayerId: identifier.max(128), from: WorldPointSchema, destinations: z.array(WorldPointSchema).min(1),
  bounds: z.strictObject({ width: z.number().int().positive().max(4900), height: z.number().int().positive().max(4200) }),
  members: z.array(ArmyUnitSchema).min(1).max(6)
});
export const EncounterInputSchema = z.strictObject({
  destination: WorldPointSchema, destinationCityId: identifier.max(128).optional(),
  occupant: z.strictObject({ position: WorldPointSchema, cityId: identifier.max(128).optional() }).nullable(),
  relationship: z.enum(["friendly", "hostile", "unknown"]),
  situation: z.enum(["occupied_destination", "converging_destinations", "crossing_paths", "vacating_position"])
});

// Separate v5 closure cohort; v1-v4 parsing and identities remain unchanged.
export const TURN_CLOSURE_RUNTIME_PROFILE = Object.freeze({ schemaVersion: 1 as const,
  ruleset: Object.freeze({ rulesetId: "turn-closure" as const, version: "1" as const }),
  simulationVersion: "turn-closure-v1" as const, movementTieBreakPolicy: "seeded-shuffle-v1" as const });
export const TurnClosureRuntimeProfileSchema = z.strictObject({ schemaVersion: version,
  ruleset: z.strictObject({ rulesetId: z.literal("turn-closure"), version: z.literal("1") }).readonly(),
  simulationVersion: z.literal("turn-closure-v1"), movementTieBreakPolicy: z.literal("seeded-shuffle-v1") }).readonly();
export const TurnClosureSnapshotSchema = z.strictObject({ ...MovementDraftSnapshotSchema.unwrap().shape,
  schemaVersion: z.literal(5), kind: z.literal("turn_closure"), snapshotId: z.string().regex(/^turn-closure:[a-f0-9]{64}$/),
  ruleset: TurnClosureRuntimeProfileSchema.unwrap().shape.ruleset, simulationVersion: z.literal("turn-closure-v1"),
  movementDraftSnapshotId: z.string().regex(/^movement-drafts:[a-f0-9]{64}$/)
}).superRefine((snapshot, ctx) => {
  const { movementDraftSnapshotId, ...base } = snapshot;
  if (!MovementDraftSnapshotSchema.safeParse({ ...base, schemaVersion: 4, kind: "movement_drafts",
    snapshotId: movementDraftSnapshotId, ruleset: MOVEMENT_DRAFT_RUNTIME_PROFILE.ruleset, simulationVersion: "movement-drafts-v1" }).success) {
    ctx.addIssue({ code: "custom", message: "Invalid v5 initial army structure" });
  }
}).readonly();
export type TurnClosureSnapshot = z.infer<typeof TurnClosureSnapshotSchema>;
export const ClosureFrozenInputSchema = z.strictObject({ schemaVersion: z.literal(2), kind: z.literal("turn_closure"),
  runtimeProfile: TurnClosureRuntimeProfileSchema, startingSnapshotId: z.string().regex(/^turn-closure:[a-f0-9]{64}$/),
  startingStateVersion: z.literal(0), worldRef: InitialWorldReferenceSchema, worldSeed: SeedSchema,
  turn: TurnRecordSchema.refine((t) => t.turnNumber === 1 && t.status === "closed"),
  players: z.array(z.strictObject({ playerId: identifier.max(128), revision: nonnegativeInteger,
    ready: z.boolean(), orders: z.lazy(() => MovementDraftOrdersSchema) }).readonly()).min(2).max(40).readonly()
}).superRefine((input, ctx) => {
  if (input.worldRef.matchId !== input.turn.gameId || input.players.some((p, i) => i > 0 && input.players[i - 1]!.playerId >= p.playerId) ||
    (input.turn.status === "closed" && input.turn.closeReason === "all_ready" && input.players.some((p) => !p.ready))) {
    ctx.addIssue({ code: "custom", message: "Frozen roster/scope/closure mismatch" });
  }
}).readonly();
export type ClosureFrozenInput = z.infer<typeof ClosureFrozenInputSchema>;

export const ClosureCommandSchema = z.union([MovementDraftCommandSchema, ReadyChangeSchema.refine((c) => c.turnNumber === 1)]);

// 006D.4: distinct creation-pinned cohort. No historical schema is widened.
export const MOVEMENT_RESOLUTION_RUNTIME_PROFILE = Object.freeze({ schemaVersion: 1 as const,
  ruleset: Object.freeze({ rulesetId: "movement-resolution" as const, version: "1" as const }),
  simulationVersion: "movement-resolution-v1" as const, movementTieBreakPolicy: "seeded-shuffle-v1" as const });
export const MovementResolutionRuntimeSchema = z.strictObject({ schemaVersion: version,
  ruleset: z.strictObject({rulesetId:z.literal("movement-resolution"),version:z.literal("1")}).readonly(),
  simulationVersion:z.literal("movement-resolution-v1"),movementTieBreakPolicy:z.literal("seeded-shuffle-v1") }).readonly();
export const MOVEMENT_RESOLUTION_POLICY = Object.freeze({ version:"swept-circle-lattice-v1" as const,
  worldUnitsPerMovementPoint:50 as const,radius:10 as const,contactDistance:20 as const,precision:0.001 as const,
  stopping:"strict-before-contact" as const,seedSource:"world-seed-v1" as const });
export const MovementResolutionPolicySchema = z.strictObject({version:z.literal("swept-circle-lattice-v1"),
  worldUnitsPerMovementPoint:z.literal(50),radius:z.literal(10),contactDistance:z.literal(20),precision:z.literal(0.001),
  stopping:z.literal("strict-before-contact"),seedSource:z.literal("world-seed-v1")}).readonly();
export const MovementInitialSnapshotSchema = z.strictObject({...TurnClosureSnapshotSchema.unwrap().shape,
  schemaVersion:z.literal(6),kind:z.literal("movement_resolution"),snapshotId:z.string().regex(/^movement-initial:[a-f0-9]{64}$/),
  ruleset:MovementResolutionRuntimeSchema.unwrap().shape.ruleset,simulationVersion:z.literal("movement-resolution-v1"),
  initialClosureSnapshotId:z.string().regex(/^turn-closure:[a-f0-9]{64}$/),movementPolicy:MovementResolutionPolicySchema
}).superRefine((s,ctx)=>{
  const {initialClosureSnapshotId,movementPolicy,...base}=s;void movementPolicy;
  if(!TurnClosureSnapshotSchema.safeParse({...base,schemaVersion:5,kind:"turn_closure",snapshotId:initialClosureSnapshotId,
    ruleset:TURN_CLOSURE_RUNTIME_PROFILE.ruleset,simulationVersion:"turn-closure-v1"}).success)ctx.addIssue({code:"custom",message:"Invalid v6 initial formation structure"});
}).readonly();
export type MovementInitialSnapshot=z.infer<typeof MovementInitialSnapshotSchema>;
export const MovementFrozenInputSchema=z.strictObject({...ClosureFrozenInputSchema.unwrap().shape,
  schemaVersion:z.literal(3),kind:z.literal("movement_resolution"),runtimeProfile:MovementResolutionRuntimeSchema,
  startingSnapshotId:z.string().regex(/^movement-initial:[a-f0-9]{64}$/),resolutionSeed:SeedSchema
}).superRefine((s,ctx)=>{
 const {resolutionSeed,...base}=s;
 if(resolutionSeed!==s.worldSeed||!ClosureFrozenInputSchema.safeParse({...base,schemaVersion:2,kind:"turn_closure",
 startingSnapshotId:`turn-closure:${"0".repeat(64)}`,runtimeProfile:TURN_CLOSURE_RUNTIME_PROFILE}).success)ctx.addIssue({code:"custom",message:"Invalid frozen v3 scope/seed"});
}).readonly();
export type MovementFrozenInput=z.infer<typeof MovementFrozenInputSchema>;
export const MilliPointSchema=z.strictObject({xMilli:nonnegativeInteger.max(4900000),yMilli:nonnegativeInteger.max(4200000)}).readonly();
const finitePoint=z.strictObject({x:z.number().finite(),y:z.number().finite()}).readonly();
export const MovementAuditSchema=z.strictObject({auditId:identifier,playerId:identifier,formationId:FormationIdSchema,orderId:identifier,
 moveNumber:positiveInteger,sequence:nonnegativeInteger,outcome:z.enum(["executed","blocked_encounter","not_executed_after_encounter"]),
 from:MilliPointSchema,to:MilliPointSchema,plannedDistance:z.number().finite().min(0).max(250),
 traveled:z.number().finite().min(0).max(250),remaining:z.number().finite().min(0).max(250),encounterId:identifier.nullable()}).readonly();
export const EncounterContactSchema=z.strictObject({mover:FormationIdSchema,defender:FormationIdSchema,orderId:identifier.nullable(),
 moveNumber:nonnegativeInteger,sequence:nonnegativeInteger,mathematicalContact:finitePoint,stopped:MilliPointSchema,
 parameter:z.number().finite().min(0).max(1),kind:z.enum(["initial_contact","swept_contact"])}).readonly();
export const PendingEncounterSchema=z.strictObject({encounterId:identifier,resolutionId:identifier,status:z.literal("unresolved"),
 policy:z.literal("swept-circle-lattice-v1"),members:z.array(z.strictObject({formationId:FormationIdSchema,playerId:identifier}).readonly()).min(2).max(40).readonly(),
 contacts:z.array(EncounterContactSchema).min(1).max(780).readonly()}).readonly();
export const ResolvedMovementSnapshotSchema=z.strictObject({...MovementInitialSnapshotSchema.unwrap().shape,
 schemaVersion:z.literal(7),kind:z.literal("movement_resolved"),snapshotId:z.string().regex(/^movement-resolved:[a-f0-9]{64}$/),
 stateVersion:z.literal(1),completedTurnNumber:z.literal(1),initialSnapshotId:z.string().regex(/^movement-initial:[a-f0-9]{64}$/),resolutionId:identifier,
 formations:z.array(z.strictObject({...InitialFormationSchema.unwrap().shape,position:MilliPointSchema}).readonly()).min(2).max(40).readonly()}).readonly();
export const MovementResolutionResultSchema=z.strictObject({schemaVersion:z.literal(2),kind:z.literal("movement_resolution"),
 runtimeProfile:MovementResolutionRuntimeSchema,resolutionId:identifier,startingSnapshotId:identifier,seed:SeedSchema,
 policy:MovementResolutionPolicySchema,nextState:ResolvedMovementSnapshotSchema,
 audits:z.array(MovementAuditSchema).readonly(),encounters:z.array(PendingEncounterSchema).max(20).readonly()}).readonly();
export type MovementResolutionResult=z.infer<typeof MovementResolutionResultSchema>;

// Stage B is a separate creation-pinned cohort; historical schemas above stay strict.
export const COMBAT_TURN_RUNTIME_PROFILE = Object.freeze({ schemaVersion: 1 as const,
 ruleset: Object.freeze({ rulesetId: "combat-turn" as const, version: "1" as const }),
 simulationVersion: "combat-turn-v1" as const, movementTieBreakPolicy: "chronological-speed-v1" as const });
export const CombatTurnRuntimeSchema = z.strictObject({ schemaVersion: version,
 ruleset: z.strictObject({ rulesetId: z.literal("combat-turn"), version: z.literal("1") }).readonly(),
 simulationVersion: z.literal("combat-turn-v1"), movementTieBreakPolicy: z.literal("chronological-speed-v1") }).readonly();
const combatStat = positiveInteger.max(1000000);
const combatStats = z.strictObject({maxHp:combatStat,attack:combatStat,defense:combatStat}).readonly();
export const CombatRelationshipSchema = z.strictObject({from:identifier.max(128),to:identifier.max(128),relation:z.enum(["ally","hostile"])}).readonly();
const combatLeadership = z.array(z.strictObject({specialization:identifier.max(128),unitType:identifier.max(128),
 attack:z.number().int().min(-1000000).max(1000000),defense:z.number().int().min(-1000000).max(1000000)}).readonly()).max(128).readonly();
export const CombatSetupSchema = z.strictObject({
 relationshipPolicy:z.discriminatedUnion("mode",[
  z.strictObject({mode:z.literal("free-for-all-v1")}).readonly(),
  z.strictObject({mode:z.literal("explicit-v1"),relationships:z.array(CombatRelationshipSchema).max(1560).readonly()}).readonly()]),
 infantry:combatStats,lieutenant:combatStats,leadership:combatLeadership
}).readonly();
export type CombatSetup=z.infer<typeof CombatSetupSchema>;
export const FIRST_COMBAT_SETUP:CombatSetup=CombatSetupSchema.parse({relationshipPolicy:{mode:"free-for-all-v1"},
 infantry:{maxHp:7,attack:4,defense:6},lieutenant:{maxHp:1,attack:1,defense:1},
 leadership:[{specialization:"INFANTRY",unitType:"INFANTRY",attack:0,defense:0}]});
export const CombatPolicySchema=z.strictObject({version:z.literal("chronological-speed-v1"),setup:CombatSetupSchema,
 relationships:z.array(CombatRelationshipSchema).max(1560).readonly()}).readonly();
const hpFields={hp:combatStat,maxHp:combatStat,attack:combatStat,defense:combatStat,leadershipEligible:z.boolean()};
export const CombatTurnUnitSchema=z.discriminatedUnion("kind",[
 ArmyUnitSchema.unwrap().options[0].extend(hpFields),ArmyUnitSchema.unwrap().options[1].extend(hpFields)
]).refine(u=>u.hp<=u.maxHp,"HP exceeds maximum").readonly();
export const CombatTurnFormationSchema=z.strictObject({...InitialFormationSchema.unwrap().shape,
 unitIds:z.array(ArmyUnitIdSchema).min(1).max(240).readonly()}).readonly();
const combatBase={ruleset:CombatTurnRuntimeSchema.unwrap().shape.ruleset,simulationVersion:z.literal("combat-turn-v1"),
 config:GameConfigSchema,players:InitialWorldRosterSchema,worldRef:InitialWorldReferenceSchema,policy:InitialArmiesPolicySchema,
 initialArmiesSnapshotId:z.string().regex(/^initial-armies:[a-f0-9]{64}$/),combatPolicy:CombatPolicySchema};
export const CombatInitialSnapshotSchema=z.strictObject({...combatBase,schemaVersion:z.literal(8),kind:z.literal("combat_initial"),
 snapshotId:z.string().regex(/^combat-initial:[a-f0-9]{64}$/),stateVersion:z.literal(0),completedTurnNumber:z.literal(0),
 units:z.array(CombatTurnUnitSchema).min(2).max(240).readonly(),formations:z.array(CombatTurnFormationSchema).min(2).max(80).readonly()}).readonly();
export type CombatInitialSnapshot=z.infer<typeof CombatInitialSnapshotSchema>;
export const CombatFrozenInputSchema=z.strictObject({...ClosureFrozenInputSchema.unwrap().shape,schemaVersion:z.literal(4),kind:z.literal("combat_turn"),
 runtimeProfile:CombatTurnRuntimeSchema,startingSnapshotId:z.string().regex(/^combat-initial:[a-f0-9]{64}$/),resolutionSeed:SeedSchema,
 combatPolicy:CombatPolicySchema}).readonly();
export type CombatFrozenInput=z.infer<typeof CombatFrozenInputSchema>;
export const CombatResolvedSnapshotSchema=z.strictObject({...combatBase,schemaVersion:z.literal(9),kind:z.literal("combat_resolved"),
 snapshotId:z.string().regex(/^combat-resolved:[a-f0-9]{64}$/),stateVersion:z.literal(1),completedTurnNumber:z.literal(1),
 initialSnapshotId:identifier,resolutionId:identifier,units:z.array(CombatTurnUnitSchema).max(240).readonly(),
 formations:z.array(z.strictObject({...CombatTurnFormationSchema.unwrap().shape,position:MilliPointSchema}).readonly()).max(80).readonly(),
 cityOwners:z.array(z.strictObject({cityId:identifier,ownerPlayerId:identifier}).readonly()).max(40).readonly()}).readonly();
export const CombatBattleSchema=z.strictObject({encounterId:identifier,position:MilliPointSchema,locationId:identifier.nullable(),
 formations:z.array(z.strictObject({formationId:FormationIdSchema,stance:z.enum(["moving","stationary"])}).readonly()).min(2).max(80).readonly(),
 outcome:z.enum(["victory","mutual_destruction"]),victoriousPlayerIds:z.array(identifier).max(40).readonly(),recipientPlayerId:identifier.nullable(),
 auditJson:z.string().min(1).max(32*1024*1024)}).readonly();
export const CombatTurnResultSchema=z.strictObject({schemaVersion:z.literal(3),kind:z.literal("combat_turn"),runtimeProfile:CombatTurnRuntimeSchema,
 resolutionId:identifier,startingSnapshotId:identifier,seed:SeedSchema,nextState:CombatResolvedSnapshotSchema,
 battles:z.array(CombatBattleSchema).max(40).readonly(),audits:z.array(MovementAuditSchema).readonly()}).readonly();
export type CombatTurnResult=z.infer<typeof CombatTurnResultSchema>;

// Repeating cohort is separate; none of the historical literal-one schemas change.
export const LOOP_RUNTIME=Object.freeze({schemaVersion:1 as const,ruleset:Object.freeze({rulesetId:'combat-loop' as const,version:'1' as const}),simulationVersion:'combat-loop-v1' as const,movementTieBreakPolicy:'chronological-speed-v1' as const});
export const LoopRuntimeSchema=z.strictObject({schemaVersion:version,ruleset:z.strictObject({rulesetId:z.literal('combat-loop'),version:z.literal('1')}).readonly(),simulationVersion:z.literal('combat-loop-v1'),movementTieBreakPolicy:z.literal('chronological-speed-v1')}).readonly();
const loopCounter=nonnegativeInteger.max(0xfffffffe);
export const LoopStateSchema=z.strictObject({...combatBase,schemaVersion:z.literal(10),kind:z.literal('loop_state'),ruleset:LoopRuntimeSchema.unwrap().shape.ruleset,simulationVersion:z.literal('combat-loop-v1'),
 snapshotId:z.string().regex(/^loop-state:[a-f0-9]{64}$/),stateVersion:loopCounter,completedTurnNumber:loopCounter,predecessorResolutionId:identifier.nullable(),
 units:z.array(CombatTurnUnitSchema).max(240).readonly(),formations:z.array(z.strictObject({...CombatTurnFormationSchema.unwrap().shape,position:MilliPointSchema}).readonly()).max(80).readonly(),
 cityOwners:z.array(z.strictObject({cityId:identifier,ownerPlayerId:identifier}).readonly()).max(40).readonly()
}).refine(s=>s.stateVersion===s.completedTurnNumber).readonly();
export type LoopState=RepeatingState;
export const LoopFrozenSchema=z.strictObject({schemaVersion:z.literal(5),kind:z.literal('loop_frozen'),runtimeProfile:LoopRuntimeSchema,
 startingSnapshotId:identifier,startingStateVersion:loopCounter,worldRef:InitialWorldReferenceSchema,worldSeed:SeedSchema,resolutionSeed:SeedSchema,seedIdentity:identifier,
 combatPolicy:CombatPolicySchema,turn:TurnRecordSchema.refine(t=>t.status==='closed'),players:ClosureFrozenInputSchema.unwrap().shape.players
}).readonly();
export type LoopFrozen=RepeatingFrozen;
export const LoopResultSchema=z.strictObject({schemaVersion:z.literal(4),kind:z.literal('loop_result'),runtimeProfile:LoopRuntimeSchema,
 resolutionId:identifier,startingSnapshotId:identifier,turnNumber:positiveInteger.max(0xfffffffe),seed:SeedSchema,seedIdentity:identifier,nextState:LoopStateSchema,
 battles:CombatTurnResultSchema.unwrap().shape.battles,audits:CombatTurnResultSchema.unwrap().shape.audits}).readonly();
export type LoopResult=RepeatingResult;
export const LoopCommitSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('loop_commit'),result:LoopResultSchema,nextOpenedAtMs:nonnegativeInteger}).readonly();

// Europe is a new creation pin. Historical schemas above remain exact.
export const EUROPE_POLICY=Object.freeze({mapId:'europe-playtest-map-v1',projectionId:'europe-mercator-fixed-v2',maskId:'europe-ne10m-surface-v2',maskSha256:'052b866179d2566fd37b2f22301d48c5e5fcec3f97e6e4bd806dcdc78374bfe6',distanceId:'europe-100-mask-per-game-v1',scenarioId:'iberian-two-camps-v1'} as const);
const europePolicySchema=z.strictObject({mapId:z.literal(EUROPE_POLICY.mapId),projectionId:z.literal(EUROPE_POLICY.projectionId),maskId:z.literal(EUROPE_POLICY.maskId),maskSha256:z.literal(EUROPE_POLICY.maskSha256),distanceId:z.literal(EUROPE_POLICY.distanceId),scenarioId:z.literal(EUROPE_POLICY.scenarioId)}).readonly();
export const EUROPE_RUNTIME=Object.freeze({schemaVersion:2 as const,ruleset:Object.freeze({rulesetId:'europe-playtest' as const,version:'1' as const}),simulationVersion:'europe-playtest-v1' as const,movementTieBreakPolicy:'chronological-speed-v1' as const,europe:EUROPE_POLICY});
export const EuropeRuntimeSchema=z.strictObject({schemaVersion:z.literal(2),ruleset:z.strictObject({rulesetId:z.literal('europe-playtest'),version:z.literal('1')}).readonly(),simulationVersion:z.literal('europe-playtest-v1'),movementTieBreakPolicy:z.literal('chronological-speed-v1'),europe:europePolicySchema}).readonly();
export const EuropeStateSchema=z.strictObject({...LoopStateSchema.unwrap().shape,schemaVersion:z.literal(11),kind:z.literal('europe_loop_state'),ruleset:EuropeRuntimeSchema.unwrap().shape.ruleset,simulationVersion:z.literal('europe-playtest-v1')}).refine(s=>s.stateVersion===s.completedTurnNumber).readonly();
export const EuropeFrozenSchema=LoopFrozenSchema.unwrap().extend({schemaVersion:z.literal(6),kind:z.literal('europe_loop_frozen'),runtimeProfile:EuropeRuntimeSchema}).readonly();
export const EuropeResultSchema=LoopResultSchema.unwrap().extend({schemaVersion:z.literal(5),kind:z.literal('europe_loop_result'),runtimeProfile:EuropeRuntimeSchema,nextState:EuropeStateSchema}).readonly();
export const EuropeCommitSchema=z.strictObject({schemaVersion:z.literal(2),kind:z.literal('europe_loop_commit'),result:EuropeResultSchema,nextOpenedAtMs:nonnegativeInteger}).readonly();
export const RepeatingRuntimeSchema=z.union([LoopRuntimeSchema,EuropeRuntimeSchema]);
export const RepeatingStateSchema=z.union([LoopStateSchema,EuropeStateSchema]);
export const RepeatingFrozenSchema=z.union([LoopFrozenSchema,EuropeFrozenSchema]);
export const RepeatingResultSchema=z.union([LoopResultSchema,EuropeResultSchema]);
export const RepeatingCommitSchema=z.union([LoopCommitSchema,EuropeCommitSchema]);
export type RepeatingState=z.infer<typeof RepeatingStateSchema>;
export type RepeatingFrozen=z.infer<typeof RepeatingFrozenSchema>;
export type RepeatingResult=z.infer<typeof RepeatingResultSchema>;
