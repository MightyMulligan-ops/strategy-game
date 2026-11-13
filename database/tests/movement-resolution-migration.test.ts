import {readFileSync}from"node:fs";
import{describe,it,expect}from"vitest";
const read=(name:string)=>readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),"utf8");
describe("movement resolution offline migration review",()=>{
 it("preserves historical start-admission branches except exact new runtime admission",()=>{
  const body=(s:string)=>s.slice(s.indexOf('FUNCTION require_initial_turn_bundle()'),s.indexOf('\n$$;',s.indexOf('FUNCTION require_initial_turn_bundle()')));
  expect(body(read('202611130005_movement_resolution'))).toBe(body(read('202611130003_turn_closure')).replace('OR turn_closure_profile_ok(c)))','OR turn_closure_profile_ok(c) OR movement_resolution_profile_ok(c)))'));
 });
 it("adds only functions/triggers and retains commit, no-dangling-work and immutable guards",()=>{
  const sql=read('202611130005_movement_resolution').replace(/--[^\r\n]*/g,'');
  const pattern=/CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?\$\$;|CREATE(?: CONSTRAINT)? TRIGGER[\s\S]*?;/g;
  expect(sql.replace(pattern,'').replace(/\b(?:BEGIN|COMMIT)\s*;/g,'').trim()).toBe('');
  expect(sql).not.toMatch(/ALTER TABLE|DROP|TRUNCATE|CREATE TABLE|CREATE EXTENSION/);expect(sql).toContain('RESOLVING cannot commit without atomic result');
  expect(sql).toContain('zz_movement_commit_turn');expect(sql).toContain('movement-resolution-v1');
 });
});
