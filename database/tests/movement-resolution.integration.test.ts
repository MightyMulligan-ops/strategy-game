import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MOVEMENT_RESOLUTION_RUNTIME_PROFILE, TURN_CLOSURE_RUNTIME_PROFILE, MOVEMENT_DRAFT_RUNTIME_PROFILE, INITIAL_ARMIES_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { generateWorld } from "@strategy-game/game-engine";
import { createDatabaseClient, LobbyRepository, MatchRepository, MovementDraftRepository, FormationReadRepository, TurnClosureRepository, TurnReadRepository, MovementResolutionRepository } from "../src/index.js";
import { testDatabaseUrl } from "../src/environment.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("movement resolution (separately approved fresh hosted PostgreSQL only)", () => {
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
  async function fresh(count = 2, runtime: unknown = MOVEMENT_RESOLUTION_RUNTIME_PROFILE, duration = 300_000, openingClock: () => number = Date.now) {
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
    const resolver=new MovementResolutionRepository(client);
    const close=async(hostRevision=0)=>{await ready(hostRevision);for(const member of members.slice(1))await ready(0,true,member)};
    return { id, host, members, lobbies, formation, order, repo, closure, ready, submit,close,resolver };
  }
  const inspect = (id: string) => client.match.findUniqueOrThrow({ where: { id }, include: { configuration: true, world: true, snapshots: true,
    turns: { include: { players: { include: { orders: true, revisions: true } }, frozenInput: true, resolution: true } } } });
  it.each([2,4,10,40])("resolves/restores %i players once with fixed seed and no Turn 2",async(count)=>{
    const f=await fresh(count);await f.submit([f.order("own",250)]);await f.close(1);const before=await inspect(f.id);
    expect(before.turns[0]!.frozenInput!.seed).toBe(before.world!.seed);
    expect(await f.resolver.resolveClosed(f.id,15000)).toBe(true);
    const after=await inspect(f.id);expect(after.currentStateVersion).toBe(1n);expect(after.turns).toHaveLength(1);expect(after.turns[0]!.status).toBe("RESOLVED");
    expect(after.snapshots).toHaveLength(2);expect(after.turns[0]!.resolution).toMatchObject({nextStateVersion:1n,payload:{schemaVersion:2,kind:"movement_resolution",seed:Number(before.world!.seed)}});
    expect(after.world).toEqual(before.world);expect(after.configuration).toEqual(before.configuration);expect(after.turns[0]!.frozenInput).toEqual(before.turns[0]!.frozenInput);
    const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try{
      expect((await new MatchRepository(second).loadTurn(f.id,1)).state.turn.status).toBe("resolved");
      expect(await new MovementResolutionRepository(second).resolveClosed(f.id)).toBe(false);
      expect(await new TurnReadRepository(second).getResolution(f.id,f.host)).toMatchObject({state:"RESOLVED",summary:{completed:1,stopped:0,notExecuted:0,pendingEncounters:0}});
      expect(await new MovementDraftRepository(second).getDraft(f.id,1,f.host)).toMatchObject({schemaVersion:3,turn:{status:"resolved"}});
    }finally{await second.$disconnect()}
    expect(await inspect(f.id)).toEqual(after);
  },30_000);
  it("serializes competing resolver processes without changing seed, result or snapshot",async()=>{
    const f=await fresh();await f.close();const second=createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try{const outcomes=await Promise.all([f.resolver.resolveClosed(f.id),new MovementResolutionRepository(second).resolveClosed(f.id)]);expect(outcomes.sort()).toEqual([false,true]);
      expect(await client.resolutionResult.count({where:{matchId:f.id}})).toBe(1);expect(await client.gameSnapshotRecord.count({where:{matchId:f.id}})).toBe(2);
    }finally{await second.$disconnect()}
  });
  it.each(["GameSnapshotRecord","ResolutionResult","Turn","Match"])("rolls %s failure back to recoverable CLOSED with the same seed",async(table)=>{
    const f=await fresh();await f.close();const before=await inspect(f.id),name=`failure_${randomUUID().replaceAll("-","")}`;
    const column=table==="Match"?'"id"':'"matchId"',condition=table==="GameSnapshotRecord"?'"stateVersion"=0':table==="ResolutionResult"?'false':table==="Turn"?'"status"<>\'RESOLVED\'':'"currentStateVersion"=0';
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${column}<>'${f.id}' OR ${condition}) NOT VALID`);
    try{await expect(f.resolver.resolveClosed(f.id)).rejects.toThrow();expect(await inspect(f.id)).toEqual(before)}finally{await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`)}
    expect(await new MovementResolutionRepository(client).resolveClosed(f.id)).toBe(true);
  });
  it("rejects a dangling RESOLVING commit and catches up from persisted CLOSED scans",async()=>{
    const f=await fresh();await f.close();const before=await inspect(f.id);
    await expect(client.turn.updateMany({where:{matchId:f.id},data:{status:"RESOLVING"}})).rejects.toThrow("RESOLVING cannot commit without atomic result");
    expect(await inspect(f.id)).toEqual(before);expect(await f.resolver.dueMatches(1)).toEqual([f.id]);
    expect(await f.resolver.resolveClosed(f.id)).toBe(true);expect(await f.resolver.dueMatches(1)).toEqual([]);
  });
  it("records contact from opposing routes and redacts all enemy identities/orders from own summaries",async()=>{
    const f=await fresh(),other=await new FormationReadRepository(client).getFormations(f.id,f.members[1]!);if(other.state!=="READY")throw Error("missing");
    const enemy=other.formations[0]!,mid={x:(f.formation.position.x+enemy.position.x)/2,y:(f.formation.position.y+enemy.position.y)/2};
    await f.repo.submitDraft(f.id,1,f.host,{schemaVersion:1,expectedRevision:0,kind:"replace_orders",orders:[{orderId:"host-private",type:"move",stackId:f.formation.formationId,destination:mid}]});
    await f.repo.submitDraft(f.id,1,f.members[1]!,{schemaVersion:1,expectedRevision:0,kind:"replace_orders",orders:[{orderId:"enemy-private",type:"move",stackId:enemy.formationId,destination:mid}]});
    await f.ready(1);await f.ready(1,true,f.members[1]!);await f.resolver.resolveClosed(f.id);
    const view=await new TurnReadRepository(client).getResolution(f.id,f.host);expect(view.state).toBe("RESOLVED");if(view.state!=="RESOLVED")throw Error("missing");
    expect(view.summary.pendingEncounters).toBe(1);expect(view.audits).toHaveLength(1);expect(view.events.map(e=>e.sequence)).toEqual([0]);
    expect(JSON.stringify(view)).not.toContain(enemy.formationId);expect(JSON.stringify(view)).not.toContain("enemy-private");expect(JSON.stringify(view)).not.toMatch(/resolutionSeed|worldSeed|runtimeProfile|contacts|members/);
    expect(await new TurnReadRepository(client).getResolution(f.id,f.host)).toEqual(view);
    const formations=await new FormationReadRepository(client).getFormations(f.id,f.host);expect(formations).toMatchObject({schemaVersion:2,pendingEncounter:true,collisionRadius:10});
    const outsider=await account();await expect(new TurnReadRepository(client).getResolution(f.id,outsider)).rejects.toMatchObject({code:"NOT_FOUND"});
  });
  it.each(["result-update","result-delete","snapshot-delete","frozen-update","turn-two","world","version"])("rejects prohibited %s with an immutable guard",async(kind)=>{
    const f=await fresh();await f.close();await f.resolver.resolveClosed(f.id);const before=await inspect(f.id);
    const action=()=>kind==="result-update"?client.resolutionResult.updateMany({where:{matchId:f.id},data:{payload:{}}}):kind==="result-delete"?client.resolutionResult.deleteMany({where:{matchId:f.id}}):kind==="snapshot-delete"?client.gameSnapshotRecord.deleteMany({where:{matchId:f.id,stateVersion:1n}}):kind==="frozen-update"?client.frozenTurnInputRecord.updateMany({where:{matchId:f.id},data:{seed:1n}}):kind==="world"?client.matchWorld.updateMany({where:{matchId:f.id},data:{payload:{}}}):kind==="version"?client.match.update({where:{id:f.id},data:{currentStateVersion:2n}}):client.turn.create({data:{matchId:f.id,number:2n,startingStateVersion:1n,status:"OPEN",openedAtMs:0n,deadlineAtMs:300000n,lastObservedAtMs:0n}});
    await expect(action()).rejects.toThrow(/immutable|Immutable|once|initial OPEN|advances once/);expect(await inspect(f.id)).toEqual(before);
  });
  it.each([INITIAL_ARMIES_RUNTIME_PROFILE,MOVEMENT_DRAFT_RUNTIME_PROFILE,TURN_CLOSURE_RUNTIME_PROFILE])("does not resolve historical $simulationVersion",async(runtime)=>{
    const f=await fresh(2,runtime),before=await inspect(f.id);expect(await f.resolver.resolveClosed(f.id)).toBe(false);expect(await inspect(f.id)).toEqual(before);
  });
  it("permits complete parent cleanup of both snapshots and resolved artifacts",async()=>{
    const f=await fresh();await f.close();await f.resolver.resolveClosed(f.id);await client.match.delete({where:{id:f.id}});
    for(const count of [await client.gameSnapshotRecord.count({where:{matchId:f.id}}),await client.resolutionResult.count({where:{matchId:f.id}}),await client.frozenTurnInputRecord.count({where:{matchId:f.id}})])expect(count).toBe(0);
  });
});
