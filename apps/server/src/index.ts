
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { AuthRepository, createDatabaseClient } from "@strategy-game/database";
import { buildApp } from "./app.js";
import { readAuthConfig } from "./auth/config.js";

const environmentFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(environmentFile)) loadEnvFile(environmentFile);
try {
  const config = readAuthConfig(process.env);
  const database = config ? createDatabaseClient() : undefined;
  const app = await buildApp({
    logger: true,
    trustProxy: process.env.AUTH_TRUST_PROXY ? process.env.AUTH_TRUST_PROXY.split(",") : false,
    ...(config && database ? { auth: { config, persistence: new AuthRepository(database) } } : {})
  });
  if (database) app.addHook("onClose", async () => database.$disconnect());
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: "127.0.0.1" });
} catch {
  console.error("Server startup failed; check environment configuration, port, and database readiness");
  process.exitCode = 1;
}
