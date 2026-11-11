import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
  : ["run", ...readdirSync(new URL("../database/tests/", import.meta.url))
    // Includes lobby, auth, and turn persistence; new suites need no fixed list.
    .filter((name) => name.endsWith(".integration.test.ts")).sort().map((name) => `database/tests/${name}`),
    ...process.argv.slice(2)];
const result = spawnSync(process.execPath, [executable, ...arguments_], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, RUN_DATABASE_TESTS: "1" }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
