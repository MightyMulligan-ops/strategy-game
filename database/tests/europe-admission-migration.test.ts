import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';
const read=(id:string)=>readFileSync(new URL(`../prisma/migrations/${id}/migration.sql`,import.meta.url),'utf8');
const old=read('202611120001_initial_turn_one'),sql=read('202611180002_europe_configuration_admission');
const functionBody=(s:string)=>s.slice(s.indexOf('DECLARE lifecycle "MatchStatus";'),s.indexOf('$$;',s.indexOf('DECLARE lifecycle "MatchStatus";')));
it('EUROPE107-SQL-ADMISSION-002 preserves the entire old body outside one exact Europe branch',()=>{
 const start=sql.indexOf('  -- EUROPE107-SQL-ADMISSION-002:'),end=sql.indexOf('  IF (jsonb_typeof(NEW."pinnedRuleset")',start);
 const branch=sql.slice(start,end);expect(branch).toContain('NOT europe_loop_profile_ok(NEW)');expect(branch).toContain("lifecycle <> 'OPEN'");
 expect(functionBody(sql.replace(branch,''))).toBe(functionBody(old));
 expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);expect(sql).not.toMatch(/CREATE TRIGGER|DROP |ALTER TABLE|TRUNCATE|DISABLE|UPDATE "|DELETE FROM/);
 expect(sql.trim().endsWith('COMMIT;')).toBe(true);
});
it('uses the already-pinned strict Europe metadata/configuration predicate, not a general version2 exception',()=>{
 const profile=read('202611180001_europe_playtest').split('CREATE FUNCTION europe_loop_queue_ok')[0];
 for(const token of ['"playerCapacity"=2','"schemaVersion"=1','"rulesetId"=\'europe-playtest\'','"pinnedRuleset"=','"config"=jsonb_build_object','maskSha256','scenarioId'])expect(profile).toContain(token);
 expect(sql).not.toContain("IN ('1','2')");
});
