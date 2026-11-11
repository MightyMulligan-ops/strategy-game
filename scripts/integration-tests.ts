import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Shared by the runner and CI guard, including real HTTP/database coverage. */
export function integrationTestFiles(root: string): string[] {
  return ["database/tests", "apps/server/tests"].flatMap((directory) =>
    readdirSync(join(root, directory)).filter((name) => name.endsWith(".integration.test.ts"))
      .map((name) => `${directory}/${name}`)
  ).sort();
}
