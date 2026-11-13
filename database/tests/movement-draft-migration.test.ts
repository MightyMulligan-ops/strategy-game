import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (name: string) => readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
describe("movement migration offline inventory (no SQL execution)", () => {
  it("contains only additive functions/triggers and scoped old admission replacement", () => {
    const sql = read("202611130002_movement_drafts").replace(/--[^\r\n]*/g, "");
    const pattern = /CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?\$\$;|CREATE(?: CONSTRAINT)? TRIGGER[\s\S]*?;/g;
    const statements = [...sql.matchAll(pattern)].map((m) => m[0]);
    expect(sql.replace(pattern, "").replace(/\b(?:BEGIN|COMMIT)\s*;/g, "").trim()).toBe("");
    expect(statements.filter((s) => /^CREATE (?:OR REPLACE )?FUNCTION/.test(s))).toHaveLength(9);
    expect(statements.filter((s) => /^CREATE(?: CONSTRAINT)? TRIGGER/.test(s))).toHaveLength(20);
    expect(sql).not.toMatch(/\b(?:ALTER TABLE|DROP|TRUNCATE|CREATE TABLE|CREATE EXTENSION)\b/);
    expect(sql).toContain('clock_timestamp()'); expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
  it("preserves every byte of old runtime completeness branches except admission", () => {
    const body = (sql: string) => sql.slice(sql.indexOf("FUNCTION require_initial_turn_bundle()"), sql.indexOf("\n$$;", sql.indexOf("FUNCTION require_initial_turn_bundle()")));
    expect(body(read("202611130002_movement_drafts"))).toBe(body(read("202611130001_initial_armies")).replace('OR initial_armies_profile_ok(c)))', 'OR initial_armies_profile_ok(c) OR movement_drafts_profile_ok(c)))'));
  });
});
