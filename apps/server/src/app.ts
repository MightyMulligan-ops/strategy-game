import Fastify, { LogController } from "fastify";
import type { FastifyServerOptions } from "fastify";
import { registerAuthentication } from "./auth/routes.js";
import type { Authentication } from "./auth/routes.js";
import { registerLobbyRoutes } from "./lobbies/routes.js";
import type { LobbyPersistence } from "./lobbies/routes.js";
import { restrictLocalTestServer } from "./auth/local-test.js";
import { registerWorldRoutes } from "./worlds/routes.js";
import type { WorldPersistence } from "./worlds/routes.js";
import { registerFixtureTurnRoutes } from "./turns/routes.js";
import type { FixtureTurnService } from "./turns/service.js";

export async function buildApp(options: {
  auth?: Authentication; lobbies?: LobbyPersistence; worlds?: WorldPersistence;
  turnFixtures?: { service: FixtureTurnService };
  logger?: FastifyServerOptions["logger"]; trustProxy?: FastifyServerOptions["trustProxy"]
} = {}) {
  if (options.turnFixtures && process.env.NODE_ENV !== "test") throw new Error("Turn fixtures require NODE_ENV=test");
  const app = Fastify({ logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }), trustProxy: options.trustProxy ?? false });
  app.setErrorHandler((error, _request, reply) => {
    const code = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    const status = code >= 400 && code < 500 ? code : 500;
    if (status === 500) app.log.error("Request failed; inspect server configuration and service availability");
    return reply.code(status).send({ error: status === 403 ? "csrf_rejected" : "request_failed" });
  });
  app.get("/health", async () => ({ status: "ok", service: "strategy-game-server" }));
  if (options.auth) {
    if (options.auth.config.devLoginEnabled) {
      if (options.auth.config.origin !== "http://127.0.0.1:5173" || options.auth.config.secureCookies || !options.auth.localTestLogin) {
        throw new Error("Invalid local test login configuration");
      }
      restrictLocalTestServer(app, options.trustProxy);
    }
    await registerAuthentication(app, options.auth);
    if (options.turnFixtures) await registerFixtureTurnRoutes(app, {
      origin: options.auth.config.origin, accounts: options.auth.persistence, service: options.turnFixtures.service
    });
    if (options.worlds) await registerWorldRoutes(app, { accounts: options.auth.persistence, worlds: options.worlds });
    if (options.lobbies) await registerLobbyRoutes(app, {
      origin: options.auth.config.origin, accounts: options.auth.persistence, lobbies: options.lobbies
    });
  }
  else {
    app.get("/auth/config", async () => ({ enabled: false, providers: [], devLoginEnabled: false }));
    app.get("/auth/me", async (_request, reply) => reply.code(401).send({ error: "unauthorized" }));
  }
  return app;
}
