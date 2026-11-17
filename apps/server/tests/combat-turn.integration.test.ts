import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient, LobbyRepository, testDatabaseUrl, MovementDraftRepository, FormationReadRepository, TurnClosureRepository, TurnReadRepository, MovementResolutionRepository } from "@strategy-game/database";
import { COMBAT_TURN_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { lobbyFixture, settings } from "./lobby-fixture.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("production combat aftermath reads (separately approved fresh hosted CI only)", () => {
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
    f = await lobbyFixture(new Accounts(client), new Lobbies(client, undefined, Date.now, COMBAT_TURN_RUNTIME_PROFILE), undefined, undefined, new TurnReadRepository(client), new FormationReadRepository(client), new MovementDraftRepository(client), new TurnClosureRepository(client));
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
  const path = (id: string) => `/api/matches/${id}/turns/1/orders`;
  async function fresh() {
    const host = await login(), guest = await login();
    const created = await f.request(host, "POST", "/api/lobbies", { schemaVersion: 1, settings });
    expect(created.statusCode).toBe(201); const id = created.json().lobby.lobbyId as string;
    expect((await f.request(guest, "POST", `/api/lobbies/${id}/join`, { schemaVersion: 1 })).statusCode).toBe(200);
    for (const member of [host, guest]) expect((await f.request(member, "POST", `/api/lobbies/${id}/ready`, { schemaVersion: 1, ready: true })).statusCode).toBe(200);
    expect((await f.request(host, "POST", `/api/lobbies/${id}/start`, { schemaVersion: 1 })).statusCode).toBe(200);
    return { host, guest, id };
  }


 it('returns own-only persisted aftermath through a real signed session and never mutates on GET',async()=>{
  const g=await fresh();for(const member of[g.host,g.guest])expect((await f.request(member,'POST',path(g.id).replace('orders','ready'),{schemaVersion:1,expectedRevision:0,ready:true})).statusCode).toBe(200);
  const endpoint=`/api/matches/${g.id}/turns/1/aftermath`;
  expect((await f.request(g.host,'GET',endpoint)).json().state).toBe('WAITING');await new MovementResolutionRepository(client).resolveClosed(g.id,15000);
  const before=await client.resolutionResult.findUniqueOrThrow({where:{matchId_turnNumber:{matchId:g.id,turnNumber:1n}}});
  const r=await f.request(g.host,'GET',endpoint);expect(r.statusCode).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(r.json()).toMatchObject({schemaVersion:2,state:'RESOLVED',battles:[]});
  expect(r.body).not.toMatch(/worldSeed|resolutionSeed|runtimeProfile|auditJson|rounds|contacts|sequence/);
  expect((await f.request(g.host,'GET',`/api/matches/${g.id}/formations`)).json()).toMatchObject({schemaVersion:3,state:'READY',collisionRadius:10,pendingEncounter:false});
  expect((await f.request(g.host,'GET',endpoint)).json()).toEqual(r.json());expect(await client.resolutionResult.findUniqueOrThrow({where:{matchId_turnNumber:{matchId:g.id,turnNumber:1n}}})).toEqual(before);
  expect((await f.request(g.host,'POST',endpoint,{})).statusCode).toBe(404);
 },30000);
 it('denies outsiders/onboarding/revoked sessions before aftermath access',async()=>{
  const g=await fresh(),endpoint=`/api/matches/${g.id}/turns/1/aftermath`,outsider=await login(),incomplete=await login(false);
  expect((await f.request(outsider,'GET',endpoint)).statusCode).toBe(404);expect((await f.request(incomplete,'GET',endpoint)).statusCode).toBe(403);
  await client.authSession.updateMany({where:{identityId:g.host.identityId},data:{revokedAt:new Date()}});expect((await f.request(g.host,'GET',endpoint)).statusCode).toBe(401);
  expect(await client.resolutionResult.count({where:{matchId:g.id}})).toBe(0);
 },30000);
});
