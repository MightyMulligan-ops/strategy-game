// Authoritative contracts for server code and tests only. Never broadcast these
// records or import this entry point into the browser; use filtered DTOs instead.
import { z } from "zod";
import { GameConfigSchema, GamePlayerSchema, OrderListSchema, TurnRecordSchema } from "./index.js";
import { identifier, nonnegativeInteger, positiveInteger, version } from "./primitives.js";
import { GeneratedWorldSchema } from "./world.js";
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
