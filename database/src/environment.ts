export function testDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("Set TEST_DATABASE_URL to a local database ending in _test");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("TEST_DATABASE_URL is not a valid URL"); }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !/^\/[a-zA-Z0-9_]+_test$/.test(parsed.pathname) ||
      (parsed.searchParams.has("schema") && parsed.searchParams.get("schema") !== "public")) {
    throw new Error("Database tests require a local PostgreSQL database ending in _test with the public schema");
  }
  return value;
}
