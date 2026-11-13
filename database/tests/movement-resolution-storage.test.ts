import{describe,it,expect}from"vitest";
import{planMovementResolution,freezeMovementInput,observeClosureDeadline,resolveMovement}from"@strategy-game/game-engine";
import{movementDraftFixture}from"./movement-draft-fixture.js";
import{restoreStoredTurn}from"../src/turn-storage.js";
import type{StoredTurnRow}from"../src/turn-storage.js";
import{restoreWorldArchive}from"../src/world-repository.js";
import{ownResolutionView}from"../src/movement-resolution-view.js";
import{MovementResolutionRepository}from"../src/movement-resolution-repository.js";
import type{PrismaClient,Prisma}from"../src/generated/prisma/client.js";
function fixture(){
 const f=movementDraftFixture(),archive=restoreWorldArchive(f.row.match.world!),plan=planMovementResolution(f.config,f.players,archive),row:StoredTurnRow=structuredClone(f.row);
 Object.assign(row.match.configuration!,{rulesetId:'movement-resolution',simulationVersion:'movement-resolution-v1',pinnedRuleset:JSON.parse(JSON.stringify(plan.runtimeProfile))});
 Object.assign(row.startingSnapshot,{snapshotId:plan.snapshot.snapshotId,payload:JSON.parse(JSON.stringify(plan.snapshot))});
 const a=restoreStoredTurn(row);if(a.kind!=='movement_resolution')throw Error('fixture');const state=observeClosureDeadline(a.state,11000),frozen=freezeMovementInput(state,plan.snapshot,archive);
 Object.assign(row,{status:'CLOSED',lastObservedAtMs:11000n,closedAtMs:11000n,closeReason:'DEADLINE',frozenInput:{matchId:row.matchId,turnNumber:1n,seed:BigInt(frozen.resolutionSeed),payload:JSON.parse(JSON.stringify(frozen)),frozenAt:new Date(0)}});
 const result=resolveMovement(plan.snapshot,frozen,archive);
 const resolved=()=>{const r=structuredClone(row);Object.assign(r,{status:'RESOLVED',resolution:{matchId:r.matchId,turnNumber:1n,resolutionId:result.resolutionId,nextStateVersion:1n,payload:JSON.parse(JSON.stringify(result)),recordedAt:new Date(0)}});r.match.currentStateVersion=1n;return r};
 return{...f,archive,plan,row,frozen,result,resolved};
}
describe('new-cohort strict restoration and own-only immutable projections (no database)',()=>{
 it('restores CLOSED and RESOLVED while retaining unchanged units/world and seed',()=>{const f=fixture();expect(restoreStoredTurn(f.row).kind).toBe('movement_resolution');const a=restoreStoredTurn(f.resolved());expect(a.state.turn.status).toBe('resolved');if(a.kind!=='movement_resolution')throw Error('fixture');expect(a.result).toEqual(f.result);expect(a.result!.nextState.units).toEqual(a.snapshot.units)});
 it.each(['seed','frozen','result','snapshot','runtime','version','resolving'])('rejects corrupt %s without repair',kind=>{const f=fixture(),r=f.resolved();if(kind==='seed')r.frozenInput!.seed=BigInt(f.frozen.resolutionSeed)+1n;if(kind==='frozen')r.frozenInput!.payload={};if(kind==='result')r.resolution!.payload={};if(kind==='snapshot')r.startingSnapshot.snapshotId='forged';if(kind==='runtime')r.match.configuration!.simulationVersion='turn-closure-v1';if(kind==='version')r.match.currentStateVersion=0n;if(kind==='resolving')r.status='RESOLVING';expect(()=>restoreStoredTurn(r)).toThrow()});
 it('projects only own formation, canonical event sequence and server-derived counts',()=>{const f=fixture(),a=restoreStoredTurn(f.resolved());if(a.kind!=='movement_resolution')throw Error('fixture');const v=ownResolutionView(a,'p00');expect(v.state).toBe('RESOLVED');expect(JSON.stringify(v)).not.toMatch(/worldSeed|resolutionSeed|runtimeProfile|startingSnapshotId|account-p|p01/);if(v.state==='RESOLVED'){expect(v.summary).toEqual({completed:0,stopped:0,notExecuted:0,pendingEncounters:0});expect(v.events).toEqual([]);expect(v.formation.units).toHaveLength(6)}});
 it('keeps observational projection independent of caller-owned data',()=>{const f=fixture(),a=restoreStoredTurn(f.resolved());if(a.kind!=='movement_resolution')throw Error('fixture');const before=structuredClone(a.row);expect(ownResolutionView(a,'p00')).toEqual(ownResolutionView(a,'p00'));expect(a.row).toEqual(before)});
});
function transactional(){
 const f=fixture();let committed=structuredClone(f.row),next:unknown=null,fail='';const calls:string[]=[];
 const stage=(name:string)=>{calls.push(name);if(fail===name)throw Error('injected')};
 const client={$transaction:async(work:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>{
  const row=structuredClone(committed);let candidate=structuredClone(next);
  const tx={
   $queryRaw:async()=>{calls.push('lock');return[{id:row.matchId}]},
   matchConfiguration:{findUnique:async()=>row.match.configuration},
   turn:{findUnique:async()=>row,update:async({data}:{data:{status:string}})=>{stage(data.status==='RESOLVING'?'resolving':'resolved');Object.assign(row,data)}},
   gameSnapshotRecord:{create:async({data}:{data:unknown})=>{stage('snapshot');candidate=data},findUnique:async()=>candidate},
   resolutionResult:{create:async({data}:{data:StoredTurnRow['resolution']})=>{stage('result');row.resolution=data}},
   match:{update:async()=>{stage('version');row.match.currentStateVersion=1n}}
  };
  const result=await work(tx as unknown as Prisma.TransactionClient);stage('commit');committed=row;next=candidate;return result;
 }}as unknown as PrismaClient;
 return{...f,repo:new MovementResolutionRepository(client),committed:()=>committed,fail:(name:string)=>{fail=name},calls};
}
describe('atomic resolution transaction injection',()=>{
 it('commits exactly one snapshot/result/version and treats duplicate invocation as no-op',async()=>{const f=transactional();expect(await f.repo.resolveClosed(f.row.matchId)).toBe(true);expect(f.committed().status).toBe('RESOLVED');expect(await f.repo.resolveClosed(f.row.matchId)).toBe(false);expect(f.calls.filter(c=>c==='result')).toHaveLength(1)});
 it.each(['resolving','snapshot','result','resolved','version','commit'])('rolls %s back without replacing the seed',async(name)=>{const f=transactional(),before=structuredClone(f.committed());f.fail(name);await expect(f.repo.resolveClosed(f.row.matchId)).rejects.toThrow('injected');expect(f.committed()).toEqual(before);f.fail('');expect(await f.repo.resolveClosed(f.row.matchId)).toBe(true)});
});

describe('privacy-redacted defender contact timeline',()=>{
 it('includes a stationary defender contact after its own completed movement without exposing enemy actions',()=>{
  const f=fixture(),formations=f.plan.snapshot.formations,mid={x:(formations[0]!.position.x+formations[1]!.position.x)/2,y:(formations[0]!.position.y+formations[1]!.position.y)/2};
  const frozen={...f.frozen,players:f.frozen.players.map((p,i)=>({...p,orders:[{type:'move' as const,orderId:`private-${p.playerId}`,stackId:formations[i]!.formationId,destination:mid}]}))};
  const result=resolveMovement(f.plan.snapshot,frozen,f.archive),a=restoreStoredTurn(f.resolved());if(a.kind!=='movement_resolution')throw Error('fixture');
  a.result=result;const defender=result.audits.find(r=>r.outcome==='executed')!,enemy=result.audits.find(r=>r.outcome==='blocked_encounter')!,v=ownResolutionView(a,defender.playerId);
  if(v.state!=='RESOLVED')throw Error('fixture');expect(v.events.map(e=>e.type)).toEqual(['executed','hostile_contact']);expect(v.events.map(e=>e.sequence)).toEqual([0,1]);
  expect(v.events[1]).toMatchObject({orderId:null,moveNumber:0,traveled:0});expect(v.events[1]!.from).toEqual(v.events[1]!.to);
  expect(JSON.stringify(v)).not.toContain(enemy.orderId);expect(JSON.stringify(v)).not.toContain(enemy.formationId);
  expect(ownResolutionView(a,defender.playerId,1)).toMatchObject({eventOffset:1,eventTotal:2,events:[{sequence:1,type:'hostile_contact'}]});
 });
});
