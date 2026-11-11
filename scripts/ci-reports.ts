import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type TestReport = {
  success?: boolean;
  testResults?: { name?: string; status?: string; assertionResults?: { status?: string }[] }[];
};

export function verifyDatabaseReport(report: TestReport, expectedFiles: readonly string[]): number {
  if (report.success !== true || expectedFiles.length === 0 || !Array.isArray(report.testResults) ||
      report.testResults.length !== expectedFiles.length) {
    throw new Error("Database test report is missing, unsuccessful, or does not cover every integration file.");
  }
  let count = 0;
  for (const file of expectedFiles) {
    const results = report.testResults.filter((result) => result.name?.replaceAll("\\", "/").endsWith(`/database/tests/${file}`));
    const result = results[0];
    if (results.length !== 1 || result?.status !== "passed" || !Array.isArray(result.assertionResults) ||
        result.assertionResults.length === 0 || result.assertionResults.some((test) => test.status !== "passed")) {
      throw new Error(`Integration tests did not all execute and pass in ${file}; skipped, pending, and todo tests fail CI.`);
    }
    count += result.assertionResults.length;
  }
  return count;
}

export function sanitizeLog(contents: string, environment: NodeJS.ProcessEnv): string {
  const keys = ["DATABASE_URL", "TEST_DATABASE_URL", "POSTGRES_PASSWORD", "SESSION_SECRET",
    "GOOGLE_CLIENT_SECRET", "DISCORD_CLIENT_SECRET", "NODE_AUTH_TOKEN", "GITHUB_TOKEN"];
  const values = keys.map((key) => environment[key]).filter((value): value is string => Boolean(value))
    .sort((a, b) => b.length - a.length);
  for (const value of values) contents = contents.replaceAll(value, "[REDACTED]");
  return contents.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const reports = join(root, ".cache/ci");
  try {
    if (process.argv[2] === "verify") {
      const expected = readdirSync(join(root, "database/tests")).filter((name) => name.endsWith(".integration.test.ts")).sort();
      const report = JSON.parse(readFileSync(join(reports, "database-results.json"), "utf8")) as TestReport;
      console.log(`Verified ${verifyDatabaseReport(report, expected)} passed integration tests across ${expected.length} files, with no skips.`);
    } else if (process.argv[2] === "sanitize") {
      mkdirSync(join(reports, "sanitized"), { recursive: true });
      for (const file of readdirSync(reports).filter((name) => name.endsWith(".log"))) {
        writeFileSync(join(reports, "sanitized", file), sanitizeLog(readFileSync(join(reports, file), "utf8"), process.env));
      }
    } else throw new Error("Use scripts/ci-reports.ts verify or sanitize.");
  } catch {
    // Raw report/parser/driver errors could contain credentials. Keep details
    // in the original command's masked Actions log, not in this error message.
    console.error("CI report validation/processing failed. Check that all integration suites ran with no skips and that the JSON report was produced.");
    process.exitCode = 1;
  }
}
