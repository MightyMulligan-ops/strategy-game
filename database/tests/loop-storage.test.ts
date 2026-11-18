import {describe,it,expect} from 'vitest';
import {loopFixture} from './loop-fixture.js';
import {readLoop,restoreLoopRow} from '../src/loop-storage.js';
import {loopCurrent,loopHistory} from '../src/loop-view.js';
import {LoopRepository} from '../src/loop-repository.js';
import type {Prisma,PrismaClient} from '../src/generated/prisma/client.js';
import type {StoredTurnRow} from '../src/turn-storage.js';
function memory(f=loopFixture()){
 let store={rows:structuredClone(f.rows),snapshots:structuredClone(f.snapshots),version:BigInt(f.current().state.turn.turnNumber-1)},fail='';const calls:string[]=[];
 const stage=(s:string)=>{calls.push(s);if(fail===s)throw Error('injected')};
 const client={$transaction:async(work:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>{
  const copy=structuredClone(store),base=[...copy.rows.values()][0]!;
  const turn=(n:bigint)=>copy.rows.get(Number(n))!;
  const tx={$queryRaw:async()=>[{id:base.matchId}],$executeRaw:async()=>0,
   match:{findUniqueOrThrow:async()=>({...base.match,currentStateVersion:copy.version}),findUnique:async()=>({...base.match,currentStateVersion:copy.version}),update:async({data}:{data:{currentStateVersion:bigint}})=>{stage('version');copy.version=data.currentStateVersion;for(const r of copy.rows.values())r.match.currentStateVersion=copy.version}},
   matchConfiguration:{findUnique:async()=>base.match.configuration},
   turn:{findUniqueOrThrow:async({where}:{where:{matchId_number:{number:bigint}}})=>turn(where.matchId_number.number),count:async({where}:{where:{status?:{in:string[]}}})=>where.status?[...copy.rows.values()].filter(r=>where.status!.in.includes(r.status)).length:copy.rows.size,
    update:async({where,data}:{where:{matchId_number:{number:bigint}};data:object&{status:string}})=>{stage(data.status);Object.assign(turn(where.matchId_number.number),data)},
    create:async({data}:{data:StoredTurnRow})=>{stage('nextTurn');copy.rows.set(Number(data.number),{...structuredClone(base),...data,players:[],frozenInput:null,resolution:null,startingSnapshot:copy.snapshots.get(Number(data.startingStateVersion))!})}},
   gameSnapshotRecord:{findUniqueOrThrow:async({where}:{where:{matchId_stateVersion:{stateVersion:bigint}}})=>copy.snapshots.get(Number(where.matchId_stateVersion.stateVersion)),count:async()=>copy.snapshots.size,create:async({data}:{data:StoredTurnRow['startingSnapshot']})=>{stage('snapshot');copy.snapshots.set(Number(data.stateVersion),data)}},
   resolutionResult:{count:async()=>[...copy.rows.values()].filter(r=>r.resolution).length,create:async({data}:{data:NonNullable<StoredTurnRow['resolution']>})=>{stage('result');turn(data.turnNumber).resolution=data}},
   playerTurnState:{create:async({data}:{data:StoredTurnRow['players'][number]})=>{stage('player');turn(data.turnNumber).players.push({...data,orders:[],revisions:[]})}},
   playerSubmissionRevision:{create:async({data}:{data:StoredTurnRow['players'][number]['revisions'][number]})=>{stage('history');turn(data.turnNumber).players.find(p=>p.playerId===data.playerId)!.revisions.push({...data,command:data.command??null,recordedAt:data.recordedAt??new Date()})}}};
  const r=await work(tx as unknown as Prisma.TransactionClient);stage('commit');store=copy;return r;
 }} as unknown as PrismaClient;
 return {client,repo:new LoopRepository(client,()=>20000),fail:(s:string)=>{fail=s},state:()=>store,calls};
}
describe('durable repeating restoration and own projection (no DB)',()=>{
 it('restores1→2→3→4 with immutable own history and bounded adjacent chain checks',async()=>{
  const f=loopFixture();f.advance();f.advance();f.advance();const m=memory(f);
  const a=await m.client.$transaction(tx=>readLoop(tx,f.f.row.matchId));expect(a.state.turn.turnNumber).toBe(4);expect(a.state.drafts.every(d=>!d.ready&&d.revision===0&&!d.orders.length)).toBe(true);
  const before=JSON.stringify([...m.state().rows.values()],(_,v)=>typeof v==='bigint'?String(v):v);const old=await m.client.$transaction(tx=>readLoop(tx,f.f.row.matchId,1));expect(loopHistory(old,'p00').turnNumber).toBe(1);expect(JSON.stringify([...m.state().rows.values()],(_,v)=>typeof v==='bigint'?String(v):v)).toBe(before);
  expect(loopCurrent(a,'p00').formations.every(f=>f.ownerPlayerId==='p00')).toBe(true);expect(JSON.stringify(loopCurrent(a,'p00'))).not.toMatch(/p01|resolutionSeed|seedIdentity|auditJson|lastObserved/);
 });
 it.each(['predecessor','successor','frozen','history','version','opening'])('fails closed on corrupted%s without repairing persisted rows',async(kind)=>{
  const f=loopFixture();f.advance();f.advance();const row=f.rows.get(2)!;
  if(kind==='predecessor')f.rows.get(2)!.resolution!.payload={};if(kind==='successor')f.rows.get(3)!.startingSnapshot.snapshotId='forged';if(kind==='frozen')row.frozenInput!.payload={};if(kind==='history')row.players[0]!.revisions.pop();if(kind==='version')f.rows.get(3)!.startingStateVersion=0n;if(kind==='opening')f.rows.get(3)!.openedAtMs--;
  const m=memory(f);await expect(m.client.$transaction(tx=>readLoop(tx,f.f.row.matchId))).rejects.toThrow();
 });
 it('does not expose opponents even in bounded historical projection',()=>{const f=loopFixture();f.advance();const a=restoreLoopRow(f.rows.get(1)!,f.archive);const r=a.result!;Object.assign(a,{result:{...r,battles:[{encounterId:'private',position:{xMilli:1000,yMilli:1000},locationId:'city',formations:[{formationId:a.snapshot.formations.find(f=>f.ownerPlayerId==='p00')!.formationId,stance:'moving'},{formationId:a.snapshot.formations.find(f=>f.ownerPlayerId==='p01')!.formationId,stance:'stationary'}],outcome:'victory',victoriousPlayerIds:['p01'],recipientPlayerId:'p01',auditJson:'private'}]}});
  const v=loopHistory(a,'p00');expect(v.aftermath.battles[0]!.ownership!.recipient).toBe('opponent');expect(JSON.stringify(v)).not.toMatch(/p01|auditJson|private|seed|rounds/);
 });
});
describe('atomic repeating transition injected rollback boundaries',()=>{
 it.each(['RESOLVING','snapshot','result','RESOLVED','nextTurn','player','history','version','commit'])('rolls back%s to identical CLOSED input and safely resumes once',async(s)=>{
  const f=loopFixture();f.close();const m=memory(f),before=structuredClone(m.state());m.fail(s);await expect(m.repo.resolveClosed(f.f.row.matchId)).rejects.toThrow('injected');expect(m.state()).toEqual(before);m.fail('');expect(await m.repo.resolveClosed(f.f.row.matchId)).toBe(true);expect(m.state().rows.size).toBe(2);expect(m.state().rows.get(1)!.frozenInput).toEqual(before.rows.get(1)!.frozenInput);expect(await m.repo.resolveClosed(f.f.row.matchId)).toBe(false);
 });
});
