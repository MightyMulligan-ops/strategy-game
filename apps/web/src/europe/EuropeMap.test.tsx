// @vitest-environment jsdom
import {act} from 'react';import {createRoot} from 'react-dom/client';import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {EuropeCurrentSchema,EUROPE_SCENARIO_VIEW,europeGameToDisplay} from '@strategy-game/shared-types';
import type {PublicWorld} from '@strategy-game/shared-types';
import EuropeMap from './EuropeMap';import {fitTheatre,toScreen} from './camera';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const {originX,originY,maskPerGame,width,height,...profile}=EUROPE_SCENARIO_VIEW;void originX;void originY;void maskPerGame;void width;void height;
const view=EuropeCurrentSchema.parse({schemaVersion:2,profile,kind:'loop_current',matchId:'mock',turn:{schemaVersion:1,gameId:'mock',turnNumber:1,status:'open',openedAtMs:1000,deadlineAtMs:2000},own:{revision:0,ready:false,orders:[]},formations:[],ownedLocationIds:['west']});
// Only the explicit camp projection consumed by this component, no private fixture state.
const world:PublicWorld={visibility:'INITIAL_SHARED',bounds:{width:1000,height:500},grid:{columns:2,rows:1},players:[{playerId:'own',username:'Own'},{playerId:'other',username:'Other'}],territories:[0,1].map(i=>({territoryId:`camp-territory-${i}`,row:0,column:i,polygon:[{x:i*500,y:0},{x:(i+1)*500,y:0},{x:(i+1)*500,y:500},{x:i*500,y:500}],center:{x:i*500+240,y:240},terrain:'PLAINS',ownerPlayerId:i===0?'own':'other',capital:true,city:{cityId:i===0?'west':'east',kind:'CAPITAL'},resources:[]})),links:[{a:'camp-territory-0',b:'camp-territory-1'}]};
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;const choose=vi.fn();
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);choose.mockReset();vi.stubGlobal('Path2D',class{});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('matchMedia',()=>({matches:true}));vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D);Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();Reflect.deleteProperty(HTMLElement.prototype,'setPointerCapture');vi.unstubAllGlobals()});
const mount=()=>act(async()=>root.render(<EuropeMap view={view} route={null} choose={choose} world={world}/>));
function pointer(element:Element,type:string,x:number,y:number){const e=new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:1});element.dispatchEvent(e)}
it('preserves all138 display cities, explicit camp ownership and Geneva warning',async()=>{
 await mount();expect(host.querySelector('#ep-city-select')!.children).toHaveLength(138);expect(host.textContent).toContain('Geneva is unavailable for land gameplay');expect(host.textContent).toContain('currently yours');expect(host.textContent).toContain('current owner undisclosed');expect(host.textContent).toContain('uncommitted drafts');
});
it('picks integer game coordinates without submitting or treating a pan as a pick',async()=>{
 await mount();const element=host.querySelector('.ep-map')!,v={width:1920,height:920},p=toScreen(europeGameToDisplay({x:240,y:240}),fitTheatre(v),v);
 await act(async()=>{pointer(element,'pointerdown',p.x,p.y);pointer(element,'pointerup',p.x,p.y)});expect(choose).toHaveBeenCalledExactlyOnceWith({x:240,y:240});
 choose.mockClear();await act(async()=>{pointer(element,'pointerdown',p.x,p.y);pointer(element,'pointermove',p.x+20,p.y);pointer(element,'pointerup',p.x+20,p.y)});expect(choose).not.toHaveBeenCalled();
});
it('keeps defense geometry explicitly local and uncommitted',async()=>{
 await mount();await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Uncommitted defense drawing')!.click());const el=host.querySelector('.ep-map')!;
 await act(async()=>{pointer(el,'pointerdown',600,300);pointer(el,'pointerup',600,300)});expect(choose).not.toHaveBeenCalled();expect(host.querySelector('polyline')!.getAttribute('points')).not.toBe('');
});
it('keeps options collapsed and identifies a country without changing destination intent',async()=>{
 await mount();expect(host.querySelector<HTMLDetailsElement>('.ep-options')!.open).toBe(false);expect(host.querySelector('.ep-map .ep-inspector')).toBeNull();const el=host.querySelector('.ep-map')!,v={width:1920,height:920};const {project}=await import('./camera');const p=toScreen(project(-3.7,40.4),fitTheatre(v),v);await act(async()=>pointer(el,'pointermove',p.x,p.y));expect(host.querySelector('.ep-country-tooltip')!.textContent).toContain('Spain');expect(choose).not.toHaveBeenCalled();const select=host.querySelector<HTMLSelectElement>('#ep-country-select')!;expect([...select.options].some(o=>o.textContent==='France')).toBe(true)
});

const armyId=`formation:${'a'.repeat(64)}`;
const armyView=EuropeCurrentSchema.parse({...view,formations:[{schemaVersion:1,formationId:armyId,ownerPlayerId:'own',position:{x:240,y:240},units:[{schemaVersion:1,unitId:`unit:${'b'.repeat(64)}`,originalSpawnNodeId:'west',hp:1,maxHp:1,kind:'LEADER',rank:'LIEUTENANT',specialization:'INFANTRY'}]}]});
async function interactive(ready=false){
 const move=vi.fn(),select=vi.fn();await act(async()=>root.render(<EuropeMap view={{...armyView,own:{...armyView.own,ready}}} route={null} choose={null} world={world} interaction={{selectedId:null,select,queueMove:ready?null:move}}/>));
 const element=host.querySelector<HTMLElement>('.ep-map')!,marker=host.querySelector<HTMLElement>('[data-formation-id]')!;
 Object.defineProperty(element,'getBoundingClientRect',{configurable:true,value:()=>new DOMRect(0,0,1920,920)});
 const camera=fitTheatre({width:1920,height:920}),p=toScreen(europeGameToDisplay({x:240,y:240}),camera,{width:1920,height:920}),q=toScreen(europeGameToDisplay({x:480,y:240}),camera,{width:1920,height:920});
 return {element,marker,p,q,move,select};
}
it('drags an own army into one queued integer destination without moving the stored marker',async()=>{
 const {element,marker,p,q,move}=await interactive();const left=marker.style.left;
 await act(async()=>{pointer(marker,'pointerdown',p.x,p.y);pointer(element,'pointermove',q.x,q.y)});
 expect(host.querySelector('.ep-move-preview')).not.toBeNull();expect(move).not.toHaveBeenCalled();expect(marker.style.left).toBe(left);
 await act(async()=>pointer(element,'pointerup',q.x,q.y));expect(move).toHaveBeenCalledExactlyOnceWith(armyId,{x:480,y:240});expect(host.querySelector('.ep-move-preview')).toBeNull();expect(marker.style.left).toBe(left);
});
it.each(['pointercancel','lostpointercapture','escape'])('cancels an army drag on %s without a command',async(kind)=>{
 const {element,marker,p,q,move}=await interactive();await act(async()=>{pointer(marker,'pointerdown',p.x,p.y);pointer(element,'pointermove',q.x,q.y);if(kind==='escape')element.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));else pointer(element,kind,q.x,q.y);pointer(element,'pointerup',q.x,q.y)});expect(move).not.toHaveBeenCalled();expect(host.querySelector('.ep-move-preview')).toBeNull();
});
it('rejects drops outside the scenario and keeps Ready armies locked',async()=>{
 const a=await interactive(),v={width:1920,height:920},outside=toScreen(europeGameToDisplay({x:1000,y:500}),fitTheatre(v),v);outside.x+=20;
 await act(async()=>{pointer(a.marker,'pointerdown',a.p.x,a.p.y);pointer(a.element,'pointermove',outside.x,outside.y);pointer(a.element,'pointerup',outside.x,outside.y)});expect(a.move).not.toHaveBeenCalled();expect(host.textContent).toContain('No order was submitted');
 const b=await interactive(true);await act(async()=>{pointer(b.marker,'pointerdown',b.p.x,b.p.y);pointer(b.element,'pointermove',b.q.x,b.q.y);pointer(b.element,'pointerup',b.q.x,b.q.y)});expect(b.move).not.toHaveBeenCalled();
});
it('rejects a drag if a background update changed its planning revision',async()=>{
 const a=await interactive();await act(async()=>{pointer(a.marker,'pointerdown',a.p.x,a.p.y);pointer(a.element,'pointermove',a.q.x,a.q.y)});
 await act(async()=>root.render(<EuropeMap view={{...armyView,own:{...armyView.own,revision:1}}} route={null} choose={null} world={world} interaction={{selectedId:armyId,select:a.select,queueMove:a.move}}/>));
 await act(async()=>pointer(a.element,'pointerup',a.q.x,a.q.y));expect(a.move).not.toHaveBeenCalled();expect(host.textContent).toContain('Planning changed during this drag');
});
