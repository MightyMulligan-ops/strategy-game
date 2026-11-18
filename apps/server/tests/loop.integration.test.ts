import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient, LobbyRepository, testDatabaseUrl, MovementDraftRepository, FormationReadRepository, TurnClosureRepository, TurnReadRepository, LoopRepository } from "@strategy-game/database";
import { LOOP_RUNTIME } from "@strategy-game/shared-types/server";
import { lobbyFixture, settings } from "./lobby-fixture.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("production repeating turn commands/history (separately approved fresh hosted CI only)", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let f: Awaited<ReturnType<typeof lobbyFixture>>;
  const matches = new Set<string>(), identities = new Set<string>(), sessions = new Set<string>(), attempts = new Set<string>();
  let address = 0;
  class Accounts extends AuthRepository {
    override async signIn(...args: Parameters<AuthRepository["signIn"]>) {
      const user = await super.signIn(...args); identities.add(user.id); return user;
    }
    override async createSession(...args: Parameters<AuthRepository["createSession"]>) {
      sessions.add(args[0]); return super.createSession(...args);
    }
    override async createAttempt(...args: Parameters<AuthRepository["createAttempt"]>) {
      attempts.add(args[0].state); return super.createAttempt(...args);
    }
  }
  class Lobbies extends LobbyRepository {
    override async createLobby(...args: Parameters<LobbyRepository["createLobby"]>) {
      const lobby = await super.createLobby(...args); matches.add(lobby.lobbyId); return lobby;
    }
  }
  beforeAll(async () => {
    if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Only the approved fresh hosted CI service may run this suite; no local DB execution");
    client = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL)); await client.$connect();
  });
  beforeEach(async () => {
    address = 0;
    f = await lobbyFixture(new Accounts(client), new Lobbies(client, undefined, Date.now, LOOP_RUNTIME), undefined, undefined, new TurnReadRepository(client), new FormationReadRepository(client), new MovementDraftRepository(client), new TurnClosureRepository(client), new LoopRepository(client));
  });
  afterEach(async () => {
    if (f) await f.app.close();
    if (!client) return;
    // Only this suite's fresh fixtures; initialized children use the existing parent cascade.
    await client.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { id: { in: [...matches] } } });
      await tx.oAuthAttempt.deleteMany({ where: { state: { in: [...attempts] } } });
      await tx.authSession.deleteMany({ where: { id: { in: [...sessions] } } });
      await tx.oAuthAccount.deleteMany({ where: { identityId: { in: [...identities] } } });
      await tx.playerIdentity.deleteMany({ where: { id: { in: [...identities] }, participants: { none: {} }, hostedMatches: { none: {} } } });
    });
    matches.clear(); identities.clear(); sessions.clear(); attempts.clear();
  });
  afterAll(async () => { if (client) await client.$disconnect(); });
  const login = (complete = true) => f.login(complete ? `U${randomUUID().replaceAll("-", "").slice(0, 20)}` : null, randomUUID(), `192.0.2.${++address}`);
  const path = (id:string,n:number) => `/api/matches/${id}/loop/turns/${n}/commands`;
  async function fresh() {
    const host = await login(), guest = await login();
    const created = await f.request(host, "POST", "/api/lobbies", { schemaVersion: 1, settings });
    expect(created.statusCode).toBe(201); const id = created.json().lobby.lobbyId as string;
    expect((await f.request(guest, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })).statusCode).toBe(200);
    for (const member of [host, guest]) expect((await f.request(member, "POST", `/api/lobbies/${id}/ready`, { schemaVersion: 1, ready: true })).statusCode).toBe(200);
    expect((await f.request(host, "POST", `/api/lobbies/${id}/start`, { schemaVersion: 1 })).statusCode).toBe(200);
    return { host, guest, id };
  }



 it('executes signedReady→resolution→fresh planning throughTurn4 with bounded own history',async()=>{
  const g=await fresh(),repo=new LoopRepository(client);
  for(let n=1;n<=3;n++){
   for(const member of [g.host,g.guest]){const current=await f.request(member,'GET',`/api/matches/${g.id}/loop/current`);expect(current.statusCode).toBe(200);expect(current.json().turn.turnNumber).toBe(n);const ready=await f.request(member,'POST',path(g.id,n),{schemaVersion:1,turnNumber:n,expectedRevision:0,kind:'set_ready',ready:true});expect(ready.statusCode).toBe(200)}
   expect(await repo.resolveClosed(g.id,15000)).toBe(true);
   const history=await f.request(g.host,'GET',`/api/matches/${g.id}/loop/turns/${n}/aftermath`);expect(history.statusCode).toBe(200);expect(history.json().turnNumber).toBe(n);expect(history.headers['cache-control']).toBe('no-store');expect(history.body).not.toMatch(/seed|auditJson|worldRef|lastObserved/);
  }
  const current=await f.request(g.host,'GET',`/api/matches/${g.id}/loop/current`);expect(current.json().turn.turnNumber).toBe(4);expect(current.json().own).toEqual({revision:0,ready:false,orders:[]});
  const stale=await f.request(g.host,'POST',path(g.id,1),{schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true});expect(stale.statusCode).toBe(409);expect(stale.json().error).toBe('WRONG_TURN');
  const before=await client.match.findUniqueOrThrow({where:{id:g.id}});await f.request(g.host,'GET',`/api/matches/${g.id}/loop/current`);expect(await client.match.findUniqueOrThrow({where:{id:g.id}})).toEqual(before);
 },60000);
 it('rejects outsiders, revoked sessions, unbounded history and missing CSRF without mutation',async()=>{
  const g=await fresh(),outsider=await login(),url=`/api/matches/${g.id}/loop/current`;
  expect((await f.request(outsider,'GET',url)).statusCode).toBe(404);
  expect((await f.request(g.host,'GET',`/api/matches/${g.id}/loop/turns/1/aftermath?limit=1000`)).statusCode).toBe(400);
  const r=await f.app.inject({method:'POST',url:path(g.id,1),headers:{cookie:g.host.cookie,origin:'http://127.0.0.1:5173'},payload:{schemaVersion:1,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true}});expect(r.statusCode).toBe(403);
  expect((await new LoopRepository(client).current(g.id,g.host.identityId)).own.revision).toBe(0);
  await client.authSession.updateMany({where:{identityId:g.host.identityId},data:{revokedAt:new Date()}});expect((await f.request(g.host,'GET',url)).statusCode).toBe(401);
 },30000);
});
