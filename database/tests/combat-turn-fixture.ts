import {observeClosureDeadline} from "@strategy-game/game-engine";
import {planCombatTurn,freezeCombatInput,resolveCombatTurn} from "@strategy-game/game-engine/server";
import {movementDraftFixture,fixtureRevision} from "./movement-draft-fixture.js";
import {restoreStoredTurn} from "../src/turn-storage.js";
import type {StoredTurnRow} from "../src/turn-storage.js";
import {json} from "../src/mappings.js";
export function combatTurnFixture(count=2,contact=false){
 const f=movementDraftFixture(count),plan=planCombatTurn(f.config,f.players,f.archive);
 if(contact){const forms=plan.snapshot.formations,mid={x:(forms[0]!.position.x+forms[1]!.position.x)/2,y:(forms[0]!.position.y+forms[1]!.position.y)/2};
  for(let i=0;i<2;i++)fixtureRevision(f,forms[i]!.ownerPlayerId,[{type:"move",orderId:`private-order-${i}`,stackId:forms[i]!.formationId,destination:mid}]);
 }
 const row:StoredTurnRow=structuredClone(f.row);
 Object.assign(row.match.configuration!,{rulesetId:"combat-turn",simulationVersion:"combat-turn-v1",pinnedRuleset:json(plan.runtimeProfile)});
 Object.assign(row.startingSnapshot,{snapshotId:plan.snapshot.snapshotId,payload:json(plan.snapshot)});
 const a=restoreStoredTurn(row);if(a.kind!=="combat_turn")throw Error("Fixture runtime");
 const state=observeClosureDeadline(a.state,11000),frozen=freezeCombatInput(state,plan.snapshot,f.archive);
 Object.assign(row,{status:"CLOSED",lastObservedAtMs:11000n,closedAtMs:11000n,closeReason:"DEADLINE",
  frozenInput:{matchId:row.matchId,turnNumber:1n,seed:BigInt(frozen.resolutionSeed),payload:json(frozen),frozenAt:new Date(0)}});
 const result=resolveCombatTurn(plan.snapshot,frozen,f.archive);
 const resolved=()=>{const next=structuredClone(row);Object.assign(next,{status:"RESOLVED",resolution:{matchId:next.matchId,turnNumber:1n,
  resolutionId:result.resolutionId,nextStateVersion:1n,payload:json(result),recordedAt:new Date(0)}});next.match.currentStateVersion=1n;return next;};
 return {...f,plan,row,frozen,result,resolved};
}
