import { MovementDraftErrorSchema, MovementDraftPathSchema, SetTurnReadyRequestSchema, SetTurnReadyResponseSchema, UsernameSchema } from "@strategy-game/shared-types";
import { MovementDraftError } from "@strategy-game/database";
import type { AuthPersistence, TurnClosureRepository } from "@strategy-game/database";
import type { FastifyInstance } from "fastify";
import { privateResponseHeaders, sameOrigin, sessionPlayer } from "../auth/security.js";
export type TurnReadyPersistence = Pick<TurnClosureRepository, "setReady">;
export async function registerTurnReadyRoutes(app: FastifyInstance, options: { origin: string; accounts: AuthPersistence; turns: TurnReadyPersistence }) {
  await app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      privateResponseHeaders(reply);
      const raw = error as { statusCode?: number; code?: string };
      const code = error instanceof MovementDraftError ? error.code : raw.statusCode === 429 ? "RATE_LIMITED"
        : raw.code?.startsWith("FST_CSRF_") ? "CSRF_REJECTED" : raw.code?.startsWith("FST_ERR_CTP_") ? "INVALID_REQUEST" : "INTERNAL_ERROR";
      const status = code === "UNAUTHENTICATED" ? 401 : ["USERNAME_REQUIRED","CSRF_REJECTED","INVALID_ORIGIN"].includes(code) ? 403
        : code === "NOT_FOUND" ? 404 : code === "INVALID_REQUEST" ? 400 : code === "RATE_LIMITED" ? 429 : code === "INTERNAL_ERROR" ? 500 : 409;
      if (status === 500) routes.log.error("Turn readiness failed; inspect service availability and stored data");
      return reply.code(status).send(MovementDraftErrorSchema.parse({ schemaVersion: 1, error: code }));
    });
    routes.addHook("onRequest", async (request, reply) => {
      privateResponseHeaders(reply);
      if (!sameOrigin(request, options.origin)) throw new MovementDraftError("INVALID_ORIGIN");
      const player = await sessionPlayer(request, options.accounts);
      if (!player) throw new MovementDraftError("UNAUTHENTICATED");
      if (!UsernameSchema.safeParse(player.username).success) throw new MovementDraftError("USERNAME_REQUIRED");
    });
    routes.post("/api/matches/:matchId/turns/:turnNumber/ready", { onRequest: [app.csrfProtection] }, async (request) => {
      const params = request.params as { matchId?: unknown; turnNumber?: unknown };
      const n = typeof params.turnNumber === "string" && /^[1-9]\d*$/.test(params.turnNumber) ? Number(params.turnNumber) : NaN;
      const path = MovementDraftPathSchema.safeParse({ ...params, turnNumber: n }), body = SetTurnReadyRequestSchema.safeParse(request.body);
      if (!path.success || !body.success || Object.keys(request.query as object).length) throw new MovementDraftError("INVALID_REQUEST");
      const value = SetTurnReadyResponseSchema.parse(await options.turns.setReady(path.data.matchId, n, request.session.playerIdentityId!, body.data));
      if (value.matchId !== path.data.matchId || value.turn.turnNumber !== n || value.own.revision !== body.data.expectedRevision + 1 || value.own.ready !== body.data.ready) throw new MovementDraftError("INTERNAL_ERROR");
      return value;
    });
  });
}
