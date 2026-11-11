import { LobbyErrorResponseSchema, ReadWorldRequestSchema, ReadWorldResponseSchema, UsernameSchema } from "@strategy-game/shared-types";
import { WorldError } from "@strategy-game/database";
import type { AuthPersistence, WorldRepository } from "@strategy-game/database";
import type { FastifyInstance } from "fastify";
import { privateResponseHeaders, sessionPlayer } from "../auth/security.js";
export type WorldPersistence = Pick<WorldRepository, "getWorld">;
export async function registerWorldRoutes(app: FastifyInstance, options: { accounts: AuthPersistence; worlds: WorldPersistence }) {
  await app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      privateResponseHeaders(reply);
      const code = error instanceof WorldError ? error.code : "INTERNAL_ERROR";
      const rate = typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429;
      const status = rate ? 429 : code === "UNAUTHENTICATED" ? 401 : code === "USERNAME_REQUIRED" ? 403
        : code === "NOT_FOUND" ? 404 : code === "INVALID_REQUEST" ? 400 : 500;
      if (status === 500) routes.log.error("World request failed; check service availability and stored data");
      return reply.code(status).send(LobbyErrorResponseSchema.parse({ schemaVersion: 1, error: rate ? "RATE_LIMITED" : code }));
    });
    routes.addHook("onRequest", async (request) => {
      const user = await sessionPlayer(request, options.accounts);
      if (!user) throw new WorldError("UNAUTHENTICATED");
      if (!UsernameSchema.safeParse(user.username).success) throw new WorldError("USERNAME_REQUIRED");
    });
    routes.get("/api/matches/:matchId/world", async (request, reply) => {
      privateResponseHeaders(reply);
      const query = request.query as Record<string, unknown>;
      const version = query.schemaVersion === undefined || query.schemaVersion === "1" ? 1 : query.schemaVersion;
      if (Object.keys(query).some((k) => k !== "schemaVersion")) throw new WorldError("INVALID_REQUEST");
      const parsed = ReadWorldRequestSchema.safeParse({ schemaVersion: version, ...request.params as object });
      if (!parsed.success) throw new WorldError("INVALID_REQUEST");
      return ReadWorldResponseSchema.parse(await options.worlds.getWorld(parsed.data.matchId, request.session.playerIdentityId!));
    });
  });
}
