import {describe,it,expect} from "vitest";
import {PostgresLedgerStore} from "../automation-ledger-postgres.ts";
import {signLedgerEvent} from "../automation-ledger.ts";
import type {PgLedgerClient,PgLedgerPool} from "../automation-ledger-postgres.ts";
const key=Buffer.alloc(32,42);
const genesis=signLedgerEvent({
 version:1,repository:"MightyMulligan-ops/strategy-game",issue:68,taskId:"stage2",
 eventId:"genesis-1",kind:"task-claimed",failureId:null,attempt:null,
 sourceHead:"a".repeat(40),baseHead:"b".repeat(40),actorId:"owner",
 approvalSource:"verified-owner",timestamp:"2026-11-14T00:00:00Z",
 sequence:1,previousDigest:null
},key);
describe("Stage 2 PostgreSQL CAS adapter",()=>{
 it("provisions only once and commits the genesis and head in one transaction",async()=>{
  const calls:string[]=[];
  const client:PgLedgerClient={release(){calls.push("RELEASE");},
   async query(sql){calls.push(sql);return {rows:[]};}};
  const pool:PgLedgerPool={connect:async()=>client,query:async()=>({rows:[]})};
  expect(await new PostgresLedgerStore(pool).provision("stage2",genesis)).toBe(true);
  expect(calls).toEqual(["BEGIN",expect.stringContaining("INSERT INTO automation_audit.ledger_heads"),
   expect.stringContaining("INSERT INTO automation_audit.ledger_events"),"COMMIT","RELEASE"]);
 });
 it("rejects stale heads before writing an event",async()=>{
  const calls:string[]=[];
  const client:PgLedgerClient={release(){calls.push("RELEASE");},
   async query(sql){calls.push(sql);return {rows:sql.includes("SELECT sequence,digest")?[{sequence:1,digest:"wrong"}]:[]};}};
  const pool:PgLedgerPool={connect:async()=>client,query:async()=>({rows:[]})};
  expect(await new PostgresLedgerStore(pool).compareAndAppend("stage2",genesis.digest,
   {...genesis,sequence:2})).toBe(false);
  expect(calls).toEqual(["BEGIN",expect.stringContaining("FOR UPDATE"),"ROLLBACK","RELEASE"]);
 });
 it("rolls back failed writes and does not report success",async()=>{
  const calls:string[]=[];
  const client:PgLedgerClient={release(){calls.push("RELEASE");},
   async query(sql){calls.push(sql);if(sql.includes("INSERT INTO automation_audit.ledger_events"))throw Error("duplicate");
    return {rows:[]};}};
  const pool:PgLedgerPool={connect:async()=>client,query:async()=>({rows:[]})};
  expect(await new PostgresLedgerStore(pool).provision("stage2",genesis)).toBe(false);
  expect(calls).toContain("ROLLBACK");expect(calls).not.toContain("COMMIT");
 });
});
