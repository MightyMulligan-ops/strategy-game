import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
describe("additive army migration offline review (does not execute SQL)", () => {
  it("contains only scoped function/trigger definitions inside one transaction", () => {
    const sql = read("202611130001_initial_armies").replace(/--[^\r\n]*/g, "");
    const pattern = /CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?\$\$;|CREATE(?: CONSTRAINT)? TRIGGER[\s\S]*?;/g;
    const statements = [...sql.matchAll(pattern)].map((m) => m[0]);
    expect(sql.replace(pattern, "").replace(/\b(?:BEGIN|COMMIT)\s*;/g, "").trim()).toBe("");
    expect(statements.filter((s) => /^CREATE (?:OR REPLACE )?FUNCTION/.test(s))).toHaveLength(7);
    expect(statements.filter((s) => /^CREATE(?: CONSTRAINT)? TRIGGER/.test(s))).toHaveLength(17);
    expect(sql).not.toMatch(/\b(?:ALTER TABLE|DROP|TRUNCATE|CREATE TABLE|CREATE EXTENSION)\b/);
  });
  it("preserves the complete old runtime bundle branch except its explicit new-profile admission", () => {
    const old = read("202611120001_initial_turn_one"); const added = read("202611130001_initial_armies");
    const body = (sql: string) => sql.slice(sql.indexOf("FUNCTION require_initial_turn_bundle()"), sql.indexOf("\n$$;", sql.indexOf("FUNCTION require_initial_turn_bundle()")));
    expect(body(added)).toBe(body(old).replace("OR initial_turn_profile_ok(c)))", "OR initial_turn_profile_ok(c) OR initial_armies_profile_ok(c)))"));
    expect(added).toContain('FOR UPDATE'); expect(added).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(added).toContain('initial_armies_profile_ok'); expect(added).toContain('originalSpawnNodeId');
  });
});
