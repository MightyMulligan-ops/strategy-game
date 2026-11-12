// Use the existing engine's built public entry point in cross-package tests;
// pnpm prepare:checks builds it. No new workspace or third-party dependency.
import { applyTurnCommand, createTurn, freezeTurnInput } from "../../../packages/game-engine/dist/index.js";
import { GameSnapshotSchema } from "@strategy-game/shared-types/server";
import type { FrozenTurnInput, GameSnapshot } from "@strategy-game/shared-types/server";
import type { FixtureTurnMatch, FixtureTurnStore, FixtureTurnTransaction } from "../src/turns/service.js";

export type MemoryTurnMatch = Omit<FixtureTurnMatch, "participants"> & {
  snapshot: GameSnapshot | null; frozen: FrozenTurnInput | null; closures: number;
  worldState: "READY" | "UNINITIALIZED";
  participants: { identityId: string; playerId: string; active: boolean; lobbyReady: boolean }[];
};

/** Test-only transactional store. Not durable; no database imports/connections. */
export class MemoryTurns implements FixtureTurnStore {
  matches = new Map<string, MemoryTurnMatch>();
  private tails = new Map<string, Promise<void>>();
  reads = 0;
  writes = 0;
  failCommit = false;

  async withMatch<T>(matchId: string, work: (tx: FixtureTurnTransaction) => T): Promise<T> {
    const previous = this.tails.get(matchId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((done) => { release = done; });
    this.tails.set(matchId, tail);
    await previous;
    try {
      this.reads++;
      const original = this.matches.get(matchId);
      const draft = original ? structuredClone(original) : null;
      let saved = false;
      const value = work({ match: draft, submitCommand: (actor, input, clock) => {
        if (!draft?.state) throw new Error("Missing fixture turn");
        const result = applyTurnCommand(draft.state, actor, input, clock());
        const state = result.state;
        if (draft.state?.turn.status === "open" && state.turn.status === "closed") {
          if (!draft.snapshot) throw new Error("Missing fixture snapshot");
          draft.frozen = freezeTurnInput(state, draft.snapshot); draft.closures++;
        }
        Object.assign(draft, { state }); saved = true;
        return result;
      } });
      if (saved && this.failCommit) throw new Error("private-fixture-commit-failure");
      if (saved && draft) { this.matches.set(matchId, draft); this.writes++; }
      return value;
    } finally {
      release();
      if (this.tails.get(matchId) === tail) this.tails.delete(matchId);
    }
  }
}

export function memoryMatch(matchId: string, identities: readonly string[]): MemoryTurnMatch {
  const config = { schemaVersion: 1, gameId: matchId, turnDurationMs: 1_000 };
  const players = identities.map((_, i) => ({ schemaVersion: 1, gameId: matchId, playerId: `local-${i}`, active: true }));
  return {
    status: "RUNNING", state: createTurn(config, players, 1_000), worldState: "READY",
    participants: players.map((p, i) => ({ playerId: p.playerId, identityId: identities[i]!, active: true, lobbyReady: true })),
    snapshot: GameSnapshotSchema.parse({ schemaVersion: 1, snapshotId: `snapshot-${matchId}`, config, players,
      completedTurnNumber: 0, stateVersion: 0, ruleset: { rulesetId: "fixture", version: "1" }, simulationVersion: "empty-turn-v1" }),
    frozen: null, closures: 0
  };
}
