import { ReadTurnRequestSchema, ReadTurnResponseSchema, SetTurnReadyRequestSchema, SetTurnReadyResponseSchema, TurnErrorResponseSchema, TurnReadyPathSchema, UsernameSchema } from "@strategy-game/shared-types";
import type { TurnErrorResponse } from "@strategy-game/shared-types";
import type { AuthPersistence } from "@strategy-game/database";
import type { FastifyInstance, FastifyReply } from "fastify";
import { privateResponseHeaders, sameOrigin, sessionPlayer } from "../auth/security.js";
import { TurnApiError } from "./service.js";
import type { FixtureTurnService } from "./service.js";

function failure(reply: FastifyReply, status: number, error: TurnErrorResponse["error"]) {
  privateResponseHeaders(reply);
  return reply.code(status).send(TurnErrorResponseSchema.parse({ schemaVersion: 1, error }));
}

/** Explicit fixture registration only, after normal auth/session/CSRF plugins. */
export async function registerFixtureTurnRoutes(app: FastifyInstance, options: {
  origin: string; accounts: AuthPersistence; service: FixtureTurnService
}) {
  if (process.env.NODE_ENV !== "test") throw new Error("Turn fixtures require NODE_ENV=test");
  await app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof TurnApiError) {
        const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "USERNAME_REQUIRED" ? 403
          : error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_REQUEST" ? 400 : error.code === "INTERNAL_ERROR" ? 500 : 409;
        return failure(reply, status, error.code);
      }
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "FST_CSRF_INVALID_TOKEN" || code === "FST_CSRF_MISSING_SECRET") return failure(reply, 403, "CSRF_REJECTED");
      const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
      if (status === 429) return failure(reply, 429, "RATE_LIMITED");
      if (typeof code === "string" && code.startsWith("FST_ERR_CTP_") && typeof status === "number" && status >= 400 && status < 500) return failure(reply, 400, "INVALID_REQUEST");
      routes.log.error("Turn request failed; check fixture configuration");
      return failure(reply, 500, "INTERNAL_ERROR");
    });
    routes.addHook("onRequest", async (request, reply) => {
      privateResponseHeaders(reply);
      if (request.method === "POST" && !sameOrigin(request, options.origin)) return failure(reply, 403, "INVALID_ORIGIN");
      const user = await sessionPlayer(request, options.accounts);
      if (!user) return failure(reply, 401, "UNAUTHENTICATED");
      if (!UsernameSchema.safeParse(user.username).success) return failure(reply, 403, "USERNAME_REQUIRED");
    });
    routes.get("/api/matches/:matchId/turn", async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const input = ReadTurnRequestSchema.safeParse({ schemaVersion: query.schemaVersion === undefined || query.schemaVersion === "1" ? 1 : query.schemaVersion, ...request.params as object });
      if (!input.success || Object.keys(query).some((key) => key !== "schemaVersion")) return failure(reply, 400, "INVALID_REQUEST");
      return ReadTurnResponseSchema.parse(await options.service.read(input.data.matchId, request.session.playerIdentityId!));
    });
    routes.post("/api/matches/:matchId/turns/:turnNumber/ready", { onRequest: [app.csrfProtection] }, async (request, reply) => {
      const params = request.params as { matchId: string; turnNumber: string };
      const path = TurnReadyPathSchema.safeParse({ matchId: params.matchId, turnNumber: /^[1-9]\d*$/.test(params.turnNumber) ? Number(params.turnNumber) : NaN });
      const body = SetTurnReadyRequestSchema.safeParse(request.body);
      if (!path.success || !body.success || Object.keys(request.query as object).length) return failure(reply, 400, "INVALID_REQUEST");
      return SetTurnReadyResponseSchema.parse(await options.service.ready(path.data.matchId, path.data.turnNumber, request.session.playerIdentityId!, body.data));
    });
  });
}
