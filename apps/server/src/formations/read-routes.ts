import { ReadFormationsRequestSchema, ReadFormationsResponseSchema, TurnErrorResponseSchema, UsernameSchema } from "@strategy-game/shared-types";
import { TurnReadError } from "@strategy-game/database";
import type { AuthPersistence, FormationReadRepository } from "@strategy-game/database";
import type { FastifyInstance } from "fastify";
import { privateResponseHeaders, sessionPlayer } from "../auth/security.js";

export type FormationReadPersistence = Pick<FormationReadRepository, "getFormations">;
export async function registerFormationReadRoutes(app: FastifyInstance, options: { accounts: AuthPersistence; formations: FormationReadPersistence }) {
  await app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      privateResponseHeaders(reply);
      const rate = typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429;
      const code = error instanceof TurnReadError ? error.code : "INTERNAL_ERROR";
      const status = rate ? 429 : code === "UNAUTHENTICATED" ? 401 : code === "USERNAME_REQUIRED" ? 403
        : code === "NOT_FOUND" ? 404 : code === "INVALID_REQUEST" ? 400 : 500;
      if (status === 500) routes.log.error("Formation read failed; check service availability and stored data");
      return reply.code(status).send(TurnErrorResponseSchema.parse({ schemaVersion: 1, error: rate ? "RATE_LIMITED" : code }));
    });
    routes.addHook("onRequest", async (request, reply) => {
      privateResponseHeaders(reply);
      const user = await sessionPlayer(request, options.accounts);
      if (!user) throw new TurnReadError("UNAUTHENTICATED");
      if (!UsernameSchema.safeParse(user.username).success) throw new TurnReadError("USERNAME_REQUIRED");
    });
    routes.get("/api/matches/:matchId/formations", async (request) => {
      const query = request.query as Record<string, unknown>;
      const version = query.schemaVersion === undefined || query.schemaVersion === "1" ? 1 : query.schemaVersion;
      if (request.body !== undefined || Object.keys(query).some((key) => key !== "schemaVersion")) throw new TurnReadError("INVALID_REQUEST");
      const input = ReadFormationsRequestSchema.safeParse({ schemaVersion: version, ...request.params as object });
      if (!input.success) throw new TurnReadError("INVALID_REQUEST");
      const result = ReadFormationsResponseSchema.parse(await options.formations.getFormations(input.data.matchId, request.session.playerIdentityId!));
      if (result.matchId !== input.data.matchId) throw new TurnReadError("INTERNAL_ERROR");
      return result;
    });
  });
}
