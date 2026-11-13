import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient, LobbyRepository, testDatabaseUrl, MovementDraftRepository, FormationReadRepository, TurnClosureRepository, TurnReadRepository } from "@strategy-game/database";
import { TURN_CLOSURE_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { ClosureMovementReadySchema } from "@strategy-game/shared-types";
import { lobbyFixture, settings } from "./lobby-fixture.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("production turn closure (separately approved fresh hosted CI only)", () => {
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
    f = await lobbyFixture(new Accounts(client), new Lobbies(client, undefined, Date.now, TURN_CLOSURE_RUNTIME_PROFILE), undefined, undefined, new TurnReadRepository(client), undefined, new MovementDraftRepository(client), new TurnClosureRepository(client));
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

  it("uses real persisted sessions and CSRF for Ready locks, Unready and final closure",async()=>{
    const g=await fresh(),readyPath=path(g.id).replace("orders","ready");
    const post=(browser:typeof g.host,revision:number,ready:boolean)=>f.request(browser,"POST",readyPath,{schemaVersion:1,expectedRevision:revision,ready});
    expect((await post(g.host,0,true)).statusCode).toBe(200);
    const locked=await f.request(g.host,"POST",path(g.id),{schemaVersion:1,kind:"replace_orders",expectedRevision:1,orders:[]});expect(locked.json().error).toBe("READY_LOCKED");
    expect((await post(g.host,1,false)).statusCode).toBe(200);expect((await post(g.host,2,true)).statusCode).toBe(200);const final=await post(g.guest,0,true);expect(final.statusCode).toBe(200);expect(final.json().turn.status).toBe("closed");
    const view=ClosureMovementReadySchema.parse((await f.request(g.host,"GET",path(g.id))).json());expect(view.turn.status).toBe("closed");expect(view.own.revision).toBe(3);
    const turn=await f.request(g.host,"GET",`/api/matches/${g.id}/turn`);expect(turn.statusCode).toBe(200);expect(turn.json().turn.status).toBe("closed");
    for(const key of ["players","runtimeProfile","worldSeed","payload","snapshotId","identityId"])expect(JSON.stringify(view)).not.toContain(`"${key}"`);
    expect(await client.frozenTurnInputRecord.count({where:{matchId:g.id}})).toBe(1);
  });
  it("returns a late conflict after persistent deadline closure while GET stays observational",async()=>{
    const g=await fresh(),row=await client.turn.findUniqueOrThrow({where:{matchId_number:{matchId:g.id,number:1n}}});
    // Inject a trusted clock into the production adapter, preserving normal HTTP security.
    await f.app.close();f=await lobbyFixture(new Accounts(client),new Lobbies(client,undefined,Date.now,TURN_CLOSURE_RUNTIME_PROFILE),undefined,undefined,new TurnReadRepository(client),undefined,new MovementDraftRepository(client),new TurnClosureRepository(client,()=>Number(row.deadlineAtMs)));
    const read=await f.request(g.host,"GET",`/api/matches/${g.id}/turn`);expect(read.json().turn.status).toBe("open");expect(await client.frozenTurnInputRecord.count({where:{matchId:g.id}})).toBe(0);
    const late=await f.request(g.host,"POST",path(g.id).replace("orders","ready"),{schemaVersion:1,expectedRevision:0,ready:true});expect(late.statusCode).toBe(409);expect(late.json().error).toBe("TURN_CLOSED");
    expect((await f.request(g.host,"GET",`/api/matches/${g.id}/turn`)).json().turn).toMatchObject({status:"closed",closeReason:"deadline",closedAtMs:Number(row.deadlineAtMs)});
    const outsider=await login();expect((await f.request(outsider,"GET",path(g.id))).statusCode).toBe(404);
  });
});
