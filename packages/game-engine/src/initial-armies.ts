import { GameConfigSchema } from "@strategy-game/shared-types";
import { InitialArmiesSnapshotSchema, InitialArmiesRuntimeProfileSchema, INITIAL_ARMIES_RUNTIME_PROFILE,
  INITIAL_ARMIES_POLICY, InitialWorldArchiveSchema, InitialWorldRosterSchema } from "@strategy-game/shared-types/server";
import type { ArmyUnit } from "@strategy-game/shared-types/server";
import { auditHash, canonicalJson, compareIds } from "./determinism.js";
import { createInitialWorldReference } from "./turn-initialization.js";
import { createTurn } from "./turn.js";

export class InitialArmiesError extends Error {
  readonly code = "invalid_initial_armies";
  constructor() { super("Invalid initial armies or archive binding"); }
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function plan(configInput: unknown, rosterInput: unknown, archiveInput: unknown, runtimeInput: unknown) {
  const config = GameConfigSchema.parse(configInput);
  const players = [...InitialWorldRosterSchema.parse(rosterInput)].sort((a, b) => compareIds(a.playerId, b.playerId));
  const archive = InitialWorldArchiveSchema.parse(archiveInput);
  const runtimeProfile = InitialArmiesRuntimeProfileSchema.parse(runtimeInput);
  if (archive.matchId !== config.gameId || players.some((p) => p.gameId !== config.gameId) ||
      canonicalJson(players.map((p) => p.playerId)) !== canonicalJson([...archive.payload.players].sort(compareIds))) throw new InitialArmiesError();
  const worldRef = createInitialWorldReference(archive);
  const units: ArmyUnit[] = [];
  const formations = players.map(({ playerId }) => {
    const city = archive.payload.startingState.cities.find((c) => c.ownerPlayerId === playerId)!;
    const node = archive.payload.startingState.resourceNodes.find((n) => n.ownerPlayerId === playerId)!;
    const identity = { version: "initial-armies-v1", matchId: config.gameId, playerId, worldRef, sourceNodeId: node.nodeId };
    const members = Array.from({ length: 6 }, (_, index): ArmyUnit => ({ schemaVersion: 1,
      unitId: `unit:${auditHash({ ...identity, slot: index === 0 ? "lieutenant" : `infantry-${index}` })}`,
      ownerPlayerId: playerId, originalSpawnNodeId: node.nodeId,
      ...(index === 0 ? { kind: "LEADER", rank: "LIEUTENANT", specialization: "INFANTRY" } : { kind: "INFANTRY" }) }));
    members.sort((a, b) => compareIds(a.unitId, b.unitId)); units.push(...members);
    return { schemaVersion: 1 as const, formationId: `formation:${auditHash({ ...identity, slot: "capital-formation" })}`,
      ownerPlayerId: playerId, unitIds: members.map((u) => u.unitId), position: { ...city.position } };
  });
  const metadata = { schemaVersion: 3 as const, kind: "initial_armies" as const, ruleset: runtimeProfile.ruleset,
    simulationVersion: runtimeProfile.simulationVersion, config, players, completedTurnNumber: 0 as const, stateVersion: 0 as const,
    worldRef, policy: INITIAL_ARMIES_POLICY, units, formations };
  const snapshot = InitialArmiesSnapshotSchema.parse({ ...metadata, snapshotId: `initial-armies:${auditHash({ snapshot: metadata, runtimeProfile })}` });
  return freeze({ snapshot, runtimeProfile });
}
/** Validates and derives the complete immutable army plan before sampling a start clock. */
export function planInitialArmies(config: unknown, players: unknown, archive: unknown,
  runtime: unknown = INITIAL_ARMIES_RUNTIME_PROFILE) {
  try { return plan(config, players, archive, runtime); } catch { throw new InitialArmiesError(); }
}
/** Pure initialization only. No storage, time/RNG reads or archived-world mutation. */
export function initializeArmiesTurnOne(config: unknown, players: unknown, archive: unknown, openedAtMs: number,
  runtime: unknown = INITIAL_ARMIES_RUNTIME_PROFILE) {
  try {
    const result = plan(config, players, archive, runtime);
    return freeze({ ...result, state: createTurn(result.snapshot.config, result.snapshot.players, openedAtMs) });
  } catch { throw new InitialArmiesError(); }
}
/** Replays actual persisted contents; never returns a repaired/replacement snapshot. */
export function validateInitialArmiesSnapshot(input: unknown, archive: unknown, runtime: unknown = INITIAL_ARMIES_RUNTIME_PROFILE) {
  try {
    const snapshot = InitialArmiesSnapshotSchema.parse(input);
    const expected = plan(snapshot.config, snapshot.players, archive, runtime).snapshot;
    if (canonicalJson(snapshot) !== canonicalJson(expected)) throw new InitialArmiesError();
    return freeze(snapshot);
  } catch { throw new InitialArmiesError(); }
}
