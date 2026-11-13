import {readFileSync}from"node:fs";
import{describe,expect,it}from"vitest";
const read=(n:string)=>readFileSync(new URL(`../prisma/migrations/${n}/migration.sql`,import.meta.url),"utf8");
describe("closure migration offline review",()=>{
 it("is additive functions/triggers only, preserving old admission branches byte for byte",()=>{
 const old=read("202611130002_movement_drafts"),sql=read("202611130003_turn_closure");
 const body=(s:string)=>s.slice(s.indexOf("FUNCTION require_initial_turn_bundle()"),s.indexOf("\n$$;",s.indexOf("FUNCTION require_initial_turn_bundle()")));
 expect(body(sql)).toBe(body(old).replace('OR movement_drafts_profile_ok(c)))','OR movement_drafts_profile_ok(c) OR turn_closure_profile_ok(c)))'));
 const pattern=/CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?\$\$;|CREATE(?: CONSTRAINT)? TRIGGER[\s\S]*?;/g;
 expect(sql.replace(/--[^\r\n]*/g,"").replace(pattern,"").replace(/\b(?:BEGIN|COMMIT)\s*;/g,"").trim()).toBe("");
 expect(sql).not.toMatch(/\b(?:ALTER TABLE|DROP|TRUNCATE|CREATE TABLE|CREATE EXTENSION)\b/);
 expect(sql).toContain("CLOSED requires exactly one matching immutable frozen input");
 });
 it("adds a separate deferred deadline checkpoint without editing committed guards",()=>{
 const sql=read("202611130004_turn_closure_commit_window");
 expect((sql.match(/CREATE CONSTRAINT TRIGGER/g)||[])).toHaveLength(5);
 expect((sql.match(/DEFERRABLE INITIALLY DEFERRED/g)||[])).toHaveLength(5);
 expect(sql).toContain("Closure acceptance window expired at commit");expect(sql).toContain("USING ERRCODE='P0059'");
 expect(sql).not.toMatch(/CREATE OR REPLACE|ALTER TABLE|DROP|TRUNCATE|UPDATE "/);
 });
 it("branches explicitly before snapshot and Turn fields in shared trigger",()=>{
 const sql=read("202611130003_turn_closure");expect(sql).not.toMatch(/TG_TABLE_NAME\s*=\s*'[^']+'\s+AND\s+\(?NEW\./);
 expect(sql).toContain("IF TG_TABLE_NAME='GameSnapshotRecord' THEN");expect(sql).toContain("IF TG_TABLE_NAME='Turn' THEN");
 });
});
