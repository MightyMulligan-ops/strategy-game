import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("city migration adds a cohort without changing the prior admission body or backfilling matches",()=>{
 const sql=readFileSync(new URL("../prisma/migrations/202611190001_city_recruitment/migration.sql",import.meta.url),"utf8");
 const old=readFileSync(new URL("../prisma/migrations/202611180002_europe_configuration_admission/migration.sql",import.meta.url),"utf8");
 const extract=(source:string)=>source.match(/CREATE OR REPLACE FUNCTION guard_initial_turn_configuration\(\)[\s\S]*?\$\$;/)?.[0];
 const cityGate=/  IF NEW\."simulationVersion"='iberian-cities-v1'[\s\S]*?\n  END IF;\n/;
 expect(extract(sql)?.replace(cityGate,"")).toBe(extract(old));
 expect(sql.split("CREATE FUNCTION")[0]).toContain('ADD COLUMN "cityDraft" JSONB');
 expect(sql.split("CREATE FUNCTION")[0]).not.toMatch(/UPDATE|DELETE|INSERT|TRUNCATE/);
 expect(sql).toMatch(/city_loop_credit_edit_ok\(/);
 expect(sql).toContain("INITIALLY DEFERRED");
});
