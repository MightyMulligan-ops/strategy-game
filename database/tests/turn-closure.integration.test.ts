import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TURN_CLOSURE_RUNTIME_PROFILE, MOVEMENT_DRAFT_RUNTIME_PROFILE, INITIAL_ARMIES_RUNTIME_PROFILE, INITIAL_WORLD_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { generateWorld } from "@strategy-game/game-engine";
import { createDatabaseClient, LobbyRepository, MatchRepository, MovementDraftRepository, FormationReadRepository, TurnClosureRepository, TurnReadRepository } from "../src/index.js";
import { testDatabaseUrl } from "../src/environment.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("turn closure (separately approved fresh hosted PostgreSQL only)", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  const matches: string[] = [], accounts: string[] = [];
  beforeAll(async () => {
    if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Fresh hosted CI authorization required; no local database execution");
    client = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL)); await client.$connect();
  });
  afterEach(async () => {
    if (!client) return;
    await client.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { id: { in: matches } } });
      await tx.playerIdentity.deleteMany({ where: { id: { in: accounts }, participants: { none: {} }, hostedMatches: { none: {} } } });
    }); matches.length = 0; accounts.length = 0;
  });
  afterAll(async () => { if (client) await client.$disconnect(); });
  async function account() {
    const id = randomUUID(); accounts.push(id); const username = `U${id.replaceAll("-", "").slice(0, 20)}`;
    await client.playerIdentity.create({ data: { id, username, usernameKey: username.toLowerCase() } }); return id;
  }
  async function fresh(count = 2, runtime: unknown = TURN_CLOSURE_RUNTIME_PROFILE, duration = 300_000, openingClock: () => number = Date.now) {
    const world = (players: readonly string[]) => {
      const result = generateWorld({ schemaVersion: 1, generatorVersion: "territory-grid-v1", seed: 123, players, settings: { regionSide: 5 } });
      if (!result.ok) throw new Error("Fixture world failed"); return result.world;
    };
    const lobbies = new LobbyRepository(client, world, openingClock, runtime);
    const host = await account(), lobby = await lobbies.createLobby(host, { name: "Movement drafts", playerCapacity: 40, turnDurationMs: duration, visibility: "PUBLIC" });
    const id = lobby.lobbyId; matches.push(id); const members = [host];
    for (let i = 1; i < count; i++) { const identity = await account(); members.push(identity); await lobbies.joinLobby(id, identity); }
    for (const member of members) await lobbies.setReady(id, member, true);
    await lobbies.startLobby(id, host);
    const projected = await new FormationReadRepository(client).getFormations(id, host);
    if (projected.state !== "READY") throw new Error("Missing own formation");
    const formation = projected.formations[0]!, dir = formation.position.x < 500 ? 1 : -1;
    const order = (name: string, offset: number) => ({ type: "move" as const, orderId: name, stackId: formation.formationId, destination: { x: formation.position.x + dir * offset, y: formation.position.y } });
    const repo = new MovementDraftRepository(client), closure = new TurnClosureRepository(client);
    const submit = (orders: ReturnType<typeof order>[], expectedRevision = 0) => repo.submitDraft(id, 1, host, { schemaVersion: 1, kind: "replace_orders", expectedRevision, orders });
    const ready = (revision = 0, value = true, actor = host) => closure.setReady(id, 1, actor, { schemaVersion: 1, expectedRevision: revision, ready: value });
    return { id, host, members, lobbies, formation, order, repo, closure, ready, submit };
  }
  const inspect = (id: string) => client.match.findUniqueOrThrow({ where: { id }, include: { configuration: true, world: true, snapshots: true,
    turns: { include: { players: { include: { orders: true, revisions: true } }, frozenInput: true, resolution: true } } } });
  it.each([2,4,10,40])("initializes/restores %i players with v5 identity and unchanged world/armies",async(count)=>{
    const f=await fresh(count),before=await inspect(f.id),stored=await new MatchRepository(client).loadTurn(f.id,1);
    expect(stored.kind).toBe("turn_closure");expect(before.snapshots[0]).toMatchObject({stateVersion:0n,payload:{schemaVersion:5,kind:"turn_closure",simulationVersion:"turn-closure-v1"}});
    expect(before.turns[0]!.players).toHaveLength(count);
    expect(before.turns[0]!.players.every(p=>p.revision===0n&&!p.ready&&p.orders.length===0&&p.revisions.length===1)).toBe(true);
    await f.submit([f.order("stable",250)]);await f.ready(1);await f.ready(2,false);
    const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {const own=await new MovementDraftRepository(second).getDraft(f.id,1,f.host);expect(own).toMatchObject({schemaVersion:2,own:{revision:3,ready:false}});if(own.state==="READY")expect(own.route.remaining).toBe(0)}finally{await second.$disconnect()}
    const after=await inspect(f.id);expect(after.world).toEqual(before.world);expect(after.snapshots).toEqual(before.snapshots);expect(after.configuration).toEqual(before.configuration);
  },30_000);
  it("closes on final Ready, stores every empty queue exactly once and never resolves/advances",async()=>{
    const f=await fresh();await f.ready();const result=await f.ready(0,true,f.members[1]!);
    expect(result.turn).toMatchObject({status:"closed",closeReason:"all_ready"});
    const before=await inspect(f.id);expect(before.turns[0]!.frozenInput).toMatchObject({seed:null,payload:{schemaVersion:2,kind:"turn_closure",players:expect.arrayContaining([expect.objectContaining({revision:1,ready:true,orders:[]})])}});
    expect(await client.frozenTurnInputRecord.count({where:{matchId:f.id}})).toBe(1);
    await expect(f.ready(1,false)).rejects.toMatchObject({code:"TURN_CLOSED"});expect(await f.closure.closeDue(f.id)).toBe(false);expect(await inspect(f.id)).toEqual(before);
    expect((await new TurnReadRepository(client).getTurn(f.id,f.host))).toMatchObject({state:"READY",turn:{status:"closed"},own:{ready:true}});
    const old=new MatchRepository(client);await expect(old.prepareResolution(f.id,1,1)).rejects.toMatchObject({code:"unsupported_runtime_operation"});
  });
  it("preserves rows through Ready/Unready and rejects duplicate, stale and locked edits without mutation",async()=>{
    const f=await fresh();await f.submit([f.order("a",100)]);await f.ready(1);const before=await inspect(f.id);
    await expect(f.submit([],2)).rejects.toMatchObject({code:"READY_LOCKED"});await expect(f.ready(2)).rejects.toMatchObject({code:"READY_UNCHANGED"});await expect(f.ready(1,false)).rejects.toMatchObject({code:"STALE_REVISION"});expect(await inspect(f.id)).toEqual(before);
    await f.ready(2,false);expect((await inspect(f.id)).turns[0]!.players.find(p=>p.ready)).toBeUndefined();await f.submit([],3);
    expect((await new MatchRepository(client).loadTurn(f.id,1)).state.drafts.find(p=>p.playerId===f.formation.ownerPlayerId)).toMatchObject({revision:4,ready:false,orders:[]});
  });
  it.each(["ready","draft"])("commits exact-deadline closure independently of rejected late %s",async(kind)=>{
    const f=await fresh();await f.submit([f.order("last",100)]);const before=await inspect(f.id),deadline=Number(before.turns[0]!.deadlineAtMs),repo=new TurnClosureRepository(client,()=>deadline);
    await expect(kind==="ready"?repo.setReady(f.id,1,f.host,{schemaVersion:1,expectedRevision:1,ready:true}):repo.mutate(f.id,1,f.host,{schemaVersion:1,expectedRevision:1,kind:"replace_orders",orders:[]})).rejects.toMatchObject({code:"TURN_CLOSED"});
    const after=await inspect(f.id);expect(after.turns[0]).toMatchObject({status:"CLOSED",closedAtMs:BigInt(deadline),closeReason:"DEADLINE"});
    const frozen=after.turns[0]!.frozenInput!.payload as {players:{revision:number;ready:boolean;orders:unknown[]}[]};expect(frozen.players.map(p=>p.ready)).toEqual([false,false]);expect(frozen.players.flatMap(p=>p.orders)).toEqual([f.order("last",100)]);
    expect((await new MatchRepository(client).loadTurn(f.id,1)).kind).toBe("turn_closure");
  });
  it.each(["Ready-Ready","Ready-Unready","Ready-draft","worker-Ready","worker-worker","deadline-late"])("serializes competing %s across independent connections",async(kind)=>{
    const f=await fresh(),second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL)),row=(await inspect(f.id)).turns[0]!,deadline=Number(row.deadlineAtMs);
    const other=new TurnClosureRepository(second,kind.startsWith("worker")||kind==="deadline-late"?()=>deadline:Date.now);
    try {
      let actions:Promise<unknown>[];
      if(kind==="Ready-Ready")actions=[f.ready(),other.setReady(f.id,1,f.host,{schemaVersion:1,expectedRevision:0,ready:true})];
      else if(kind==="Ready-Unready"){await f.ready();actions=[f.ready(1,false),other.setReady(f.id,1,f.host,{schemaVersion:1,expectedRevision:1,ready:true})]}
      else if(kind==="Ready-draft")actions=[f.ready(),other.mutate(f.id,1,f.host,{schemaVersion:1,expectedRevision:0,kind:"replace_orders",orders:[]})];
      else if(kind==="worker-worker")actions=[new TurnClosureRepository(client,()=>deadline).closeDue(f.id),other.closeDue(f.id)];
      else actions=[other.closeDue(f.id),new TurnClosureRepository(client,()=>deadline).setReady(f.id,1,f.host,{schemaVersion:1,expectedRevision:0,ready:true})];
      const results=await Promise.allSettled(actions);
      if(kind==="Ready-Ready"||kind==="Ready-draft")expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
      if(kind.startsWith("worker")||kind==="deadline-late"){expect(await client.frozenTurnInputRecord.count({where:{matchId:f.id}})).toBe(1);expect((await inspect(f.id)).turns[0]!.closeReason).toBe("DEADLINE")}
      expect((await new MatchRepository(second).loadTurn(f.id,1)).kind).toBe("turn_closure");
    }finally{await second.$disconnect()}
  });
  it.each(["PlayerSubmissionRevision","PlayerTurnState","Turn","FrozenTurnInputRecord"])("rolls final-Ready closure completely back on injected %s failure",async(table)=>{
    const f=await fresh();await f.ready();const before=await inspect(f.id),name=`fixture_${randomUUID().replaceAll("-","")}`;
    const condition=table==="Turn"?'"status"=\'OPEN\'':table==="FrozenTurnInputRecord"?'false':'"revision"=0';
    // Exclude already-Ready host for player/history injection; final actor must fail.
    const actor=(await client.matchParticipant.findUniqueOrThrow({where:{matchId_identityId:{matchId:f.id,identityId:f.members[1]!}}})).playerId;
    const scope=table==="Turn"||table==="FrozenTurnInputRecord"?`"matchId"<>'${f.id}'`:`("matchId"<>'${f.id}' OR "playerId"<>'${actor}')`;
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${scope} OR ${condition}) NOT VALID`);
    try{await expect(f.ready(0,true,f.members[1]!)).rejects.toMatchObject({code:"INTERNAL_ERROR"});expect(await inspect(f.id)).toEqual(before)}finally{await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`)}
  });
  it.each(["update","delete","reassign","seed"])("rejects frozen %s through intended immutability guard",async(kind)=>{
    const f=await fresh();await f.ready();await f.ready(0,true,f.members[1]!);const before=await inspect(f.id);
    const action=kind==="delete"?client.frozenTurnInputRecord.deleteMany({where:{matchId:f.id}}):client.frozenTurnInputRecord.updateMany({where:{matchId:f.id},data:kind==="reassign"?{matchId:randomUUID()}:kind==="seed"?{seed:1n}:{payload:{}}});
    await expect(action).rejects.toThrow(kind==="reassign"?"Closure records cannot change parent":"Closure frozen input is insert-once immutable");expect(await inspect(f.id)).toEqual(before);
  });
  it.each(["world-update","world-delete","snapshot-update","snapshot-delete","turn-delete","turn-resolve","turn-two","version","history-delete","ready-bypass","frozen-open","mismatch"])("rejects %s via authoritative guards",async(kind)=>{
    const f=await fresh(),before=await inspect(f.id),t=before.turns[0]!;
    let action:Promise<unknown>,message:string;
    if(kind==="world-update"){action=client.matchWorld.updateMany({where:{matchId:f.id},data:{seed:123n}});message="Closure world and snapshot are immutable"}
    else if(kind==="world-delete"){action=client.matchWorld.deleteMany({where:{matchId:f.id}});message="Closure world and snapshot are immutable"}
    else if(kind==="snapshot-update"){action=client.gameSnapshotRecord.updateMany({where:{matchId:f.id},data:{snapshotId:before.snapshots[0]!.snapshotId}});message="Closure world and snapshot are immutable"}
    else if(kind==="snapshot-delete"){action=client.gameSnapshotRecord.deleteMany({where:{matchId:f.id}});message="Closure world and snapshot are immutable"}
    else if(kind==="turn-delete"){action=client.turn.deleteMany({where:{matchId:f.id}});message="Closure Turn is immutable"}
    else if(kind==="turn-resolve"){action=client.turn.updateMany({where:{matchId:f.id},data:{status:"RESOLVING"}});message="Closure Turn cannot reopen, resolve or advance"}
    else if(kind==="turn-two"){action=client.turn.create({data:{matchId:f.id,number:2n,startingStateVersion:0n,status:"OPEN",openedAtMs:t.openedAtMs,deadlineAtMs:t.deadlineAtMs,lastObservedAtMs:t.openedAtMs}});message="Only initial OPEN Turn 1 allowed"}
    else if(kind==="version"){action=client.match.update({where:{id:f.id},data:{currentStateVersion:1n}});message="Closure match cannot change identity, advance or reopen"}
    else if(kind==="history-delete"){action=client.playerSubmissionRevision.deleteMany({where:{matchId:f.id}});message="Closure history/draft deletion prohibited"}
    else if(kind==="ready-bypass"){action=client.playerTurnState.updateMany({where:{matchId:f.id},data:{ready:true}});message="Closure CAS requires next history"}
    else if(kind==="frozen-open"){action=client.frozenTurnInputRecord.create({data:{matchId:f.id,turnNumber:1n,payload:{}}});message="Frozen input must match authoritative closed turn"}
    else{action=client.$transaction(async(tx)=>{await tx.turn.updateMany({where:{matchId:f.id},data:{status:"CLOSED",lastObservedAtMs:t.deadlineAtMs,closedAtMs:t.deadlineAtMs,closeReason:"DEADLINE"}});await tx.frozenTurnInputRecord.create({data:{matchId:f.id,turnNumber:1n,payload:{}}})});message="Frozen input must match authoritative closed turn"}
    await expect(action).rejects.toThrow(message);expect(await inspect(f.id)).toEqual(before);
  });
  it("requires a matching frozen record at deferred closure commit",async()=>{
    const f=await fresh(),before=await inspect(f.id),t=before.turns[0]!;
    await expect(client.turn.updateMany({where:{matchId:f.id},data:{status:"CLOSED",lastObservedAtMs:t.deadlineAtMs,closedAtMs:t.deadlineAtMs,closeReason:"DEADLINE"}})).rejects.toThrow("CLOSED requires exactly one matching immutable frozen input");expect(await inspect(f.id)).toEqual(before);
  });
  it("authorizes active participant before lifecycle observation and preserves privacy",async()=>{
    const f=await fresh(),outsider=await account(),before=await inspect(f.id);
    await expect(f.ready(0,true,outsider)).rejects.toMatchObject({code:"NOT_FOUND"});expect(await inspect(f.id)).toEqual(before);
    await f.submit([f.order("private-order",100)]);const view=await f.repo.getDraft(f.id,1,f.members[1]!);
    expect(JSON.stringify(view)).not.toMatch(/private-order|snapshotId|runtimeProfile|worldSeed|identityId/);
  });
  it.each([INITIAL_WORLD_RUNTIME_PROFILE,INITIAL_ARMIES_RUNTIME_PROFILE,MOVEMENT_DRAFT_RUNTIME_PROFILE])("does not grant closure to historical $simulationVersion",async(runtime)=>{
    // initial-world has no formation; use lobby directly through the existing helper only for army profiles.
    const world=(players:readonly string[])=>{const r=generateWorld({schemaVersion:1,generatorVersion:"territory-grid-v1",seed:123,players,settings:{regionSide:5}});if(!r.ok)throw Error("fixture");return r.world};
    const repo=new LobbyRepository(client,world,Date.now,runtime),a=await account(),b=await account(),l=await repo.createLobby(a,{name:"Historical",playerCapacity:2,turnDurationMs:300000,visibility:"PUBLIC"});matches.push(l.lobbyId);
    await repo.joinLobby(l.lobbyId,b);await repo.setReady(l.lobbyId,a,true);await repo.setReady(l.lobbyId,b,true);await repo.startLobby(l.lobbyId,a);
    const before=await inspect(l.lobbyId);await expect(new TurnClosureRepository(client).setReady(l.lobbyId,1,a,{schemaVersion:1,expectedRevision:0,ready:true})).rejects.toMatchObject({code:"UNSUPPORTED_RUNTIME"});expect(await new TurnClosureRepository(client).closeDue(l.lobbyId)).toBe(false);expect(await inspect(l.lobbyId)).toEqual(before);
  });
  it("SQL expiry rolls back the late candidate and independently commits deadline closure", async()=>{
    const f=await fresh(2,TURN_CLOSURE_RUNTIME_PROFILE,1,()=>Date.now()-10000),before=await inspect(f.id);
    await expect(new TurnClosureRepository(client,()=>Number(before.turns[0]!.openedAtMs)).setReady(f.id,1,f.host,{schemaVersion:1,expectedRevision:0,ready:true})).rejects.toMatchObject({code:"TURN_CLOSED"});
    const after=await inspect(f.id);expect(after.turns[0]).toMatchObject({status:"CLOSED",closeReason:"DEADLINE"});expect(after.turns[0]!.players.every(p=>p.revision===0n&&!p.ready)).toBe(true);
  });
  it("worker versus final Ready preserves whichever closure serialized first",async()=>{
    const f=await fresh();await f.ready();const deadline=Number((await inspect(f.id)).turns[0]!.deadlineAtMs),second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try{await Promise.allSettled([f.ready(0,true,f.members[1]!),new TurnClosureRepository(second,()=>deadline).closeDue(f.id)]);
      const stored=await new MatchRepository(client).loadTurn(f.id,1);expect(stored.state.turn.status).toBe("closed");expect(await client.frozenTurnInputRecord.count({where:{matchId:f.id}})).toBe(1);
      const before=await inspect(f.id);expect(await new TurnClosureRepository(second,()=>deadline+1).closeDue(f.id)).toBe(false);expect(await inspect(f.id)).toEqual(before);
    }finally{await second.$disconnect()}
  });
  it("bounded persisted scans catch up after restart and parent cascade removes closed archive",async()=>{
    const a=await fresh(2,TURN_CLOSURE_RUNTIME_PROFILE,1,()=>Date.now()-10000),b=await fresh(2,TURN_CLOSURE_RUNTIME_PROFILE,1,()=>Date.now()-10000);
    const restarted=new TurnClosureRepository(client);const first=await restarted.dueMatches(1);expect(first).toHaveLength(1);expect([a.id,b.id]).toContain(first[0]);await restarted.closeDue(first[0]!);
    const next=await restarted.dueMatches(1);expect(next).toHaveLength(1);expect(next[0]).not.toBe(first[0]);await restarted.closeDue(next[0]!);expect(await restarted.dueMatches(1)).toEqual([]);
    await client.match.delete({where:{id:a.id}});expect(await client.frozenTurnInputRecord.count({where:{matchId:a.id}})).toBe(0);expect(await client.turn.count({where:{matchId:a.id}})).toBe(0);
  });
});
