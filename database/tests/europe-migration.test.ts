import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../prisma/migrations/202611180001_europe_playtest/migration.sql',import.meta.url),'utf8');
it('changes only explicit new-profile admission in the old start guard',()=>{
 const old=readFileSync(new URL('../prisma/migrations/202611170002_repeating_combat/migration.sql',import.meta.url),'utf8');
 const section=(s:string)=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION require_initial_turn_bundle()'),s.indexOf('CREATE FUNCTION ',s.indexOf('CREATE OR REPLACE FUNCTION require_initial_turn_bundle()')+20)).trim();
 expect(section(sql).replace(' OR europe_loop_profile_ok(c)','')).toBe(section(old));
 expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
 for(const match of sql.matchAll(/CREATE FUNCTION (\w+)/g))expect(match[1]).toMatch(/^europe_loop_/);
 expect(sql).not.toMatch(/DROP TABLE|ALTER TABLE|TRUNCATE|CREATE EXTENSION/);
});
it('pins scenario/profile and preserves atomic queue, carryover and clock guards',()=>{
 for(const s of ['europe_loop_profile_ok','europe_loop_queue_ok','europe_loop_frozen_payload','europe_loop_bundle','europe_loop_delete_children'])expect(sql).toContain(`CREATE FUNCTION ${s}`);
 for(const s of ['europe-playtest-v1','iberian-two-camps-v1','maskSha256','Invalid Europe scenario','Loop atomic sequential turn bundle incomplete','Loop unit resurrection or mutation','Loop capture requires complete victorious recipient','Loop commit window expired','Loop frozen input mismatch'])expect(sql).toContain(s);
 expect(sql).toContain("NEW.\"command\"->'profile'");expect(sql.trim().endsWith('COMMIT;')).toBe(true);
});
