import { CombatAftermathViewSchema, ResolutionViewSchema, ReadTurnRequestSchema, ReadTurnResponseSchema, TurnErrorResponseSchema, UsernameSchema } from "@strategy-game/shared-types";
import { TurnReadError } from "@strategy-game/database";
import type { AuthPersistence, TurnReadRepository } from "@strategy-game/database";
import type { FastifyInstance } from "fastify";
import { privateResponseHeaders, sessionPlayer } from "../auth/security.js";

export type TurnReadPersistence = Pick<TurnReadRepository, "getTurn"> & Partial<Pick<TurnReadRepository,"getResolution"|"getAftermath">>;
/** Independent GET-only router; never registers the fixture command service. */
export async function registerTurnReadRoutes(app: FastifyInstance, options: { accounts: AuthPersistence; turns: TurnReadPersistence }) {
  await app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      privateResponseHeaders(reply);
      const code = error instanceof TurnReadError ? error.code : "INTERNAL_ERROR";
      const rate = typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429;
      const status = rate ? 429 : code === "UNAUTHENTICATED" ? 401 : code === "USERNAME_REQUIRED" ? 403
        : code === "NOT_FOUND" ? 404 : code === "INVALID_REQUEST" ? 400 : 500;
      if (status === 500) routes.log.error("Turn read failed; check service availability and stored data");
      return reply.code(status).send(TurnErrorResponseSchema.parse({ schemaVersion: 1, error: rate ? "RATE_LIMITED" : code }));
    });
    routes.addHook("onRequest", async (request, reply) => {
      privateResponseHeaders(reply);
      const user = await sessionPlayer(request, options.accounts);
      if (!user) throw new TurnReadError("UNAUTHENTICATED");
      if (!UsernameSchema.safeParse(user.username).success) throw new TurnReadError("USERNAME_REQUIRED");
    });
    if(options.turns.getAftermath)routes.get("/api/matches/:matchId/turns/1/aftermath",async(request)=>{
      const query=request.query as Record<string,unknown>;
      if(request.body!==undefined||Object.keys(query).some(k=>k!=="schemaVersion")||(query.schemaVersion!==undefined&&query.schemaVersion!=="1"))throw new TurnReadError("INVALID_REQUEST");
      const p=ReadTurnRequestSchema.safeParse({schemaVersion:1,...request.params as object});if(!p.success)throw new TurnReadError("INVALID_REQUEST");
      const result=CombatAftermathViewSchema.parse(await options.turns.getAftermath!(p.data.matchId,request.session.playerIdentityId!));
      if(result.matchId!==p.data.matchId)throw new TurnReadError("INTERNAL_ERROR");return result;
    });
    if(options.turns.getResolution)routes.get("/api/matches/:matchId/turns/1/resolution",async(request)=>{
      const query=request.query as Record<string,unknown>;
      if(request.body!==undefined||Object.keys(query).some(k=>k!=="schemaVersion"&&k!=="eventOffset")||(query.schemaVersion!==undefined&&query.schemaVersion!=="1"))throw new TurnReadError("INVALID_REQUEST");
      const parsed=ReadTurnRequestSchema.safeParse({schemaVersion:1,...request.params as object});if(!parsed.success)throw new TurnReadError("INVALID_REQUEST");
      const offset=query.eventOffset===undefined?0:typeof query.eventOffset==="string"&&/^(0|[1-9]\d*)$/.test(query.eventOffset)?Number(query.eventOffset):NaN;
      if(!Number.isSafeInteger(offset)||offset<0)throw new TurnReadError("INVALID_REQUEST");
      const result=ResolutionViewSchema.parse(await options.turns.getResolution!(parsed.data.matchId,request.session.playerIdentityId!,offset));
      if(result.matchId!==parsed.data.matchId)throw new TurnReadError("INTERNAL_ERROR");return result;
    });
    routes.get("/api/matches/:matchId/turn", async (request) => {
      const query = request.query as Record<string, unknown>;
      const version = query.schemaVersion === undefined || query.schemaVersion === "1" ? 1 : query.schemaVersion;
      if (request.body !== undefined || Object.keys(query).some((key) => key !== "schemaVersion")) throw new TurnReadError("INVALID_REQUEST");
      const parsed = ReadTurnRequestSchema.safeParse({ schemaVersion: version, ...request.params as object });
      if (!parsed.success) throw new TurnReadError("INVALID_REQUEST");
      return ReadTurnResponseSchema.parse(await options.turns.getTurn(parsed.data.matchId, request.session.playerIdentityId!));
    });
  });
}
