import mask from './europe-assets/surface-mask.json' with {type:'json'};
import {prepareSurfaceNavigation} from './surface-navigation.js';
import {createHash} from 'node:crypto';
import type {InitialWorldArchive} from '@strategy-game/shared-types/server';
import type {Point} from './combat-chronology.js';
// Scenario origin is quantized once in the versioned source mask grid.
import {EUROPE_SCENARIO_VIEW} from '@strategy-game/shared-types';
export const EUROPE_SCENARIO=EUROPE_SCENARIO_VIEW;
let cached:ReturnType<typeof prepareSurfaceNavigation>|undefined;
function surface(){
 if(!cached){
  // The published asset is compact JSON; normalize compiler whitespace only.
  if(createHash('sha256').update(JSON.stringify(mask)).digest('hex')!=='052b866179d2566fd37b2f22301d48c5e5fcec3f97e6e4bd806dcdc78374bfe6')throw Error('EUROPE_MASK_MISMATCH');
  cached=prepareSurfaceNavigation(mask);
 }return cached;
}
const project=(p:Point)=>({x:EUROPE_SCENARIO.originX+p.x*100,y:EUROPE_SCENARIO.originY+p.y*100});
export const europeLandPoint=(p:Point)=>surface().classifyContinuousPoint(project(p))==='LAND';
export const europeLandSegment=(a:Point,b:Point)=>surface().validateContinuousLandSegment(project(a),project(b));
export function validateEuropeScenario(archive:InitialWorldArchive){
 const w=archive.payload;
 if(w.seed!==1||w.players.length!==2||w.settings.regionSide!==5||w.bounds.width!==1000||w.bounds.height!==500)throw Error('EUROPE_SCENARIO_MISMATCH');
 for(const p of [...w.startingState.cities,...w.startingState.resourceNodes])if(!europeLandPoint(p.position))throw Error('EUROPE_SPAWN_NOT_LAND');
}
