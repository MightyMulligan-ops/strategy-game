import {RepeatingCommandSchema as LoopCommandSchema,UsernameSchema,LoopTurnNumberSchema} from '@strategy-game/shared-types';
import type {LoopState} from '@strategy-game/shared-types/server';
import {applyLoop,freezeLoop,resolveLoop,openLoopNext,LoopFailure} from '@strategy-game/game-engine/server';
import {observeDeadline} from '@strategy-game/game-engine';
import type {TurnState} from '@strategy-game/game-engine';
import {Prisma} from './generated/prisma/client.js';
import type {PrismaClient} from './generated/prisma/client.js';
import {readLoop} from './loop-storage.js';
import type {LoopAggregate} from './loop-storage.js';
import {loopCurrent,loopHistory} from './loop-view.js';
import {json,orderRows,turnFields,safeNumber} from './mappings.js';
import {MovementDraftError} from './movement-draft-repository.js';
type Tx=Prisma.TransactionClient;
export async function loopMember(tx:Tx,id:string,identity:string){
 const p=await tx.playerIdentity.findUnique({where:{id:identity},select:{username:true}});if(!p)throw new MovementDraftError('UNAUTHENTICATED');if(!UsernameSchema.safeParse(p.username).success)throw new MovementDraftError('USERNAME_REQUIRED');
 const m=await tx.matchParticipant.findUnique({where:{matchId_identityId:{matchId:id,identityId:identity}},select:{playerId:true,active:true}});if(!m?.active)throw new MovementDraftError('NOT_FOUND');return m.playerId;
}
async function bounded(tx:Tx,id:string,timeout:number){
 await tx.$queryRaw(Prisma.sql`SELECT set_config('lock_timeout',${String(timeout)},true)`);await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout',${String(timeout)},true)`);
 await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id"=${id} FOR UPDATE`;
 return ['combat-loop-v1','europe-playtest-v1'].includes((await tx.matchConfiguration.findUnique({where:{matchId:id}}))?.simulationVersion??'');
}
export async function insertLoopTurn(tx:Tx,state:TurnState,snapshot:LoopState){
 const matchId=state.config.gameId,turnNumber=BigInt(state.turn.turnNumber);
 await tx.turn.create({data:{matchId,number:turnNumber,startingStateVersion:BigInt(snapshot.stateVersion),...turnFields(state)}});
 for(const p of state.players){const scope={matchId,turnNumber,playerId:p.playerId};await tx.playerTurnState.create({data:{...scope,active:true,revision:0n,ready:false}});await tx.playerSubmissionRevision.create({data:{...scope,revision:0n,kind:'INITIAL',ready:false,orders:[]}})}
}
async function lifecycle(tx:Tx,a:LoopAggregate,state:TurnState){
 await tx.turn.update({where:{matchId_number:{matchId:a.row.matchId,number:a.row.number}},data:turnFields(state)});
 if(a.state.turn.status==='open'&&state.turn.status==='closed'){const f=freezeLoop(state,a.snapshot,a.archive);await tx.frozenTurnInputRecord.create({data:{matchId:a.row.matchId,turnNumber:a.row.number,payload:json(f),seed:BigInt(f.resolutionSeed)}})}
}
function sqlExpired(e:unknown,depth=0):boolean{if(!e||typeof e!=='object'||depth>5)return false;const v=e as Record<string,unknown>;return v.code==='P0059'||v.originalCode==='P0059'||[v.meta,v.cause,v.driverAdapterError].some(x=>sqlExpired(x,depth+1))}
export class LoopRepository{
 constructor(private readonly client:PrismaClient,private readonly clock:()=>number=Date.now){}
 async current(id:string,identity:string){return this.client.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;const actor=await loopMember(tx,id,identity);return loopCurrent(await readLoop(tx,id),actor)},{isolationLevel:'RepeatableRead',timeout:15000})}
 async history(id:string,n:number,identity:string){if(!LoopTurnNumberSchema.safeParse(n).success)throw new MovementDraftError('INVALID_REQUEST');return this.client.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;const actor=await loopMember(tx,id,identity);const m=await tx.match.findUniqueOrThrow({where:{id}});if(n>safeNumber(m.currentStateVersion))throw new MovementDraftError('TURN_UNAVAILABLE');return loopHistory(await readLoop(tx,id,n),actor)},{isolationLevel:'RepeatableRead',timeout:15000})}
 async command(id:string,n:number,identity:string,input:unknown){
  const parsed=LoopCommandSchema.safeParse(input);if(!parsed.success||!LoopTurnNumberSchema.safeParse(n).success)throw new MovementDraftError('INVALID_REQUEST');if(parsed.data.turnNumber!==n)throw new MovementDraftError('WRONG_TURN');
  try{const r=await this.client.$transaction(async tx=>{
   await loopMember(tx,id,identity);if(!await bounded(tx,id,10000))throw new MovementDraftError('UNSUPPORTED_RUNTIME');const actor=await loopMember(tx,id,identity),a=await readLoop(tx,id);
   if(a.state.turn.turnNumber!==n)throw new MovementDraftError('WRONG_TURN');const c=parsed.data,out=applyLoop(a.state,a.snapshot,a.archive,actor,c,this.clock());
   if(out.draft){const next=out.draft,scope={matchId:id,turnNumber:BigInt(n),playerId:actor};
    await tx.playerSubmissionRevision.create({data:{...scope,revision:BigInt(next.revision),kind:c.kind==='set_ready'?'SET_READY':c.kind==='replace_orders'?'REPLACE_ORDERS':'CANCEL_ORDER',ready:next.ready,orders:json(next.orders),command:json(c)}});
    const updated=await tx.playerTurnState.updateMany({where:{...scope,revision:BigInt(c.expectedRevision)},data:{revision:BigInt(next.revision),ready:next.ready}});if(updated.count!==1)throw new MovementDraftError('STALE_REVISION');
    if(c.kind!=='set_ready'){await tx.playerOrder.updateMany({where:{...scope,active:true},data:{active:false,draftPosition:null,moveNumber:null,lastRevision:BigInt(next.revision)}});
     for(const o of orderRows(id,n,next))await tx.playerOrder.upsert({where:{matchId_turnNumber_playerId_orderId:{...scope,orderId:o.orderId}},create:o,update:{payload:o.payload,kind:o.kind,active:true,draftPosition:o.draftPosition,moveNumber:o.moveNumber,lastRevision:o.lastRevision}})}
   }
   await lifecycle(tx,a,out.state);return {error:out.error,view:loopCurrent({...a,state:out.state},actor)};
  },{isolationLevel:'ReadCommitted',timeout:15000,maxWait:10000});
  if(r.error)throw new LoopFailure(r.error);return r.view;
  }catch(e){if(sqlExpired(e)){await this.closeDue(id,5000,true);throw new MovementDraftError('TURN_CLOSED')}if(e instanceof LoopFailure)throw new MovementDraftError(e.code as ConstructorParameters<typeof MovementDraftError>[0]);if(e instanceof MovementDraftError)throw e;throw new MovementDraftError('INTERNAL_ERROR')}
 }
 async closeDue(id:string,timeout=5000,sqlClock=false){return this.client.$transaction(async tx=>{
  if(!await bounded(tx,id,timeout))return false;const a=await readLoop(tx,id);if(a.state.turn.status!=='open')return false;
  const now=sqlClock?safeNumber((await tx.$queryRaw<{now:bigint}[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now`)[0]!.now):this.clock();
  const state=observeDeadline(a.state,now);if(state.turn.status==='open')return false;await lifecycle(tx,a,state);return true;
 },{isolationLevel:'ReadCommitted',timeout:timeout+1000,maxWait:timeout})}
 async resolveClosed(id:string,timeout=5000){return this.client.$transaction(async tx=>{
  if(!await bounded(tx,id,timeout))return false;const a=await readLoop(tx,id);if(a.state.turn.status!=='closed'||!a.row.frozenInput)return false;
  await tx.turn.update({where:{matchId_number:{matchId:id,number:a.row.number}},data:{status:'RESOLVING'}});
  const result=resolveLoop(a.snapshot,a.row.frozenInput.payload,a.archive);
  // Sample only after complete pure resolution, while the same parent lock is held.
  const next=openLoopNext(a.state,this.clock()),scope={matchId:id,turnNumber:a.row.number};
  await tx.gameSnapshotRecord.create({data:{matchId:id,stateVersion:a.row.number,completedTurnNumber:a.row.number,snapshotId:result.nextState.snapshotId,payload:json(result.nextState)}});
  await tx.resolutionResult.create({data:{...scope,nextStateVersion:a.row.number,resolutionId:result.resolutionId,payload:json({schemaVersion:result.runtimeProfile.simulationVersion==='europe-playtest-v1'?2:1,kind:result.runtimeProfile.simulationVersion==='europe-playtest-v1'?'europe_loop_commit':'loop_commit',result,nextOpenedAtMs:next.turn.openedAtMs})}});
  await tx.turn.update({where:{matchId_number:{matchId:id,number:a.row.number}},data:{status:'RESOLVED'}});
  await insertLoopTurn(tx,next,result.nextState);
  await tx.match.update({where:{id},data:{currentStateVersion:a.row.number}});return true;
 },{isolationLevel:'ReadCommitted',timeout:timeout+1000,maxWait:timeout})}
 async process(id:string,timeout:number){const closed=await this.closeDue(id,timeout);return await this.resolveClosed(id,timeout)||closed}
 async dueMatches(limit:number){if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid loop batch');const now=this.clock();if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid loop clock');
  return this.client.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;await tx.$executeRaw`SET LOCAL statement_timeout=5000`;
   return(await tx.turn.findMany({where:{match:{status:'RUNNING',configuration:{simulationVersion:{in:['combat-loop-v1','europe-playtest-v1']}}},OR:[{status:'CLOSED'},{status:'OPEN',deadlineAtMs:{lte:BigInt(now)}}]},orderBy:[{deadlineAtMs:'asc'},{matchId:'asc'}],take:limit,select:{matchId:true}})).map(r=>r.matchId);
  },{timeout:6000})}
}
