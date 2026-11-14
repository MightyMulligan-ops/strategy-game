import { describe,it,expect } from "vitest";
import {signLedgerEvent,verifyLedger,appendLedgerEvent} from "../automation-ledger.ts";
import type {LedgerBody,SignedLedgerEvent,DurableLedgerStore} from "../automation-ledger.ts";
const key=Buffer.alloc(32,17);
const identity={repository:"MightyMulligan-ops/strategy-game",issue:68,taskId:"stage2"};
const sha="a".repeat(40);
const body=(id:number,kind:LedgerBody["kind"],attempt:number|null=null,failureId:string|null=null):LedgerBody=>({
  version:1,...identity,eventId:"event-"+id,kind,attempt,failureId,sourceHead:sha,baseHead:sha,
  actorId:"owner",approvalSource:"verified-owner-source",timestamp:"2026-11-14T00:00:00Z"
});
function history(spec: Array<[LedgerBody["kind"],number|null,(string|null)?]>) {
  const events:SignedLedgerEvent[]=[];
  for(const [kind,attempt,failure] of spec) events.push(signLedgerEvent({...body(events.length+1,kind,attempt,failure??null),
    sequence:events.length+1,previousDigest:events.at(-1)?.digest??null},key));
  return events;
}
const checkpoint=(events:SignedLedgerEvent[])=>({sequence:events.length,digest:events.at(-1)!.digest});
describe("Stage 2 signed durable ledger boundary",()=>{
  it("verifies complete signed history but rejects tampering and truncated checkpoints",()=>{
    const events=history([["task-claimed",null],["implementation-attempt-started",1],["task-transfer",null],["implementation-attempt-started",2]]);
    expect(verifyLedger(events,identity,key,checkpoint(events))).toMatchObject({ok:true,state:{implementationUsed:2}});
    expect(verifyLedger(events.map((e,i)=>i===1?{...e,actorId:"attacker"}:e),identity,key,checkpoint(events))).toMatchObject({ok:false,reason:"SIGNATURE_OR_PAYLOAD_MISMATCH"});
    expect(verifyLedger(events.slice(1),identity,key,checkpoint(events))).toMatchObject({ok:false});
    expect(verifyLedger(events,identity,key,null)).toMatchObject({ok:false});
    expect(verifyLedger(events,identity,Buffer.alloc(32,18),checkpoint(events))).toMatchObject({ok:false});
  });
  it("enforces five starts and two per failure, even without outcomes",()=>{
    const impl=history([["task-claimed",null],...Array.from({length:6},(_,i)=>["implementation-attempt-started",i+1] as [LedgerBody["kind"],number])]);
    expect(verifyLedger(impl,identity,key,checkpoint(impl))).toMatchObject({ok:false,reason:"IMPLEMENTATION_LIMIT"});
    const repair=history([["task-claimed",null],...Array.from({length:3},(_,i)=>["repair-attempt-started",i+1,"FAILURE"] as [LedgerBody["kind"],number,string])]);
    expect(verifyLedger(repair,identity,key,checkpoint(repair))).toMatchObject({ok:false,reason:"REPAIR_LIMIT"});
  });
  it("rejects duplicate starts, outcomes without starts, and revocation",()=>{
    for(const spec of [
      [["task-claimed",null],["implementation-attempt-started",1],["implementation-attempt-started",1]],
      [["task-claimed",null],["implementation-attempt-outcome",1]],
      [["task-claimed",null],["owner-revocation",null],["implementation-attempt-started",1]]
    ] as Array<Array<[LedgerBody["kind"],number|null]>>) {
      const events=history(spec);expect(verifyLedger(events,identity,key,checkpoint(events)).ok).toBe(false);
    }
  });
  it("prevents unsafe appends and rejects stale concurrent writes",async()=>{
    let events=history([["task-claimed",null]]);
    const store:DurableLedgerStore={
      async read(){return events;},
      async compareAndAppend(_key,expected,e){if(events.at(-1)?.digest!==expected)return false;events=[...events,e];return true;}
    };
    const ok=await appendLedgerEvent(store,"stage2",identity,body(2,"implementation-attempt-started",1),key,checkpoint(events));
    expect(ok).toMatchObject({ok:true,state:{implementationUsed:1}});
    expect(events).toHaveLength(2);
    const stale=await appendLedgerEvent(store,"stage2",identity,body(3,"implementation-attempt-started",2),key,{sequence:1,digest:events[0]!.digest});
    expect(stale).toMatchObject({ok:false,reason:"CHECKPOINT_MISMATCH"});
    expect(events).toHaveLength(2);
  });
  it("durably appends revocation, then blocks further starts",async()=>{
    let events=history([["task-claimed",null]]);
    const store:DurableLedgerStore={
      async read(){return events;},
      async compareAndAppend(_key,expected,e){if(events.at(-1)?.digest!==expected)return false;events=[...events,e];return true;}
    };
    const revoked=await appendLedgerEvent(store,"stage2",identity,body(2,"owner-revocation"),key,checkpoint(events));
    expect(revoked).toMatchObject({ok:true,state:{revoked:true}});
    expect(events).toHaveLength(2);
    expect(verifyLedger(events,identity,key,checkpoint(events))).toMatchObject({ok:false,reason:"TASK_REVOKED_OR_CLOSED"});
    expect(await appendLedgerEvent(store,"stage2",identity,body(3,"implementation-attempt-started",1),key,checkpoint(events)))
      .toMatchObject({ok:false,reason:"TASK_REVOKED_OR_CLOSED"});
  });

});
