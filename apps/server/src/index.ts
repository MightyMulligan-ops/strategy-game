import { EUROPE_RUNTIME } from "@strategy-game/shared-types/server";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { LoopRepository, AuthRepository, createDatabaseClient, LobbyRepository, TurnReadRepository, MovementDraftRepository, TurnClosureRepository, MovementResolutionRepository, FormationReadRepository, WorldRepository } from "@strategy-game/database";
import { buildApp } from "./app.js";
import { readAuthConfig } from "./auth/config.js";

import { deadlineWorker, deadlineWorkerConfig, movementLifecycleStore } from "./turns/deadline-worker.js";

const environmentFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(environmentFile)) loadEnvFile(environmentFile);
let database: ReturnType<typeof createDatabaseClient> | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  const config = readAuthConfig(process.env);
  const workerConfig = config ? deadlineWorkerConfig(process.env) : undefined;
  database = config ? createDatabaseClient() : undefined;
  app = await buildApp({
    logger: true,
    trustProxy: process.env.AUTH_TRUST_PROXY ? process.env.AUTH_TRUST_PROXY.split(",") : false,
    ...(config && database ? { auth: { config, persistence: new AuthRepository(database),
      ...(config.devLoginEnabled ? { localTestLogin: new AuthRepository(database) } : {}) }, lobbies: new LobbyRepository(database, undefined, undefined, EUROPE_RUNTIME),
      worlds: new WorldRepository(database), turnReads: new TurnReadRepository(database), formationReads: new FormationReadRepository(database), movementDrafts: new MovementDraftRepository(database), loops:new LoopRepository(database), turnReady: new TurnClosureRepository(database) } : {})
  });
  const ownedDatabase = database;
  if (ownedDatabase && workerConfig) {
    const closures=new TurnClosureRepository(ownedDatabase),resolutions=new MovementResolutionRepository(ownedDatabase);
    const store=movementLifecycleStore(closures,resolutions,new LoopRepository(ownedDatabase));
    const worker = deadlineWorker(store, workerConfig, () => app!.log.warn("Deadline batch incomplete; persisted overdue turns remain eligible"));
    app.addHook("onReady", async () => worker.start());
    app.addHook("onClose", async () => { await worker.stop(); await ownedDatabase.$disconnect(); });
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app?.close().catch(() => { console.error("Server shutdown failed; inspect service availability"); process.exitCode = 1; }); });
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: "127.0.0.1" });
} catch {
  try { if (app) await app.close(); else await database?.$disconnect(); } catch { /* Keep shutdown failures private too. */ }
  console.error("Server startup failed; check environment configuration, port, and database readiness");
  process.exitCode = 1;
}
