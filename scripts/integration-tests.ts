import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Shared by the runner and CI guard, including real HTTP/database coverage. */
export function integrationTestFiles(root: string): string[] {
  return ["database/tests", "apps/server/tests"].flatMap((directory) =>
    readdirSync(join(root, directory)).filter((name) => name.endsWith(".integration.test.ts"))
      .map((name) => `${directory}/${name}`)
  ).sort();
}

/** Fixtures change shared table DDL and hold deliberate deadline locks. Isolate
 * files, not the concurrent connections explicitly exercised within each test.
 * Keep this last so forwarded CLI flags cannot accidentally restore parallelism. */
export function integrationTestArguments(root: string, options: string[]): string[] {
  return ["run", ...integrationTestFiles(root), ...options, "--no-file-parallelism"];
}
