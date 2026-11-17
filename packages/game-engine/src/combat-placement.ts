import {distanceSquared} from "./combat-chronology.js";
import type {Point} from "./combat-chronology.js";
/** Exact nearest valid integer-world lattice point; deterministic squared-distance
 * ordering and x/y tie break. Finite search failure aborts the entire execution. */
export function adjacentCombatPosition(center:Point,bounds:{width:number;height:number},occupied:readonly Point[],maxCandidates=100000):Point{
 let best:Point|undefined,bestDistance=Infinity,work=0;
 const test=(x:number,y:number)=>{if(x<0||y<0||x>bounds.width||y>bounds.height)return;
  if(++work>maxCandidates)throw Error("COMBAT_PLACEMENT_LIMIT");const p={x,y},d=distanceSquared(p,center);
  if(d<=400||occupied.some(q=>distanceSquared(p,q)<=400))return;
  if(d<bestDistance||(d===bestDistance&&(!best||x<best.x||(x===best.x&&y<best.y)))){best=p;bestDistance=d;}
 };
 const cx=Math.round(center.x),cy=Math.round(center.y),limit=Math.max(bounds.width,bounds.height)+1;
 for(let r=0;r<=limit;r++){
  for(let x=cx-r;x<=cx+r;x++){test(x,cy-r);if(r)test(x,cy+r)}
  for(let y=cy-r+1;y<cy+r;y++){test(cx-r,y);if(r)test(cx+r,y)}
  // Any unvisited integer point differs on an axis by at least r+1; account
  // for a possibly fractional center without an epsilon.
  if(best&&(r+0.5)**2>bestDistance)return best;
 }
 throw Error("COMBAT_PLACEMENT_UNAVAILABLE");
}
