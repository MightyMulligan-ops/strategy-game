import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../prisma/migrations/202611170001_combat_turn/migration.sql",import.meta.url),"utf8");
it("extends only the historical runtime admission branch and preserves its complete body",()=>{
 const old=readFileSync(new URL("../prisma/migrations/202611130005_movement_resolution/migration.sql",import.meta.url),"utf8");
 const section=(s:string)=>s.slice(s.indexOf("CREATE OR REPLACE FUNCTION require_initial_turn_bundle()"),s.indexOf("CREATE FUNCTION require_",s.indexOf("CREATE OR REPLACE FUNCTION require_initial_turn_bundle()")+20));
 expect(section(sql).replace(" OR combat_movement_resolution_profile_ok(c)","").trim()).toBe(section(old).trim());
 expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);expect(sql).not.toMatch(/DROP TABLE|ALTER TABLE|TRUNCATE|CREATE EXTENSION/);
});
it("guards explicit frozen policies and atomic complete survivor/capture artifacts without altering old cohorts",()=>{
 for(const name of ["combat_policy_ok","combat_resolution_frozen_payload","require_combat_result_bundle","guard_combat_commit_window"])expect(sql).toContain(`CREATE FUNCTION ${name}`);
 for(const text of ["'combat-turn-v1'","'schemaVersion',4","'combat_turn'","'combatPolicy'","'cityOwners'","'auditJson'","'RESOLVING'","'RESOLVED'","Capture requires victorious recipient","exactly one surviving membership"])expect(sql).toContain(text);
 const creators=[...sql.matchAll(/CREATE (?:CONSTRAINT )?TRIGGER (\w+)/g)].map(m=>m[1]);expect(new Set(creators).size).toBe(creators.length);
 expect(sql.trim().endsWith("COMMIT;")).toBe(true);
});
