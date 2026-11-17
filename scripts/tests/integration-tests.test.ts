import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parseCLI, resolveConfig } from "vitest/node";
import { integrationTestArguments, integrationTestFiles } from "../integration-tests.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
test("database runner isolates all discovered files while preserving per-test concurrency", async () => {
  const args = integrationTestArguments(root, []), parsed = parseCLI(["vitest", ...args]);
  expect(parsed.filter).toEqual(integrationTestFiles(root));
  expect(parsed.filter).toContain("apps/server/tests/lobby.integration.test.ts");
  expect(parsed.filter).toContain("database/tests/lobby.integration.test.ts");
  const { vitestConfig } = await resolveConfig({ ...parsed.options, root });
  expect(parsed.options.fileParallelism).toBe(false);
  expect(vitestConfig.maxWorkers).toBe(1);
  expect(vitestConfig.sequence.concurrent).not.toBe(true);
  expect(vitestConfig.testTimeout).toBe(5_000); // No timeout inflation.
  expect(vitestConfig.retry ?? 0).toBe(0);
});
test("database runner retains both reporters and the no-skip guard report path", () => {
  const { options } = parseCLI(["vitest", ...integrationTestArguments(root,
    ["--reporter=default", "--reporter=json", "--outputFile=.cache/ci/database-results.json"])]);
  expect(options).toMatchObject({ reporter: ["default", "json"] });
  expect(options.outputFile).toBe(".cache/ci/database-results.json");
  expect(options.fileParallelism).toBe(false);
});
test("forwarded flags cannot accidentally reenable shared-schema file parallelism", () => {
  const { options } = parseCLI(["vitest", ...integrationTestArguments(root, ["--file-parallelism"])]);
  expect(options.fileParallelism).toBe(false);
});
