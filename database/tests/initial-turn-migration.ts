import { readFileSync } from "node:fs";

// Test-only replay of this exact additive migration, within a rollback-only CI transaction.
// Not a general SQL parser/runner; rejecting unrecognized top-level SQL keeps its scope explicit.
export function initialTurnMigration() {
  const source = readFileSync(new URL("../prisma/migrations/202611120001_initial_turn_one/migration.sql", import.meta.url), "utf8");
  const sql = source.replace(/--[^\r\n]*/g, "");
  const pattern = /CREATE FUNCTION[\s\S]*?\$\$;|CREATE(?: CONSTRAINT)? TRIGGER[\s\S]*?;/g;
  const statements = [...sql.matchAll(pattern)].map((m) => m[0]);
  if (sql.replace(pattern, "").replace(/\b(?:BEGIN|COMMIT)\s*;/g, "").trim()) throw new Error("Unsupported migration replay statement");
  const triggers = statements.filter((s) => s.startsWith("CREATE TRIGGER") || s.startsWith("CREATE CONSTRAINT TRIGGER")).map((s) => {
    const match = /^CREATE(?: CONSTRAINT)? TRIGGER (initial_turn_[a-z_]+)[\s\S]*? ON "([A-Za-z]+)"/.exec(s);
    if (!match) throw new Error("Unexpected migration trigger"); return { name: match[1]!, table: match[2]! };
  });
  const functions = statements.filter((s) => s.startsWith("CREATE FUNCTION")).map((s) => {
    const match = /^CREATE FUNCTION ([a-z_]+)\(([^)]*)\)/.exec(s);
    if (!match || !["initial_turn_profile_ok", "guard_initial_turn_configuration", "guard_initial_turn_artifact", "guard_initial_match_version", "require_initial_turn_bundle"].includes(match[1]!)) throw new Error("Unexpected migration function");
    return { name: match[1]!, signature: match[1] === "initial_turn_profile_ok" ? '"MatchConfiguration"' : "" };
  });
  if (functions.length !== 5 || triggers.length !== 16 || statements.length !== 21) throw new Error("Incomplete migration replay");
  return { statements, triggers, functions };
}
