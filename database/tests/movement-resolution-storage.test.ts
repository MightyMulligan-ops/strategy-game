import{createSecretKey}from"node:crypto";
import{describe,it,expect,vi}from"vitest";
import{initializeMovementDrafts,planMovementResolution,freezeMovementInput,observeClosureDeadline,resolveMovement}from"@strategy-game/game-engine";
import{movementDraftFixture,fixtureRevision}from"./movement-draft-fixture.js";
import{clearMovementRestorationCache}from"../src/movement-resolution-storage.js";
import{readStoredTurn,restoreStoredTurn}from"../src/turn-storage.js";
import type{StoredTurnRow}from"../src/turn-storage.js";
import{restoreWorldArchive}from"../src/world-repository.js";
import{ownResolutionView}from"../src/movement-resolution-view.js";
import{MovementResolutionRepository}from"../src/movement-resolution-repository.js";
import type{PrismaClient,Prisma}from"../src/generated/prisma/client.js";
function fixture(withOrders=false,matchId?:string){
 const f=movementDraftFixture();
 if(matchId){
  f.config.gameId=matchId;f.players.forEach(p=>{p.gameId=matchId});f.archive.matchId=matchId;
  f.row.matchId=matchId;f.row.match.id=matchId;f.row.match.configuration!.matchId=matchId;f.row.match.world!.matchId=matchId;
  f.row.startingSnapshot.matchId=matchId;f.row.match.participants.forEach(p=>{p.matchId=matchId});
  f.row.players.forEach(p=>{p.matchId=matchId;p.revisions.forEach(r=>{r.matchId=matchId})});
  f.plan=initializeMovementDrafts(f.config,f.players,f.archive,10000);
 }
 if(withOrders){const formation=f.plan.snapshot.formations.find(p=>p.ownerPlayerId==='p00')!;fixtureRevision(f,'p00',[{type:'move',orderId:'own-zero',stackId:formation.formationId,destination:formation.position}]);}
 const archive=restoreWorldArchive(f.row.match.world!),plan=planMovementResolution(f.config,f.players,archive),row:StoredTurnRow=structuredClone(f.row);
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

describe('complete-content immutable restoration reuse',()=>{
 it('reuses detached immutable validation, returns the current row and cannot be poisoned by a caller',()=>{
  clearMovementRestorationCache();const f=fixture(true),row=f.resolved(),first=restoreStoredTurn(row),copy=structuredClone(row),hit=restoreStoredTurn(copy);
  if(first.kind!=='movement_resolution'||hit.kind!=='movement_resolution')throw Error('fixture');
  expect(hit.row).toBe(copy);expect(hit.result).toBe(first.result);expect(JSON.stringify(hit.result)).toBe(JSON.stringify(f.result));
  expect(Object.isFrozen(hit.state.drafts[0]!.orders)).toBe(true);expect(Object.isFrozen(hit.result!.audits[0]!.to)).toBe(true);
  expect(()=>{Object.assign(hit.result!.audits[0]!,{remaining:0})}).toThrow();
  hit.result=null;expect(restoreStoredTurn(structuredClone(row))).toMatchObject({result:f.result});
  expect(JSON.stringify(copy.resolution!.payload)).toBe(JSON.stringify(f.result));
 });
 const changes:Record<string,(row:StoredTurnRow)=>void>={
  seed:r=>{r.frozenInput!.seed=r.frozenInput!.seed!+1n},frozen:r=>{r.frozenInput!.payload={}},result:r=>{r.resolution!.payload={}},
  coordinates:r=>{const p=structuredClone(r.resolution!.payload)as unknown as {nextState:{formations:{position:{xMilli:number}}[]}};p.nextState.formations[0]!.position.xMilli++;r.resolution!.payload=p as never},
  audit:r=>{const p=structuredClone(r.resolution!.payload)as unknown as {audits:{remaining:number}[]};p.audits[0]!.remaining--;r.resolution!.payload=p as never},
  snapshot:r=>{r.startingSnapshot.snapshotId='forged'},snapshotVersion:r=>{r.startingSnapshot.stateVersion=1n},
  completed:r=>{r.startingSnapshot.completedTurnNumber=1n},snapshotMatch:r=>{r.startingSnapshot.matchId='wrong'},
  runtime:r=>{r.match.configuration!.simulationVersion='turn-closure-v1'},version:r=>{r.match.currentStateVersion=0n},
  match:r=>{r.match.id='wrong'},status:r=>{r.match.status='OPEN'},turn:r=>{r.number=2n},start:r=>{r.startingStateVersion=1n},
  deadline:r=>{r.deadlineAtMs++},clock:r=>{r.lastObservedAtMs=r.openedAtMs-1n},resolving:r=>{r.status='RESOLVING'},
  participant:r=>{r.match.participants[0]!.active=false},roster:r=>{r.match.participants.pop()},player:r=>{r.players[0]!.active=false},
  history:r=>{r.players[0]!.revisions[0]!.orders=[{}]},revision:r=>{r.players[0]!.revision++},
  order:r=>{r.players[0]!.orders[0]!.lastRevision=0n},typedTurn:r=>{r.number='1' as unknown as bigint},
  typedResultVersion:r=>{r.resolution!.nextStateVersion='1' as unknown as bigint},
  customSerialization:r=>{const original=structuredClone(r.resolution!.payload);r.resolution!.payload={toJSON:()=>original}as never}
 };
 it.each(Object.keys(changes))('does full fail-closed validation for changed %s after a cache hit',kind=>{
  clearMovementRestorationCache();const f=fixture(true),r=f.resolved();restoreStoredTurn(r);restoreStoredTurn(structuredClone(r));
  changes[kind]!(r);expect(()=>restoreStoredTurn(r)).toThrow();
 });
 it('never reuses mutable OPEN state and preserves canonical results when row enumeration changes',()=>{
  clearMovementRestorationCache();const f=fixture(),open=structuredClone(f.row);
  Object.assign(open,{status:'OPEN',lastObservedAtMs:10000n,closedAtMs:null,closeReason:null,frozenInput:null});
  expect(restoreStoredTurn(open).state).not.toBe(restoreStoredTurn(open).state);
  const r=f.resolved(),first=restoreStoredTurn(r),reordered=structuredClone(r);reordered.players.reverse();reordered.match.participants.reverse();
  const second=restoreStoredTurn(reordered);if(first.kind!=='movement_resolution'||second.kind!=='movement_resolution')throw Error('fixture');
  expect(JSON.stringify(second.result)).toBe(JSON.stringify(first.result));
 });
 it('evicts old entries instead of retaining every match or assuming IDs are immutable',()=>{
  clearMovementRestorationCache();const f=fixture(),r=f.resolved(),first=restoreStoredTurn(r);
  for(let i=1;i<=4;i++){const copy=structuredClone(r);copy.match.createdAt=new Date(i*1000);expect(restoreStoredTurn(copy).kind).toBe('movement_resolution')}
  const again=restoreStoredTurn(r);if(first.kind!=='movement_resolution'||again.kind!=='movement_resolution')throw Error('fixture');
  expect(again.result).not.toBe(first.result);expect(again.result).toEqual(first.result);
 });
 it('keeps actor filtering outside shared validation reuse',()=>{
  clearMovementRestorationCache();const f=fixture(true),r=f.resolved(),a=restoreStoredTurn(r),b=restoreStoredTurn(structuredClone(r));
  if(a.kind!=='movement_resolution'||b.kind!=='movement_resolution')throw Error('fixture');
  const own=ownResolutionView(a,'p00'),other=ownResolutionView(b,'p01');expect(own.state).toBe('RESOLVED');expect(other.state).toBe('RESOLVED');
  expect(JSON.stringify(own)).not.toContain('p01');expect(JSON.stringify(other)).not.toContain('p00');
  expect(own).toMatchObject({summary:{completed:1}});expect(other).toMatchObject({summary:{completed:0}});
 });
 it('still fetches and verifies the separate next snapshot on every read, including cache hits',async()=>{
  clearMovementRestorationCache();const f=fixture(true),row=f.resolved();let calls=0,bad=false;
  const tx={turn:{findUnique:async()=>structuredClone(row)},gameSnapshotRecord:{findUnique:async()=>{calls++;return{snapshotId:f.result.nextState.snapshotId,completedTurnNumber:1n,payload:bad?{}:JSON.parse(JSON.stringify(f.result.nextState))}}}}as unknown as Prisma.TransactionClient;
  await readStoredTurn(tx,row.matchId,1);await readStoredTurn(tx,row.matchId,1);expect(calls).toBe(2);
  bad=true;await expect(readStoredTurn(tx,row.matchId,1)).rejects.toMatchObject({code:'invalid_storage'});expect(calls).toBe(3);
 });
});

describe('descriptor-checked input boundary before cold validation and warm reuse',()=>{
 type Alter=(row:StoredTurnRow,called:()=>void)=>StoredTurnRow;
 const cases:Record<string,Alter>={
  bigintToJSON:(r,call)=>{r.number={toJSON(){call();return 1n}}as never;return r},
  nestedSeedToJSON:(r,call)=>{const seed=r.frozenInput!.seed;r.frozenInput!.seed={toJSON(){call();return seed}}as never;return r},
  resultVersionToJSON:(r,call)=>{r.resolution!.nextStateVersion={toJSON(){call();return 1n}}as never;return r},
  nestedPayloadToJSON:(r,call)=>{const payload=r.resolution!.payload;r.resolution!.payload={toJSON(){call();return payload}}as never;return r},
  hiddenToJSON:(r,call)=>{Object.defineProperty(r.resolution!.payload!,'toJSON',{value(){call();return{}},enumerable:false});return r},
  rootToJSON:(r,call)=>{Object.assign(r,{toJSON(){call();return r}});return r},
  prototypeToJSON:(r,call)=>{Object.setPrototypeOf(r.resolution!.payload!,{toJSON(){call();return{}}});return r},
  customPrototype:(r)=>{Object.setPrototypeOf(r.resolution!.payload!,{extra:'unsupported'});return r},
  nullPrototypeResult:(r)=>{Object.setPrototypeOf(r.resolution!.payload!,null);return r},
  boxedBigint:(r)=>{r.number=Object(1n)as never;return r},
  boxedNumber:(r)=>{r.number=Object(1)as never;return r},
  disguisedBox:(r)=>{const value=Object(1n);Object.setPrototypeOf(value,Object.prototype);r.number=value as never;return r},
  disguisedMap:(r)=>{const value=Object.assign(new Map(),r.resolution!.payload);Object.setPrototypeOf(value,Object.prototype);r.resolution!.payload=value as never;return r},
  disguisedSet:(r)=>{const value=Object.assign(new Set(),r.resolution!.payload);Object.setPrototypeOf(value,Object.prototype);r.resolution!.payload=value as never;return r},
  disguisedRegexp:(r)=>{const value=Object.assign(/x/,r.resolution!.payload);Object.setPrototypeOf(value,Object.prototype);r.resolution!.payload=value as never;return r},
  disguisedKey:(r)=>{const value=Object.assign(createSecretKey(Buffer.alloc(16,7)),r.resolution!.payload);Object.setPrototypeOf(value,Object.prototype);r.resolution!.payload=value as never;return r},
  disguisedCryptoKey:(r)=>{const value=Object.assign(createSecretKey(Buffer.alloc(16,7)).toCryptoKey('AES-GCM',false,['encrypt']),r.resolution!.payload);Object.setPrototypeOf(value,Object.prototype);r.resolution!.payload=value as never;return r},
  disguisedURL:(r)=>{const value=Object.assign(new URL('https://example.invalid'),r.resolution!.payload);Object.setPrototypeOf(value,Object.prototype);r.resolution!.payload=value as never;return r},
  disguisedWeakRef:(r)=>{const value=Object.assign(new WeakRef({}),r.resolution!.payload);Object.setPrototypeOf(value,Object.prototype);r.resolution!.payload=value as never;return r},
  disguisedBuffer:(r)=>{const value=Object.assign(new Uint8Array(),r.resolution!.payload);Object.setPrototypeOf(value,Object.prototype);r.resolution!.payload=value as never;return r},
  coercionHook:(r,call)=>{r.number={[Symbol.toPrimitive](){call();return 1n}}as never;return r},
  dateToJSON:(r,call)=>{Object.defineProperty(r.match.createdAt,'toJSON',{value(){call();return new Date(0).toISOString()}});return r},
  dateSubclass:(r,call)=>{r.match.createdAt=new class extends Date{override toJSON(){call();return new Date(0).toISOString()}}(0);return r},
  fakeDate:(r)=>{r.match.createdAt=Object.create(Date.prototype)as Date;return r},
  invalidDate:(r)=>{r.match.createdAt=new Date(NaN);return r},
  rootGetter:(r,call)=>{const match=r.match;Object.defineProperty(r,'match',{get(){call();return match},enumerable:true});return r},
  statusGetter:(r,call)=>{Object.defineProperty(r,'status',{get(){call();return 'RESOLVED'},enumerable:true});return r},
  configGetter:(r,call)=>{const config=r.match.configuration!.config;Object.defineProperty(r.match.configuration!,'config',{get(){call();return config},enumerable:true});return r},
  runtimeGetter:(r,call)=>{Object.defineProperty(r.match.configuration!,'simulationVersion',{get(){call();return 'movement-resolution-v1'},enumerable:true});return r},
  arrayGetter:(r,call)=>{const player=r.players[0];Object.defineProperty(r.players,'0',{get(){call();return player},enumerable:true});return r},
  mutatingGetter:(r,call)=>{const audits=(r.resolution!.payload as unknown as Record<string,unknown>).audits;Object.defineProperty(r.resolution!.payload!,'audits',{get(){call();r.frozenInput!.seed=0n;return audits},enumerable:true});return r},
  tagGetter:(r,call)=>{Object.defineProperty(r.resolution!.payload!,Symbol.toStringTag,{get(){call();return 'Object'}});return r},
  rootProxy:(r,call)=>new Proxy(r,{get(){call();throw Error('must not run')},ownKeys(){call();throw Error('must not run')}}),
  nestedProxy:(r,call)=>{r.resolution!.payload=new Proxy(r.resolution!.payload as object,{get(){call();throw Error('must not run')},getPrototypeOf(){call();throw Error('must not run')}})as never;return r},
  prototypeProxy:(r,call)=>{Object.setPrototypeOf(r.resolution!.payload!,new Proxy(Object.prototype,{get(){call();throw Error('must not run')}}));return r},
  revokedProxy:(r)=>{const p=Proxy.revocable(r,{});p.revoke();return p.proxy},
  arrayToJSON:(r,call)=>{Object.assign(r.players,{toJSON(){call();return[]}});return r},
  arrayExtraFunction:(r,call)=>{Object.assign(r.players,{ignored(){call()}});return r},
  sparseArray:(r)=>{delete r.players[0];return r},
  symbolKey:(r)=>{Object.assign(r.resolution!.payload!,{[Symbol('ignored')]:1});return r},
  nonenumerableField:(r)=>{Object.defineProperty(r.resolution!.payload!,'hidden',{value:1});return r},
  undefinedValue:(r)=>{(r.resolution!.payload as unknown as Record<string,unknown>).seed=undefined;return r},
  nanValue:(r)=>{(r.resolution!.payload as unknown as Record<string,unknown>).seed=NaN;return r},
  infinityValue:(r)=>{(r.resolution!.payload as unknown as Record<string,unknown>).seed=Infinity;return r},
  cycle:(r)=>{(r.resolution!.payload as unknown as Record<string,unknown>).cycle=r.resolution!.payload;return r}
 };
 it.each(Object.keys(cases))('rejects %s in cold and warm paths without executing input hooks',name=>{
  const f=fixture(true),valid=f.resolved(),called=vi.fn();
  for(const warm of [false,true]){
   clearMovementRestorationCache();if(warm)restoreStoredTurn(structuredClone(valid));
   const malformed=cases[name]!(structuredClone(valid),called);
   expect(()=>restoreStoredTurn(malformed)).toThrowError(expect.objectContaining({code:'invalid_storage'}));
  }
  expect(called).not.toHaveBeenCalled();
 });
 it('detects caller mutations after reuse without mutating or poisoning the cached payload',()=>{
  clearMovementRestorationCache();const f=fixture(true),r=f.resolved(),a=restoreStoredTurn(r);
  if(a.kind!=='movement_resolution')throw Error('fixture');const saved=JSON.stringify(a.result);
  const payload=r.resolution!.payload as unknown as {audits:{remaining:number}[]};payload.audits[0]!.remaining--;
  expect(()=>restoreStoredTurn(r)).toThrow();expect(JSON.stringify(a.result)).toBe(saved);
  expect(restoreStoredTurn(f.resolved())).toMatchObject({result:f.result});
 });
 it('hashes equal shared data by value while retaining native Date/string distinctions',()=>{
  clearMovementRestorationCache();const f=fixture(),r=f.resolved(),a=restoreStoredTurn(r),shared=structuredClone(r);
  shared.resolution!.recordedAt=shared.match.createdAt!;
  const b=restoreStoredTurn(shared);if(a.kind!=='movement_resolution'||b.kind!=='movement_resolution')throw Error('fixture');expect(b.result).toBe(a.result);
  const changed=structuredClone(r);changed.match.createdAt=changed.match.createdAt!.toISOString()as unknown as Date;
  const c=restoreStoredTurn(changed);if(c.kind!=='movement_resolution')throw Error('fixture');
  expect(c.result).not.toBe(a.result);expect(c.result).toEqual(a.result);
 });
});

 it('isolates fully valid matches even when actors and order IDs are reused',()=>{
  clearMovementRestorationCache();const f=fixture(true),g=fixture(true,'second-match'),a=restoreStoredTurn(f.resolved()),b=restoreStoredTurn(g.resolved());
  if(a.kind!=='movement_resolution'||b.kind!=='movement_resolution')throw Error('fixture');
  expect(b.result).not.toBe(a.result);expect(b.result!.resolutionId).not.toBe(a.result!.resolutionId);
  expect(ownResolutionView(a,'p00')).toMatchObject({matchId:f.row.matchId,formation:{formationId:f.plan.snapshot.formations[0]!.formationId}});
  expect(ownResolutionView(b,'p00')).toMatchObject({matchId:'second-match',formation:{formationId:g.plan.snapshot.formations[0]!.formationId}});
  expect(restoreStoredTurn(f.resolved())).toMatchObject({result:f.result});
 });
