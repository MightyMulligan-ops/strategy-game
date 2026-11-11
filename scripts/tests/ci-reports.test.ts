import { describe, expect, it } from "vitest";
import { sanitizeLog, verifyDatabaseReport } from "../ci-reports.ts";

const files = ["database/tests/auth.integration.test.ts", "database/tests/persistence.integration.test.ts",
  "database/tests/lobby.integration.test.ts", "apps/server/tests/lobby.integration.test.ts"];
function report(status = "passed") {
  return { success: true, testResults: files.map((file) => ({
    name: `C:\\repo\\${file.replaceAll("/", "\\")}`, status: "passed", assertionResults: [{ status }]
  })) };
}

describe("CI integration execution guard", () => {
  it("accepts executed tests across all integration files without hard-coding a test count", () => {
    expect(verifyDatabaseReport(report(), files)).toBe(files.length);
  });
  it.each(["pending", "skipped", "todo", "failed"])("rejects %s tests even when the report claims success", (status) => {
    expect(() => verifyDatabaseReport(report(status), files)).toThrow();
  });
  it("rejects missing, duplicated, empty, unsuccessful, and newly untested suites", () => {
    const complete = report();
    expect(() => verifyDatabaseReport({}, files)).toThrow();
    expect(() => verifyDatabaseReport({ ...complete, success: false }, files)).toThrow();
    expect(() => verifyDatabaseReport({ ...complete, testResults: complete.testResults.slice(0, 1) }, files)).toThrow();
    expect(() => verifyDatabaseReport({ ...complete, testResults: [complete.testResults[0]!, complete.testResults[0]!] }, files)).toThrow();
    expect(() => verifyDatabaseReport({ ...complete, testResults: complete.testResults.map((result) => ({ ...result, assertionResults: [] })) }, files)).toThrow();
    expect(() => verifyDatabaseReport(complete, [...files, "new.integration.test.ts"])).toThrow();
    expect(() => verifyDatabaseReport({ success: true, testResults: [] }, [])).toThrow();
  });
});

describe("CI artifact redaction", () => {
  it("removes configured secrets and credential URLs while retaining useful error details", () => {
    const log = "Error: connection refused postgresql://user:pass@127.0.0.1:5432/ci_test token=private-token password=ci-only-password https://user:pass@example.test/path";
    const sanitized = sanitizeLog(log, { POSTGRES_PASSWORD: "ci-only-password", GITHUB_TOKEN: "private-token" });
    expect(sanitized).toContain("Error: connection refused");
    for (const value of ["user:pass", "private-token", "ci-only-password"]) expect(sanitized).not.toContain(value);
    expect(sanitizeLog("postgres://other:credential@localhost/ci_test", {})).toBe("[REDACTED_DATABASE_URL]");
  });
});
