import type {CombatInitialSnapshot,CombatFrozenInput} from "@strategy-game/shared-types/server";
import {auditHash,compareIds} from "./determinism.js";
export type Point={x:number;y:number};
export type ChronologicalEncounter={encounterId:string;position:Point;time:number;members:Map<string,"moving"|"stationary">};
export type Leg={orderId:string;moveNumber:number;from:Point;to:Point;start:number;end:number};
export const milli=(p:Point)=>({xMilli:Math.round(p.x*1000),yMilli:Math.round(p.y*1000)});
export const world=(p:{xMilli:number;yMilli:number})=>({x:p.xMilli/1000,y:p.yMilli/1000});
export const distanceSquared=(a:Point,b:Point)=>(a.x-b.x)**2+(a.y-b.y)**2;
/** Analytic relative-motion contact inside one piecewise-linear interval. */
export function contactTime(a:Point,av:Point,b:Point,bv:Point,duration:number):number|null{
 const x=a.x-b.x,y=a.y-b.y,c=x*x+y*y-400;if(c<=0)return 0;
 const vx=av.x-bv.x,vy=av.y-bv.y,A=vx*vx+vy*vy;if(!A)return null;
 const B=2*(x*vx+y*vy),d=B*B-4*A*c;if(d<0||B>=0)return null;
 const t=2*c/(-B+Math.sqrt(d));return t>=0&&t<=duration?t:null;
}
export function gatherCombatEncounters(snapshot:CombatInitialSnapshot,frozen:CombatFrozenInput){
 const forms=[...snapshot.formations].sort((a,b)=>compareIds(a.formationId,b.formationId));
 const legs=new Map<string,Leg[]>(),stops=new Map<string,number>(),assigned=new Map<string,ChronologicalEncounter>();
 const encounters:ChronologicalEncounter[]=[];
 for(const f of forms){let from:Point=f.position,time=0;
  const orders=frozen.players.find(p=>p.playerId===f.ownerPlayerId)!.orders.filter(o=>o.stackId===f.formationId);
  legs.set(f.formationId,orders.map((o,i)=>{const length=Math.sqrt(distanceSquared(from,o.destination));
   const leg={orderId:o.orderId,moveNumber:i+1,from,to:o.destination,start:time,end:time+length};time+=length;from=o.destination;return leg}));
  if(time>250)throw Error("Combat movement exceeds range");
 }
 const position=(id:string,t:number):Point=>{const route=legs.get(id)!,at=Math.min(t,stops.get(id)??Infinity),f=forms.find(f=>f.formationId===id)!;
  const l=route.find(l=>l.start<=at&&at<l.end);if(!l)return route.filter(l=>l.end<=at).at(-1)?.to??f.position;
  const u=(at-l.start)/(l.end-l.start);return {x:l.from.x+(l.to.x-l.from.x)*u,y:l.from.y+(l.to.y-l.from.y)*u};
 };
 const velocity=(id:string,t:number):Point=>{if(stops.has(id))return {x:0,y:0};const l=legs.get(id)!.find(l=>l.start<=t&&t<l.end);
  return l?{x:(l.to.x-l.from.x)/(l.end-l.start),y:(l.to.y-l.from.y)/(l.end-l.start)}:{x:0,y:0};};
 const stance=(id:string,t:number):"moving"|"stationary"=>legs.get(id)!.some(l=>l.end>l.start&&(t===0?l.start===0:l.start<t&&t<=l.end))?"moving":"stationary";
 const enemies=new Set(snapshot.combatPolicy.relationships.filter(r=>r.relation==="hostile").map(r=>JSON.stringify([r.from,r.to])));
 const hostile=(a:string,b:string)=>enemies.has(JSON.stringify([a,b]));
 const boundaries=[...new Set([0,250,...[...legs.values()].flatMap(ls=>ls.map(l=>l.end))])].sort((a,b)=>a-b);
 let work=0;
 for(let interval=0;interval<boundaries.length-1;interval++){
  let at=boundaries[interval]!,end=boundaries[interval+1]!;
  // Zero-time initial encounters also run when all routes are empty.
  while(at<=end){if(++work>20000)throw Error("COMBAT_WORK_LIMIT");
   const events:{time:number;a:string;b:string}[]=[];
   for(let i=0;i<forms.length;i++)for(let j=i+1;j<forms.length;j++){
    const a=forms[i]!,b=forms[j]!;if(stops.has(a.formationId)&&stops.has(b.formationId))continue;
    if(!hostile(a.ownerPlayerId,b.ownerPlayerId))continue;
    const t=contactTime(position(a.formationId,at),velocity(a.formationId,at),position(b.formationId,at),velocity(b.formationId,at),end-at);
    if(t!==null)events.push({time:at+t,a:a.formationId,b:b.formationId});
   }
   // Encounter gathering sites are fixed; allied arrivals can reinforce them.
   for(const f of forms)if(!stops.has(f.formationId))for(const e of encounters){
    const t=contactTime(position(f.formationId,at),velocity(f.formationId,at),e.position,{x:0,y:0},end-at);
    if(t!==null)events.push({time:at+t,a:f.formationId,b:`site:${e.encounterId}`});
   }
   if(!events.length)break;
   const time=Math.min(...events.map(e=>e.time)),batch=events.filter(e=>e.time===time);
   const parent=new Map<string,string>();
   const root=(id:string):string=>{if(!parent.has(id))parent.set(id,id);let x=id;while(parent.get(x)!==x)x=parent.get(x)!;return x;};
   const token=(id:string)=>assigned.has(id)?`site:${assigned.get(id)!.encounterId}`:id;
   for(const event of batch){const a=root(token(event.a)),b=root(token(event.b));if(a!==b)parent.set(a<b?b:a,a<b?a:b)}
   const groups=new Map<string,string[]>();for(const id of parent.keys()){const r=root(id);groups.set(r,[...groups.get(r)??[],id])}
   for(const group of [...groups.values()].sort((a,b)=>compareIds([...a].sort()[0]!,[...b].sort()[0]!))){
    const incoming=group.filter(id=>!id.startsWith("site:")&&!stops.has(id)).sort(compareIds);if(!incoming.length)continue;
    const sites=encounters.filter(e=>group.includes(`site:${e.encounterId}`)).sort((a,b)=>a.time-b.time||compareIds(a.encounterId,b.encounterId));
    let encounter=sites[0];
    if(!encounter){
     const stationary=incoming.filter(id=>stance(id,time)==="stationary");
     const points=incoming.map(id=>position(id,time));
     const center=stationary.length?position(stationary[0]!,time):{x:points.reduce((n,p)=>n+p.x,0)/points.length,y:points.reduce((n,p)=>n+p.y,0)/points.length};
     const location=world(milli(center));
     encounter={encounterId:`encounter:${auditHash({version:"chronological-speed-v1",snapshot:snapshot.snapshotId,time,members:incoming,location})}`,
      position:location,time,members:new Map()};encounters.push(encounter);
    }
    for(const id of incoming){encounter.members.set(id,stance(id,time));stops.set(id,time);assigned.set(id,encounter)}
   }
   at=time;
  }
 }
 return {encounters,legs,stops,assigned,position};
}
