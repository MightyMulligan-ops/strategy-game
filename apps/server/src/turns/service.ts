import { ReadTurnRequestSchema, ReadTurnResponseSchema, SetTurnReadyRequestSchema, SetTurnReadyResponseSchema, TurnReadyPathSchema } from "@strategy-game/shared-types";
import type { ReadTurnResponse, SetTurnReadyResponse, TurnErrorResponse } from "@strategy-game/shared-types";
import type { MatchRepository } from "@strategy-game/database";
type TurnState = Awaited<ReturnType<MatchRepository["loadTurn"]>>["state"];
type CommandResult = Awaited<ReturnType<MatchRepository["submitCommand"]>>;

export class TurnApiError extends Error {
  constructor(readonly code: TurnErrorResponse["error"]) { super(code); }
}

// Server-private fixture port. No production persistence adapter is provided.
export type FixtureTurnMatch = Readonly<{
  status: "OPEN" | "RUNNING";
  participants: readonly Readonly<{ identityId: string; playerId: string; active: boolean }>[];
  state: TurnState | null;
}>;
export type FixtureTurnTransaction = {
  match: FixtureTurnMatch | null;
  submitCommand: (actor: string, input: unknown, clock: () => number) => CommandResult;
};
export interface FixtureTurnStore {
  // Serialize reads/writes per match, authorize inside this boundary and commit
  // saved lifecycle/frozen input together before resolving. Throwing rolls back.
  withMatch<T>(matchId: string, work: (transaction: FixtureTurnTransaction) => T): Promise<T>;
}

function member(match: FixtureTurnMatch | null, identityId: string) {
  const participant = match?.participants.find((p) => p.identityId === identityId && p.active);
  if (!match || !participant) throw new TurnApiError("NOT_FOUND");
  return { match, playerId: participant.playerId };
}

function project(matchId: string, state: TurnState, playerId: string): SetTurnReadyResponse {
  const draft = state.drafts.find((p) => p.playerId === playerId);
  if (!draft || !state.players.some((p) => p.playerId === playerId && p.active)) throw new TurnApiError("NOT_FOUND");
  if (state.config.gameId !== matchId) throw new TurnApiError("INTERNAL_ERROR");
  return SetTurnReadyResponseSchema.parse({
    schemaVersion: 1, matchId, state: "READY", turn: state.turn,
    own: { schemaVersion: 1, gameId: matchId, turnNumber: state.turn.turnNumber,
      revision: draft.revision, ready: draft.ready, orders: draft.orders }
  });
}

/** Fixture-backed application boundary; never construct this from normal startup. */
export class FixtureTurnService {
  constructor(private readonly store: FixtureTurnStore, private readonly clock: () => number) {}

  async read(matchId: string, identityId: string): Promise<ReadTurnResponse> {
    ReadTurnRequestSchema.parse({ schemaVersion: 1, matchId });
    return this.store.withMatch(matchId, ({ match: stored }) => {
      const { match, playerId } = member(stored, identityId);
      if (match.status === "OPEN" || !match.state) return ReadTurnResponseSchema.parse({
        schemaVersion: 1, matchId, state: match.status === "OPEN" ? "NOT_STARTED" : "UNINITIALIZED"
      });
      return project(matchId, match.state, playerId);
    });
  }

  async ready(matchId: string, turnNumber: number, identityId: string, input: unknown): Promise<SetTurnReadyResponse> {
    const path = TurnReadyPathSchema.safeParse({ matchId, turnNumber });
    const body = SetTurnReadyRequestSchema.safeParse(input);
    if (!path.success || !body.success) throw new TurnApiError("INVALID_REQUEST");
    const outcome = await this.store.withMatch(matchId, ({ match: stored, submitCommand }) => {
      const { match, playerId } = member(stored, identityId);
      if (match.status !== "RUNNING" || !match.state) throw new TurnApiError("TURN_UNINITIALIZED");
      // Check the actor's turn membership before observing time or writing.
      project(matchId, match.state, playerId);
      const result = submitCommand(playerId, {
        ...body.data, gameId: matchId, turnNumber, kind: "set_ready"
      }, this.clock);
      // A rejected late/stale command may still close the turn. Return its error
      // after the transaction completes, so that closure is not rolled back.
      if (result.accepted) return { view: project(matchId, result.state, playerId) };
      const errors = { invalid_command: "INVALID_REQUEST", turn_closed: "TURN_CLOSED", wrong_turn: "WRONG_TURN",
        inactive_player: "NOT_FOUND", stale_revision: "STALE_REVISION", order_not_found: "INVALID_REQUEST", revision_exhausted: "REVISION_EXHAUSTED" } as const;
      return { error: errors[result.reason] };
    });
    if (outcome.error) throw new TurnApiError(outcome.error);
    return outcome.view!;
  }
}
