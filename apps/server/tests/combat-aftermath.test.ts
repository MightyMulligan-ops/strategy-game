import {afterEach,describe,it,expect,vi} from "vitest";
import type {FastifyInstance} from "fastify";
import {lobbyFixture} from "./lobby-fixture.js";
import {MemoryAuth} from "./memory-auth.js";
import {TurnReadError} from "@strategy-game/database";
import {CombatAftermathSchema} from "@strategy-game/shared-types";
const apps:FastifyInstance[]=[];afterEach(async()=>{for(const a of apps.splice(0))await a.close()});
async function fixture(){const domain={row:{matchId:"combat-http-fixture"}};
 const aftermath=CombatAftermathSchema.parse({schemaVersion:2,matchId:domain.row.matchId,state:"RESOLVED",formations:[],battles:[{outcome:"defeat",ownFormationIds:["formation:"+"a".repeat(64)],lostUnitIds:["own-loss"],survivingUnitIds:[],position:{x:100,y:100},ownership:null}]});
 const accounts=new MemoryAuth(),getAftermath=vi.fn(async()=>aftermath);
 const f=await lobbyFixture(accounts,{} as never,undefined,undefined,{getTurn:vi.fn(),getAftermath});apps.push(f.app);
 return {...f,domain,accounts,getAftermath,browser:await f.login(),path:`/api/matches/${domain.row.matchId}/turns/1/aftermath`};
}
describe("minimal privacy-safe own combat HTTP",()=>{
 it("uses the signed session identity and private headers; returns no enemy roster, seed or raw audit",async()=>{
  const f=await fixture(),r=await f.request(f.browser,"GET",f.path);expect(r.statusCode).toBe(200);
  expect(f.getAftermath).toHaveBeenCalledExactlyOnceWith(f.domain.row.matchId,f.browser.identityId);
  expect(r.headers["cache-control"]).toBe("no-store");expect(r.headers["referrer-policy"]).toBe("no-referrer");
  expect(r.body).not.toMatch(/p01|auditJson|seed|rounds|sequence|private-order/);
 });
 it.each(["anonymous","revoked","onboarding"])("denies %s before storage lookup",async(kind)=>{const f=await fixture();if(kind==="anonymous")f.browser.cookie="";if(kind==="revoked")await f.accounts.revokeAllSessions(f.browser.identityId);if(kind==="onboarding")f.browser=await f.login(null);
  expect((await f.request(f.browser,"GET",f.path)).statusCode).toBe(kind==="onboarding"?403:401);expect(f.getAftermath).not.toHaveBeenCalled();
 });
 it.each(["playerId=enemy","seed=1","schemaVersion=2","eventOffset=1"])("rejects untrusted query %s",async(query)=>{const f=await fixture();expect((await f.request(f.browser,"GET",f.path+"?"+query)).statusCode).toBe(400);expect(f.getAftermath).not.toHaveBeenCalled()});
 it("sanitizes outsider/internal failures and rejects adapter leakage",async()=>{const f=await fixture();f.getAftermath.mockRejectedValueOnce(new TurnReadError("NOT_FOUND"));expect((await f.request(f.browser,"GET",f.path)).statusCode).toBe(404);
  f.getAftermath.mockResolvedValueOnce({schemaVersion:1,matchId:f.domain.row.matchId,state:"WAITING",seed:"private"} as never);const r=await f.request(f.browser,"GET",f.path);expect(r.statusCode).toBe(500);expect(r.body+f.logs.join()).not.toContain('"private"');
 });
 it("exposes no execution mutation endpoint",async()=>{const f=await fixture();expect((await f.request(f.browser,"POST",f.path,{})).statusCode).toBe(404);expect(f.getAftermath).not.toHaveBeenCalled()});
});
