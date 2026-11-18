import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient, LobbyRepository, testDatabaseUrl, MovementDraftRepository, FormationReadRepository, TurnClosureRepository, TurnReadRepository, LoopRepository } from "@strategy-game/database";
import { EUROPE_RUNTIME } from "@strategy-game/shared-types/server";
import { lobbyFixture, settings } from "./lobby-fixture.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("Europe production signed commands/history (separately approved fresh hosted CI only)", () => {
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
    f = await lobbyFixture(new Accounts(client), new Lobbies(client, undefined, Date.now, EUROPE_RUNTIME), undefined, undefined, new TurnReadRepository(client), new FormationReadRepository(client), new MovementDraftRepository(client), new TurnClosureRepository(client), new LoopRepository(client));
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




 it('uses two real signed sessions through Europe land movement, Ready andTurn4',async()=>{
  const g=await fresh(),repo=new LoopRepository(client),current=async(member:typeof g.host)=>(await f.request(member,'GET',`/api/matches/${g.id}/loop/current`)).json();
  const initial=await current(g.host),form=initial.formations[0],destination={x:form.position.x,y:form.position.y+10};
  expect(initial.schemaVersion).toBe(2);expect(initial.profile.maskId).toBe('europe-ne10m-surface-v2');
  const order={schemaVersion:2,profile:initial.profile,turnNumber:1,expectedRevision:0,kind:'replace_orders',orders:[{orderId:'land-http',type:'move',stackId:form.formationId,destination}]};
  expect((await f.request(g.host,'POST',path(g.id,1),order)).statusCode).toBe(200);
  for(let n=1;n<=3;n++){
   for(const member of [g.host,g.guest]){const v=await current(member);expect((await f.request(member,'POST',path(g.id,n),{schemaVersion:2,profile:v.profile,turnNumber:n,expectedRevision:v.own.revision,kind:'set_ready',ready:true})).statusCode).toBe(200)}
   expect(await repo.resolveClosed(g.id,15000)).toBe(true);
   const h=await f.request(g.host,'GET',`/api/matches/${g.id}/loop/turns/${n}/aftermath`);expect(h.statusCode).toBe(200);expect(h.json().schemaVersion).toBe(2);expect(h.body).not.toMatch(/seed|auditJson|worldRef|relationships|lastObserved/);
  }
  const final=await current(g.host);expect(final.turn.turnNumber).toBe(4);expect(final.formations[0].position).toEqual(destination);expect(final.own).toEqual({revision:0,ready:false,orders:[]});
  expect((await f.request(g.host,'POST',path(g.id,1),order)).statusCode).toBe(409);
  const outsider=await login();expect((await f.request(outsider,'GET',`/api/matches/${g.id}/loop/current`)).statusCode).toBe(404);
  await client.authSession.updateMany({where:{identityId:g.host.identityId},data:{revokedAt:new Date()}});expect((await f.request(g.host,'GET',`/api/matches/${g.id}/loop/current`)).statusCode).toBe(401);
 },120000);
});
