import { isDeepStrictEqual as same } from "node:util";
import { MOVEMENT_RESOLUTION_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import type { MovementInitialSnapshot, MovementResolutionResult, PinnedRuleset } from "@strategy-game/shared-types/server";
import { validateMovementInitialSnapshot, planTurnClosure, freezeClosureInput, freezeMovementInput, resolveMovement, createTurn } from "@strategy-game/game-engine";
import type { TurnState } from "@strategy-game/game-engine";
import { TURN_CLOSURE_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import { restoreStoredTurn } from "./turn-storage.js";
import type { StoredTurnRow } from "./turn-storage.js";
import { restoreClosureDrafts } from "./closure-storage.js";
import { restoreWorldArchive } from "./world-repository.js";
import { restoreTurnRecord, json, safeNumber } from "./mappings.js";
import { PersistenceError } from "./errors.js";
export type MovementAggregate={kind:"movement_resolution";row:StoredTurnRow;snapshot:MovementInitialSnapshot;state:TurnState;pinned:PinnedRuleset;result:MovementResolutionResult|null};
function invalid():never{throw new PersistenceError("invalid_storage","Movement resolution storage is inconsistent")}
/** Historical restoration is reused via an explicit in-memory compatibility projection;
 * original records are validated first and never modified or written back. */
export function restoreMovementResolution(row:StoredTurnRow):MovementAggregate{
 if(!row.match.world||!row.match.configuration)return invalid();
 const archive=restoreWorldArchive(row.match.world),snapshot=validateMovementInitialSnapshot(row.startingSnapshot.payload,archive,row.match.configuration.pinnedRuleset);
 if(row.startingSnapshot.snapshotId!==snapshot.snapshotId)return invalid();
 const resolved=row.status==="RESOLVED";
 if(row.status==="RESOLVING"||row.match.currentStateVersion!==(resolved?1n:0n))return invalid();
 const old=planTurnClosure(snapshot.config,snapshot.players,archive).snapshot,copy=structuredClone(row);
 Object.assign(copy.match.configuration!,{rulesetId:"turn-closure",rulesetVersion:"1",simulationVersion:"turn-closure-v1",pinnedRuleset:json(TURN_CLOSURE_RUNTIME_PROFILE)});
 Object.assign(copy.startingSnapshot,{snapshotId:old.snapshotId,payload:json(old)});
 copy.match.currentStateVersion=0n;copy.resolution=null;
 if(resolved)copy.status="CLOSED";
 const closedState=Object.freeze({...createTurn(old.config,old.players,safeNumber(copy.openedAtMs)),turn:restoreTurnRecord(copy),
  lastObservedAtMs:safeNumber(copy.lastObservedAtMs),drafts:restoreClosureDrafts(copy,old,archive)});
 if(copy.status!=="OPEN"){
  const expected=freezeMovementInput(closedState,snapshot,archive);
  if(!row.frozenInput||row.frozenInput.seed!==BigInt(expected.resolutionSeed)||!same(row.frozenInput.payload,json(expected)))return invalid();
  copy.frozenInput={...row.frozenInput,seed:null,payload:JSON.parse(JSON.stringify(freezeClosureInput(closedState,old,archive)))};
 }
 const base=restoreStoredTurn(copy);if(base.kind!=="turn_closure")return invalid();
 let result:MovementResolutionResult|null=null;
 if(resolved){
  if(!row.resolution||!row.frozenInput)return invalid();
  result=resolveMovement(snapshot,row.frozenInput.payload,archive);
  if(row.resolution.resolutionId!==result.resolutionId||row.resolution.nextStateVersion!==1n||!same(row.resolution.payload,json(result)))return invalid();
 }else if(row.resolution)return invalid();
 return {kind:"movement_resolution",row,snapshot,state:Object.freeze({...base.state,turn:restoreTurnRecord(row)}),pinned:MOVEMENT_RESOLUTION_RUNTIME_PROFILE,result};
}
