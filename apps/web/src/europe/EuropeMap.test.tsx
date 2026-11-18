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
