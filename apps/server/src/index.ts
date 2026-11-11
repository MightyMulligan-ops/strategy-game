
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { AuthRepository, createDatabaseClient, LobbyRepository } from "@strategy-game/database";
import { buildApp } from "./app.js";
import { readAuthConfig } from "./auth/config.js";

const environmentFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(environmentFile)) loadEnvFile(environmentFile);
let database: ReturnType<typeof createDatabaseClient> | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  const config = readAuthConfig(process.env);
  database = config ? createDatabaseClient() : undefined;
  app = await buildApp({
    logger: true,
    trustProxy: process.env.AUTH_TRUST_PROXY ? process.env.AUTH_TRUST_PROXY.split(",") : false,
    ...(config && database ? { auth: { config, persistence: new AuthRepository(database),
      ...(config.devLoginEnabled ? { localTestLogin: new AuthRepository(database) } : {}) }, lobbies: new LobbyRepository(database) } : {})
  });
  const ownedDatabase = database;
  if (ownedDatabase) app.addHook("onClose", async () => ownedDatabase.$disconnect());
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: "127.0.0.1" });
} catch {
  try { if (app) await app.close(); else await database?.$disconnect(); } catch { /* Keep shutdown failures private too. */ }
  console.error("Server startup failed; check environment configuration, port, and database readiness");
  process.exitCode = 1;
}
