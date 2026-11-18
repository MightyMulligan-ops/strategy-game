// Public geometry only. No range policy, physical mask or match state.
export type EuropePoint = Readonly<{x:number;y:number}>;
export const EUROPE_MAP_PROJECTION = Object.freeze({
 id:'europe-mercator-fixed-v2', unitsPerWorld:4_000_000,
 west:-25,east:60,south:25,north:72,width:944444,height:886082,
});
const mercatorY=(lat:number)=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;
const origin={x:155/360,y:mercatorY(72)};
function finite(p:EuropePoint){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new RangeError('Invalid Europe coordinate')}
/** Reject outside the geographic theatre; never silently clamp or snap to land. */
export function europeLonLatToDisplay(lon:number,lat:number):EuropePoint{
 finite({x:lon,y:lat});
 if(lon < -25||lon > 60||lat < 25||lat > 72)throw new RangeError('Outside Europe theatre');
 return {x:(lon+180)/360,y:mercatorY(lat)};
}
/** Nearest mask lattice point; ties use Math.round (toward positive infinity). */
export function europeDisplayToMask(p:EuropePoint):EuropePoint{
 finite(p);
 const x=(p.x-origin.x)*4_000_000,y=(p.y-origin.y)*4_000_000;
 // Rounded theatre bounds admit at most half a mask unit of edge quantization.
 if(x < -0.5||y < -0.5||x > 944444.5||y > 886082.5)throw new RangeError('Outside Europe projection');
 return {x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y))};
}
export function europeMaskToDisplay(p:EuropePoint):EuropePoint{
 finite(p);
 if(!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.y)||p.x<0||p.y<0||p.x>944444||p.y>886082)throw new RangeError('Invalid Europe mask point');
 return {x:p.x/4_000_000+origin.x,y:p.y/4_000_000+origin.y};
}
export function europeDisplayToLonLat(p:EuropePoint):Readonly<{lon:number;lat:number}>{
 // Validate display bounds without moving the input.
 europeDisplayToMask(p);
 return {lon:p.x*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*p.y)))*180/Math.PI};
}
export function europeLonLatToMask(lon:number,lat:number):EuropePoint{
 return europeDisplayToMask(europeLonLatToDisplay(lon,lat));
}
export const EUROPE_SCENARIO_VIEW=Object.freeze({profileId:'europe-playtest-v1',mapId:'europe-playtest-map-v1',projectionId:'europe-mercator-fixed-v2',maskId:'europe-ne10m-surface-v2',distanceId:'europe-100-mask-per-game-v1',scenarioId:'iberian-two-camps-v1',originX:200000,originY:Math.round((mercatorY(43.5)-mercatorY(72))*4_000_000),maskPerGame:100,width:1000,height:500} as const);
export function europeGameToDisplay(p:EuropePoint):EuropePoint{
 finite(p);if(p.x<0||p.y<0||p.x>1000||p.y>500)throw new RangeError('Outside Europe scenario');
 return {x:(EUROPE_SCENARIO_VIEW.originX+p.x*100)/4_000_000+origin.x,y:(EUROPE_SCENARIO_VIEW.originY+p.y*100)/4_000_000+origin.y};
}
export function europeDisplayToGame(p:EuropePoint):EuropePoint{
 finite(p);const x=Math.round(((p.x-origin.x)*4_000_000-EUROPE_SCENARIO_VIEW.originX)/100),y=Math.round(((p.y-origin.y)*4_000_000-EUROPE_SCENARIO_VIEW.originY)/100);
 if(x<0||y<0||x>1000||y>500)throw new RangeError('Outside Europe scenario');return {x:x===0?0:x,y:y===0?0:y};
}
