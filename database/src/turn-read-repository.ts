import { GameConfigSchema, ReadTurnRequestSchema, ReadTurnResponseSchema, UsernameSchema } from "@strategy-game/shared-types";
import type { ReadTurnResponse } from "@strategy-game/shared-types";
import type { PrismaClient } from "./generated/prisma/client.js";
import { configurationRuntime, readStoredTurn } from "./turn-storage.js";

type ReadErrorCode = "UNAUTHENTICATED" | "USERNAME_REQUIRED" | "NOT_FOUND" | "INVALID_REQUEST" | "INTERNAL_ERROR";
export class TurnReadError extends Error {
  constructor(readonly code: ReadErrorCode) { super(code); }
}
function invalid(): never { throw new TurnReadError("INTERNAL_ERROR"); }

/** Production Turn 1 reads only. No lifecycle clock, initialization, repair or commands. */
export class TurnReadRepository {
  constructor(private readonly client: PrismaClient) {}
  async getTurn(matchId: string, identityId: string): Promise<ReadTurnResponse> {
    if (!ReadTurnRequestSchema.safeParse({ schemaVersion: 1, matchId }).success) throw new TurnReadError("INVALID_REQUEST");
    try {
      return await this.client.$transaction(async (tx) => {
        // PostgreSQL also enforces the no-write boundary. Must precede every data query.
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const profile = await tx.playerIdentity.findUnique({ where: { id: identityId }, select: { username: true } });
        if (!profile) throw new TurnReadError("UNAUTHENTICATED");
        if (!UsernameSchema.safeParse(profile.username).success) throw new TurnReadError("USERNAME_REQUIRED");
        const member = await tx.matchParticipant.findUnique({ where: { matchId_identityId: { matchId, identityId } }, select: { active: true, playerId: true } });
        if (!member?.active) throw new TurnReadError("NOT_FOUND");
        // Availability and runtime metadata are private too: load them only after authorization.
        const match = await tx.match.findUnique({ where: { id: matchId }, select: {
          id: true, status: true, currentStateVersion: true, configuration: true,
          world: { select: { matchId: true } }, turns: { select: { number: true }, orderBy: { number: "asc" }, take: 2 }
        } });
        if (!match) throw new TurnReadError("NOT_FOUND");
        const configuration = match.configuration;
        if (!configuration) return invalid();
        const config = GameConfigSchema.parse(configuration.config);
        if (match.id !== matchId || configuration.matchId !== matchId || configuration.schemaVersion !== 1 ||
            config.gameId !== matchId || configuration.turnDurationMs !== BigInt(config.turnDurationMs)) return invalid();
        const runtime = configurationRuntime(configuration);
        if (runtime === "empty") return invalid();
        const envelope = { schemaVersion: 1 as const, matchId };
        if (match.status === "OPEN") {
          if (match.world || match.turns.length || match.currentStateVersion !== 0n) return invalid();
          return ReadTurnResponseSchema.parse({ ...envelope, state: "NOT_STARTED" });
        }
        if (match.status !== "RUNNING") return invalid();
        if (runtime === "legacy") {
          if (match.turns.length) return invalid();
          return ReadTurnResponseSchema.parse({ ...envelope, state: "UNINITIALIZED" });
        }
        if (!match.world || match.currentStateVersion !== 0n || match.turns.length !== 1 || match.turns[0]?.number !== 1n) return invalid();
        const aggregate = await readStoredTurn(tx, matchId, 1);
        if (aggregate.kind !== "initial_world" && aggregate.kind !== "initial_armies") return invalid();
        const own = aggregate.state.drafts.find((draft) => draft.playerId === member.playerId);
        if (!own || !aggregate.state.players.some((player) => player.playerId === member.playerId && player.active)) return invalid();
        const turn = aggregate.state.turn;
        // Explicit public allowlist. Never spread the archive, aggregate or private player draft.
        return ReadTurnResponseSchema.parse({ ...envelope, state: "READY",
          turn: { schemaVersion: 1, gameId: matchId, turnNumber: turn.turnNumber, status: turn.status,
            openedAtMs: turn.openedAtMs, deadlineAtMs: turn.deadlineAtMs },
          own: { schemaVersion: 1, gameId: matchId, turnNumber: turn.turnNumber,
            revision: own.revision, ready: own.ready, orders: own.orders }
        });
      }, { isolationLevel: "RepeatableRead" });
    } catch (error) {
      if (error instanceof TurnReadError) throw error;
      return invalid();
    }
  }
}
