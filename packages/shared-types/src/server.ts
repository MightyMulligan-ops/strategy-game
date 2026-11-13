// Authoritative contracts for server code and tests only. Never broadcast these
// records or import this entry point into the browser; use filtered DTOs instead.
import { z } from "zod";
import { GameConfigSchema, GamePlayerSchema, OrderListSchema, TurnRecordSchema } from "./index.js";
import { identifier, nonnegativeInteger, positiveInteger, version } from "./primitives.js";
import { GeneratedWorldSchema } from "./world.js";
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
