import { MovementDraftErrorSchema, MovementDraftPathSchema, MovementDraftReadySchema, MovementDraftRequestSchema, ReadMovementDraftSchema, UsernameSchema } from "@strategy-game/shared-types";
import type { MovementDraftErrorCode } from "@strategy-game/shared-types";
import { MovementDraftError } from "@strategy-game/database";
import type { AuthPersistence, MovementDraftRepository } from "@strategy-game/database";
import type { FastifyInstance } from "fastify";
import { privateResponseHeaders, sameOrigin, sessionPlayer } from "../auth/security.js";

export type MovementDraftPersistence = Pick<MovementDraftRepository, "getDraft" | "submitDraft">;
export async function registerMovementDraftRoutes(app: FastifyInstance, options: { origin: string; accounts: AuthPersistence; drafts: MovementDraftPersistence }) {
  await app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      privateResponseHeaders(reply);
      const raw = typeof error === "object" && error !== null ? error as { code?: string; statusCode?: number } : {};
      const code: MovementDraftErrorCode = error instanceof MovementDraftError ? error.code
        : raw.statusCode === 429 ? "RATE_LIMITED" : raw.code === "FST_CSRF_INVALID_TOKEN" || raw.code === "FST_CSRF_MISSING_SECRET" ? "CSRF_REJECTED"
          : raw.code?.startsWith("FST_ERR_CTP_") ? "INVALID_REQUEST" : "INTERNAL_ERROR";
      const status = code === "UNAUTHENTICATED" ? 401 : ["USERNAME_REQUIRED", "INVALID_ORIGIN", "CSRF_REJECTED"].includes(code) ? 403
        : code === "NOT_FOUND" ? 404 : code === "INVALID_REQUEST" ? 400 : code === "INVALID_DRAFT" ? 422 : code === "RATE_LIMITED" ? 429 : code === "INTERNAL_ERROR" ? 500 : 409;
      if (status === 500) routes.log.error("Movement draft request failed; check service availability and stored data");
      return reply.code(status).send(MovementDraftErrorSchema.parse({ schemaVersion: 1, error: code }));
    });
    routes.addHook("onRequest", async (request, reply) => {
      privateResponseHeaders(reply);
      if (request.method === "POST" && !sameOrigin(request, options.origin)) throw new MovementDraftError("INVALID_ORIGIN");
      const profile = await sessionPlayer(request, options.accounts);
      if (!profile) throw new MovementDraftError("UNAUTHENTICATED");
      if (!UsernameSchema.safeParse(profile.username).success) throw new MovementDraftError("USERNAME_REQUIRED");
    });
    const path = (params: unknown) => {
      const p = params as { matchId?: unknown; turnNumber?: unknown };
      const number = typeof p.turnNumber === "string" && /^[1-9]\d*$/.test(p.turnNumber) ? Number(p.turnNumber) : p.turnNumber;
      const parsed = MovementDraftPathSchema.safeParse({ ...p, turnNumber: number });
      if (!parsed.success) throw new MovementDraftError("INVALID_REQUEST");
      return parsed.data;
    };
    const url = "/api/matches/:matchId/turns/:turnNumber/orders";
    routes.get(url, async (request) => {
      const p = path(request.params), query = request.query as Record<string, unknown>;
      if (request.body !== undefined || Object.keys(query).some((k) => k !== "schemaVersion") || (query.schemaVersion !== undefined && query.schemaVersion !== "1")) throw new MovementDraftError("INVALID_REQUEST");
      const result = ReadMovementDraftSchema.parse(await options.drafts.getDraft(p.matchId, p.turnNumber, request.session.playerIdentityId!));
      if (result.matchId !== p.matchId) throw new MovementDraftError("INTERNAL_ERROR");
      return result;
    });
    routes.post(url, { onRequest: [app.csrfProtection] }, async (request) => {
      const p = path(request.params), body = MovementDraftRequestSchema.safeParse(request.body);
      if (!body.success || Object.keys(request.query as object).length) throw new MovementDraftError("INVALID_REQUEST");
      const result = MovementDraftReadySchema.parse(await options.drafts.submitDraft(p.matchId, p.turnNumber, request.session.playerIdentityId!, body.data));
      if (result.matchId !== p.matchId || result.own.turnNumber !== p.turnNumber || result.own.revision !== body.data.expectedRevision + 1) throw new MovementDraftError("INTERNAL_ERROR");
      return result;
    });
  });
}
