import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { testDatabaseUrl } from "../database/src/environment.ts";

// No URL is printed, and the development DATABASE_URL is never used as a fallback.
const url = testDatabaseUrl(process.env.TEST_DATABASE_URL);
const migrate = process.argv.includes("--migrate");
const executable = fileURLToPath(new URL(migrate
  ? "../database/node_modules/prisma/build/index.js"
  : "../node_modules/vitest/vitest.mjs", import.meta.url));
const arguments_ = migrate
  ? ["migrate", "deploy", "--config", fileURLToPath(new URL("../database/prisma.config.ts", import.meta.url))]
  : ["run", "database/tests/persistence.integration.test.ts", "database/tests/auth.integration.test.ts"];
const result = spawnSync(process.execPath, [executable, ...arguments_], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, RUN_DATABASE_TESTS: "1" }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
