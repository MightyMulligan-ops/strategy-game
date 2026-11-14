import { resolveMovement } from "@strategy-game/game-engine";
import { Prisma } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { readStoredTurn } from "./turn-storage.js";
import { restoreWorldArchive } from "./world-repository.js";
import { json } from "./mappings.js";
/** Seed was fixed atomically at freeze. All transient RESOLVING work is in one
 * transaction; failures leave CLOSED, and a later bounded scan uses the same seed. */
export class MovementResolutionRepository{
 constructor(private readonly client:PrismaClient){}
 async resolveClosed(matchId:string,timeoutMs=5000):Promise<boolean>{
  return this.client.$transaction(async(tx)=>{
   await tx.$queryRaw(Prisma.sql`SELECT set_config('lock_timeout',${String(timeoutMs)},true)`);
   await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout',${String(timeoutMs)},true)`);
   await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id"=${matchId} FOR UPDATE`;
   const config=await tx.matchConfiguration.findUnique({where:{matchId}});
   if(config?.simulationVersion!=="movement-resolution-v1")return false;
   const a=await readStoredTurn(tx,matchId,1);
   if(a.kind!=="movement_resolution"||a.state.turn.status!=="closed"||!a.row.frozenInput||!a.row.match.world)return false;
   await tx.turn.update({where:{matchId_number:{matchId,number:1n}},data:{status:"RESOLVING"}});
   const result=resolveMovement(a.snapshot,a.row.frozenInput.payload,restoreWorldArchive(a.row.match.world));
   await tx.gameSnapshotRecord.create({data:{matchId,stateVersion:1n,completedTurnNumber:1n,snapshotId:result.nextState.snapshotId,payload:json(result.nextState)}});
   await tx.resolutionResult.create({data:{matchId,turnNumber:1n,resolutionId:result.resolutionId,nextStateVersion:1n,payload:json(result)}});
   await tx.turn.update({where:{matchId_number:{matchId,number:1n}},data:{status:"RESOLVED"}});
   await tx.match.update({where:{id:matchId},data:{currentStateVersion:1n}});
   return true;
  },{isolationLevel:"ReadCommitted",timeout:timeoutMs+1000,maxWait:timeoutMs});
 }
 async dueMatches(limit:number):Promise<readonly string[]>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error("Invalid resolution batch");
  return this.client.$transaction(async(tx)=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;await tx.$executeRaw`SET LOCAL statement_timeout=5000`;
   return(await tx.turn.findMany({where:{number:1n,status:"CLOSED",match:{status:"RUNNING",configuration:{simulationVersion:"movement-resolution-v1"}}},orderBy:[{deadlineAtMs:"asc"},{matchId:"asc"}],take:limit,select:{matchId:true}})).map(r=>r.matchId);
  },{timeout:6000,maxWait:5000});
 }
}
