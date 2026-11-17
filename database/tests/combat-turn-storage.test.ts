import {describe,it,expect} from "vitest";
import {combatTurnFixture} from "./combat-turn-fixture.js";
import {restoreStoredTurn,readStoredTurn} from "../src/turn-storage.js";
import {ownCombatAftermath,ownCombatFormationView} from "../src/combat-turn-view.js";
import {MovementResolutionRepository} from "../src/movement-resolution-repository.js";
import type {StoredTurnRow} from "../src/turn-storage.js";
import type {Prisma,PrismaClient} from "../src/generated/prisma/client.js";
describe("combat cohort durable replay and privacy",()=>{
 it("replays real CLOSED/RESOLVED records and returns the same complete aftermath after restart",()=>{
  const f=combatTurnFixture(2,true),closed=restoreStoredTurn(f.row),a=restoreStoredTurn(f.resolved()),b=restoreStoredTurn(structuredClone(f.resolved()));
  expect(closed.kind).toBe("combat_turn");expect(a.state.turn.status).toBe("resolved");if(a.kind!=="combat_turn"||b.kind!=="combat_turn")throw Error("fixture");
  expect(a.result).toEqual(f.result);expect(ownCombatAftermath(a,"p00")).toEqual(ownCombatAftermath(b,"p00"));
  const view=ownCombatAftermath(a,"p00"),text=JSON.stringify(view),enemy=f.plan.snapshot.formations.find(p=>p.ownerPlayerId==="p01")!;
  expect(text).not.toMatch(/p01|resolutionSeed|runtimeProfile|auditJson|raw|rounds|time|sequence|private-order/);
  expect(text).not.toContain(enemy.formationId);for(const id of enemy.unitIds)expect(text).not.toContain(id);
  expect(view.state).toBe("RESOLVED");expect(ownCombatFormationView(a,"p00").formations.every(f=>f.ownerPlayerId==="p00")).toBe(true);
 });
 it("labels an opposing capture recipient accurately without exposing its identity",()=>{
  const f=combatTurnFixture(2,true),a=restoreStoredTurn(f.resolved());if(a.kind!=="combat_turn")throw Error("fixture");
  const result=structuredClone(a.result!);Object.assign(result.battles[0]!,{recipientPlayerId:"p01",victoriousPlayerIds:["p01"],locationId:"city"});a.result=result;
  const v=ownCombatAftermath(a,"p00");expect(v).toMatchObject({battles:[{outcome:"defeat",ownership:{locationId:"city",recipient:"opponent"}}]});expect(JSON.stringify(v)).not.toContain("p01");
 });
 it.each(["seed","relations","stats","frozen","result","snapshot","membership","version","resolving","roster"])("rejects changed %s rather than repairing historical state",kind=>{
  const f=combatTurnFixture(),row=f.resolved();
  if(kind==="seed")row.frozenInput!.seed=1n;if(kind==="frozen")row.frozenInput!.payload={};if(kind==="result")row.resolution!.payload={};
  if(kind==="snapshot")row.startingSnapshot.snapshotId="forged";if(kind==="version")row.match.currentStateVersion=0n;if(kind==="resolving")row.status="RESOLVING";
  if(kind==="roster")row.match.participants.pop();
  if(["relations","stats","membership"].includes(kind)){const s=structuredClone(f.plan.snapshot);
   if(kind==="relations")Object.assign(s.combatPolicy,{relationships:[]});if(kind==="stats")Object.assign(s.units[0]!,{attack:999});if(kind==="membership")Object.assign(s.formations[0]!,{unitIds:[]});row.startingSnapshot.payload=s as unknown as Prisma.JsonValue;}
  expect(()=>restoreStoredTurn(row)).toThrow();
 });
 it("checks the separately fetched next snapshot on every resolved read",async()=>{
  const f=combatTurnFixture(),tx={turn:{findUnique:async()=>f.resolved()},gameSnapshotRecord:{findUnique:async()=>null}} as unknown as Prisma.TransactionClient;
  await expect(readStoredTurn(tx,f.row.matchId,1)).rejects.toThrow();
 });
});
function transaction(){
 const f=combatTurnFixture(2,true);let committed=structuredClone(f.row),next:unknown=null,fail="";const calls:string[]=[];
 const stage=(s:string)=>{calls.push(s);if(fail===s)throw Error("injected")};
 const client={$transaction:async(work:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>{
  const row=structuredClone(committed);let snapshot=structuredClone(next);
  const tx={$queryRaw:async()=>[{id:row.matchId}],matchConfiguration:{findUnique:async()=>row.match.configuration},
   turn:{findUnique:async()=>row,update:async({data}:{data:{status:string}})=>{stage(data.status);Object.assign(row,data)}},
   gameSnapshotRecord:{create:async({data}:{data:unknown})=>{stage("snapshot");snapshot=data},findUnique:async()=>snapshot},
   resolutionResult:{create:async({data}:{data:StoredTurnRow["resolution"]})=>{stage("result");row.resolution=data}},
   match:{update:async()=>{stage("version");row.match.currentStateVersion=1n}}};
  const result=await work(tx as unknown as Prisma.TransactionClient);stage("commit");committed=row;next=snapshot;return result;
 }} as unknown as PrismaClient;
 return {...f,repo:new MovementResolutionRepository(client),current:()=>committed,fail:(s:string)=>{fail=s},calls};
}
describe("complete combat transaction injection (no database)",()=>{
 it("commits one complete battle bundle and duplicate execution is a no-op",async()=>{const f=transaction();expect(await f.repo.resolveClosed(f.row.matchId)).toBe(true);
  expect(f.current().status).toBe("RESOLVED");expect(await f.repo.resolveClosed(f.row.matchId)).toBe(false);expect(f.calls.filter(c=>c==="result")).toHaveLength(1);});
 it.each(["RESOLVING","snapshot","result","RESOLVED","version","commit"])("rolls back %s and safely resumes the identical frozen battle",async(stage)=>{
  const f=transaction(),before=structuredClone(f.current());f.fail(stage);await expect(f.repo.resolveClosed(f.row.matchId)).rejects.toThrow("injected");expect(f.current()).toEqual(before);
  f.fail("");expect(await f.repo.resolveClosed(f.row.matchId)).toBe(true);expect(f.current().frozenInput).toEqual(before.frozenInput);
 });
});
