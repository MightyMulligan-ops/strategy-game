import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const environmentFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(environmentFile)) loadEnvFile(environmentFile);

// Generation/schema validation work without credentials. Commands that connect
// require an explicit URL; there is no default production or local connection.
const offlineDiff = process.argv.includes("diff") && process.argv.includes("--from-empty");
// Prisma 7's diff CLI needs a configured URL even for schema-only diffs. This
// unreachable placeholder is never used by runtime clients or deploy/status.
const databaseUrl = process.env.DATABASE_URL ?? (offlineDiff ? "postgresql://unused:unused@127.0.0.1:1/validation_only" : undefined);
if (!databaseUrl && process.argv.some((argument) => ["deploy", "status", "dev", "reset", "push", "pull", "execute"].includes(argument))) {
  throw new Error("Set DATABASE_URL before running a database connection command");
}
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {})
});
