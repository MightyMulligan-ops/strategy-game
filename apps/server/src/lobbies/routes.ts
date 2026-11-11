import {
  CreateLobbyRequestSchema, CreateLobbyResponseSchema, JoinLobbyRequestSchema, JoinLobbyResponseSchema,
  LeaveLobbyRequestSchema, LeaveLobbyResponseSchema, ListLobbiesRequestSchema, ListLobbiesResponseSchema,
  LobbyErrorResponseSchema, UsernameSchema, ViewLobbyRequestSchema, ViewLobbyResponseSchema
} from "@strategy-game/shared-types";
import type { LobbyErrorResponse } from "@strategy-game/shared-types";
import { LobbyError } from "@strategy-game/database";
import type { AuthPersistence, LobbyRepository } from "@strategy-game/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { privateResponseHeaders, sameOrigin, sessionPlayer } from "../auth/security.js";

export type LobbyPersistence = Pick<LobbyRepository, "createLobby" | "listLobbies" | "getLobby" | "joinLobby" | "leaveLobby">;
type PublicError = LobbyErrorResponse["error"];
const versionOnly = ViewLobbyRequestSchema.unwrap().omit({ lobbyId: true });
const joinBody = JoinLobbyRequestSchema.unwrap().omit({ lobbyId: true });
const leaveBody = LeaveLobbyRequestSchema.unwrap().omit({ lobbyId: true });

function failure(reply: FastifyReply, status: number, error: PublicError) {
  privateResponseHeaders(reply);
  return reply.code(status).send(LobbyErrorResponseSchema.parse({ schemaVersion: 1, error }));
}

function queryWithVersion(request: FastifyRequest): Record<string, unknown> {
  const query = request.query as Record<string, unknown>;
  return { ...query, schemaVersion: query.schemaVersion === undefined || query.schemaVersion === "1" ? 1 : query.schemaVersion };
}

function target(request: FastifyRequest) {
  return ViewLobbyRequestSchema.safeParse({ schemaVersion: 1, ...request.params as Record<string, unknown> });
}

/** Must be registered only after persistent authentication/CSRF plugins. */
export async function registerLobbyRoutes(app: FastifyInstance, options: {
  origin: string; accounts: AuthPersistence; lobbies: LobbyPersistence
}) {
  const { origin, accounts, lobbies } = options;
  await app.register(async (routes) => {
    // Encapsulation keeps existing auth response/status behavior unchanged.
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof LobbyError) {
        switch (error.code) {
          case "UNAUTHENTICATED": return failure(reply, 401, error.code);
          case "USERNAME_REQUIRED": return failure(reply, 403, error.code);
          case "NOT_FOUND": return failure(reply, 404, error.code);
          case "LOBBY_NOT_OPEN": case "LOBBY_FULL": case "HOST_CANNOT_LEAVE": case "NOT_A_PARTICIPANT":
            return failure(reply, 409, error.code);
          case "INVALID_INPUT": return failure(reply, 400, "INVALID_REQUEST");
          case "INVALID_STORAGE": return failure(reply, 500, "INTERNAL_ERROR");
        }
      }
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "FST_CSRF_INVALID_TOKEN" || code === "FST_CSRF_MISSING_SECRET") return failure(reply, 403, "CSRF_REJECTED");
      const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
      if (status === 429) return failure(reply, 429, "RATE_LIMITED");
      if (typeof code === "string" && code.startsWith("FST_ERR_CTP_") && typeof status === "number" && status >= 400 && status < 500) {
        return failure(reply, 400, "INVALID_REQUEST");
      }
      // No raw exception, request, cookies, SQL, or credentials in logs/responses.
      routes.log.error("Lobby request failed; check service availability and stored data");
      return failure(reply, 500, "INTERNAL_ERROR");
    });
    routes.addHook("onRequest", async (request, reply) => {
      privateResponseHeaders(reply);
      if (request.method === "POST" && !sameOrigin(request, origin)) return failure(reply, 403, "INVALID_ORIGIN");
      const user = await sessionPlayer(request, accounts);
      if (!user) return failure(reply, 401, "UNAUTHENTICATED");
      if (!UsernameSchema.safeParse(user.username).success) return failure(reply, 403, "USERNAME_REQUIRED");
    });
    const mutation = { onRequest: [app.csrfProtection] };
    routes.post("/api/lobbies", mutation, async (request, reply) => {
      const input = CreateLobbyRequestSchema.safeParse(request.body);
      if (!input.success || Object.keys(request.query as object).length) return failure(reply, 400, "INVALID_REQUEST");
      const lobby = await lobbies.createLobby(request.session.playerIdentityId!, input.data.settings);
      const response = CreateLobbyResponseSchema.parse({ schemaVersion: 1, lobby });
      return reply.code(201).send(response);
    });
    routes.get("/api/lobbies", async (request, reply) => {
      const input = ListLobbiesRequestSchema.safeParse(queryWithVersion(request));
      if (!input.success) return failure(reply, 400, "INVALID_REQUEST");
      return ListLobbiesResponseSchema.parse({ schemaVersion: 1, lobbies: await lobbies.listLobbies(request.session.playerIdentityId!, input.data) });
    });
    routes.get("/api/lobbies/:lobbyId", async (request, reply) => {
      const path = target(request);
      if (!path.success || !versionOnly.safeParse(queryWithVersion(request)).success) return failure(reply, 400, "INVALID_REQUEST");
      return ViewLobbyResponseSchema.parse({ schemaVersion: 1, lobby: await lobbies.getLobby(path.data.lobbyId, request.session.playerIdentityId!) });
    });
    routes.post("/api/lobbies/:lobbyId/join", mutation, async (request, reply) => {
      const path = target(request);
      const body = joinBody.safeParse(request.body);
      if (!path.success || !body.success || Object.keys(request.query as object).length) return failure(reply, 400, "INVALID_REQUEST");
      const command = JoinLobbyRequestSchema.parse({ ...body.data, lobbyId: path.data.lobbyId });
      return JoinLobbyResponseSchema.parse({ schemaVersion: 1, ...await lobbies.joinLobby(command.lobbyId, request.session.playerIdentityId!) });
    });
    routes.post("/api/lobbies/:lobbyId/leave", mutation, async (request, reply) => {
      const path = target(request);
      const body = leaveBody.safeParse(request.body);
      if (!path.success || !body.success || Object.keys(request.query as object).length) return failure(reply, 400, "INVALID_REQUEST");
      const command = LeaveLobbyRequestSchema.parse({ ...body.data, lobbyId: path.data.lobbyId });
      return LeaveLobbyResponseSchema.parse({ schemaVersion: 1, lobby: await lobbies.leaveLobby(command.lobbyId, request.session.playerIdentityId!) });
    });
  });
}
