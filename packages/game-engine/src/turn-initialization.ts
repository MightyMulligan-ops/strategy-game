import { GameConfigSchema } from "@strategy-game/shared-types";
import {
  INITIAL_WORLD_RUNTIME_PROFILE, InitialWorldArchiveSchema, InitialWorldReferenceSchema, InitialWorldRosterSchema,
  InitialWorldRuntimeProfileSchema, InitialWorldSnapshotSchema
} from "@strategy-game/shared-types/server";
import type { InitialWorldArchive, InitialWorldReference, InitialWorldRuntimeProfile, InitialWorldSnapshot } from "@strategy-game/shared-types/server";
import { auditHash, canonicalJson, compareIds } from "./determinism.js";
import { createTurn } from "./turn.js";
import type { TurnState } from "./turn.js";

export type InitialTurnInitialization = Readonly<{
  runtimeProfile: InitialWorldRuntimeProfile; snapshot: InitialWorldSnapshot; state: TurnState;
}>;

function reference(archive: InitialWorldArchive): InitialWorldReference {
  return InitialWorldReferenceSchema.parse({ matchId: archive.matchId, archiveSchemaVersion: archive.schemaVersion,
    generatorVersion: archive.generatorVersion, digest: `sha256:${auditHash(archive.payload)}` });
}

function snapshotId(snapshot: Omit<InitialWorldSnapshot, "snapshotId">, runtimeProfile: InitialWorldRuntimeProfile): string {
  return `initial-world:${auditHash({ snapshot, runtimeProfile })}`;
}

function checkArchive(snapshot: Omit<InitialWorldSnapshot, "snapshotId">, archive: InitialWorldArchive): void {
  if (snapshot.config.gameId !== archive.matchId ||
      canonicalJson(snapshot.players.map((p) => p.playerId)) !== canonicalJson([...archive.payload.players].sort(compareIds)) ||
      canonicalJson(snapshot.worldRef) !== canonicalJson(reference(archive))) {
    throw new Error("Initial snapshot does not match the world archive, roster or digest");
  }
}

export function createInitialWorldReference(archiveInput: unknown): InitialWorldReference {
  return reference(InitialWorldArchiveSchema.parse(archiveInput));
}

/** Validate both syntax and archive/content binding; a digest-shaped string alone is insufficient. */
export function validateInitialWorldSnapshot(
  snapshotInput: unknown, archiveInput: unknown, runtimeInput: unknown = INITIAL_WORLD_RUNTIME_PROFILE
): InitialWorldSnapshot {
  const snapshot = InitialWorldSnapshotSchema.parse(snapshotInput);
  const archive = InitialWorldArchiveSchema.parse(archiveInput);
  const runtimeProfile = InitialWorldRuntimeProfileSchema.parse(runtimeInput);
  checkArchive(snapshot, archive);
  const { snapshotId: id, ...metadata } = snapshot;
  if (id !== snapshotId(metadata, runtimeProfile)) throw new Error("Initial snapshot identity does not match its contents");
  return snapshot;
}

/** Pure plan only: no clock/RNG reads, persistence, lobby integration or resolution. */
export function initializeTurnOne(
  configInput: unknown, playersInput: unknown, archiveInput: unknown, openedAtMs: number,
  runtimeInput: unknown = INITIAL_WORLD_RUNTIME_PROFILE
): InitialTurnInitialization {
  const config = GameConfigSchema.parse(configInput);
  const players = [...InitialWorldRosterSchema.parse(playersInput)].sort((a, b) => compareIds(a.playerId, b.playerId));
  const archive = InitialWorldArchiveSchema.parse(archiveInput);
  const runtimeProfile = InitialWorldRuntimeProfileSchema.parse(runtimeInput);
  // createTurn validates the trusted opening time and safe fixed-duration deadline.
  const state = createTurn(config, players, openedAtMs);
  const metadata = {
    schemaVersion: 2 as const, kind: "initial_world" as const, ruleset: runtimeProfile.ruleset,
    simulationVersion: runtimeProfile.simulationVersion, config: state.config, players: state.players,
    completedTurnNumber: 0 as const, stateVersion: 0 as const, worldRef: reference(archive)
  };
  checkArchive(metadata, archive);
  const snapshot = InitialWorldSnapshotSchema.parse({ ...metadata, snapshotId: snapshotId(metadata, runtimeProfile) });
  return Object.freeze({ runtimeProfile, snapshot, state });
}
