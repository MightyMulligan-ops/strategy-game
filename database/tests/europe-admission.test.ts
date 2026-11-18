import {describe,it,expect} from 'vitest';
import {EUROPE_RUNTIME,INITIAL_WORLD_RUNTIME_PROFILE,INITIAL_ARMIES_RUNTIME_PROFILE,MOVEMENT_DRAFT_RUNTIME_PROFILE,TURN_CLOSURE_RUNTIME_PROFILE,MOVEMENT_RESOLUTION_RUNTIME_PROFILE,COMBAT_TURN_RUNTIME_PROFILE,LOOP_RUNTIME} from '@strategy-game/shared-types/server';
import type {Prisma,MatchConfiguration} from '../src/generated/prisma/client.js';
import {configurationRuntime} from '../src/turn-storage.js';
import {initialTurnFixture} from './initial-turn-fixture.js';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.JsonValue;
function row(profile:typeof EUROPE_RUNTIME|object=EUROPE_RUNTIME):MatchConfiguration{const c=initialTurnFixture().row.match.configuration!;const p=profile as typeof EUROPE_RUNTIME;return {...c,rulesetId:p.ruleset.rulesetId,rulesetVersion:p.ruleset.version,simulationVersion:p.simulationVersion,pinnedRuleset:json(profile)}}
describe('EUROPE107-APP-ADMISSION-001 exact creation admission',()=>{
 it('selects schema2 Europe before the historical parser without mutating its pin',()=>{const c=row(),before=structuredClone(c);expect(configurationRuntime(c)).toBe('combat_loop');expect(c).toEqual(before)});
 it.each(['schema','extra','missing-policy','mask','projection','distance','scenario','partial-pin','legacy-spoof','metadata-id','metadata-version','metadata-simulation','partial-columns'])('rejects %s rather than downgrading to a historical profile',kind=>{
  const c=row(),pin=JSON.parse(JSON.stringify(EUROPE_RUNTIME));
  if(kind==='schema')pin.schemaVersion=1;
  if(kind==='extra')pin.extra='untrusted';
  if(kind==='missing-policy')delete pin.europe;
  if(kind==='mask')pin.europe.maskSha256='0'.repeat(64);
  if(kind==='projection')pin.europe.projectionId='old';
  if(kind==='distance')pin.europe.distanceId='different';
  if(kind==='scenario')pin.europe.scenarioId='different';
  if(kind==='partial-pin')delete pin.ruleset.version;
  if(kind==='legacy-spoof'){pin.schemaVersion=1;pin.ruleset=LOOP_RUNTIME.ruleset;pin.simulationVersion=LOOP_RUNTIME.simulationVersion}
  c.pinnedRuleset=json(pin);
  if(kind==='metadata-id')c.rulesetId='combat-loop';
  if(kind==='metadata-version')c.rulesetVersion='2';
  if(kind==='metadata-simulation')c.simulationVersion='combat-loop-v1';
  if(kind==='partial-columns')c.pinnedRuleset=null;
  expect(()=>configurationRuntime(c)).toThrow();
 });
 it.each([[INITIAL_WORLD_RUNTIME_PROFILE,'initial_world'],[INITIAL_ARMIES_RUNTIME_PROFILE,'initial_armies'],[MOVEMENT_DRAFT_RUNTIME_PROFILE,'movement_drafts'],[TURN_CLOSURE_RUNTIME_PROFILE,'turn_closure'],[MOVEMENT_RESOLUTION_RUNTIME_PROFILE,'movement_resolution'],[COMBAT_TURN_RUNTIME_PROFILE,'combat_turn'],[LOOP_RUNTIME,'combat_loop']] as const)('retains the historical profile %s', (profile,mode)=>{expect(configurationRuntime(row(profile))).toBe(mode);expect(()=>configurationRuntime({...row(profile),rulesetVersion:'spoof'})).toThrow()});
 it('retains all-null legacy and rejects partial or unknown pins',()=>{
  expect(configurationRuntime({...row(),rulesetId:null,rulesetVersion:null,simulationVersion:null,pinnedRuleset:null})).toBe('legacy');
  expect(()=>configurationRuntime({...row(),rulesetId:null})).toThrow();
  expect(()=>configurationRuntime({...row(),pinnedRuleset:json({...EUROPE_RUNTIME,simulationVersion:'unknown'})})).toThrow();
 });
});
