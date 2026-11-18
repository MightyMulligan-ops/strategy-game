// @vitest-environment jsdom
import {act} from 'react';import {createRoot} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {EUROPE_SCENARIO_VIEW} from '@strategy-game/shared-types';
import LoopWorkspace from './LoopWorkspace';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const {originX,originY,maskPerGame,width,height,...profile}=EUROPE_SCENARIO_VIEW;void originX;void originY;void maskPerGame;void width;void height;
const id=`formation:${'a'.repeat(64)}`;
const current=(n=1)=>({schemaVersion:2,profile,kind:'loop_current',matchId:'match',turn:{schemaVersion:1,gameId:'match',turnNumber:n,status:'open',openedAtMs:1000,deadlineAtMs:2000},own:{revision:0,ready:false,orders:[]},formations:[{schemaVersion:1,formationId:id,ownerPlayerId:'own',position:{x:240,y:240},units:[{schemaVersion:1,unitId:`unit:${'b'.repeat(64)}`,originalSpawnNodeId:'camp-west',hp:7,maxHp:7,kind:'INFANTRY'}]}],ownedLocationIds:['camp-west']});
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;const fetcher=vi.fn(),session=vi.fn(async()=>{});
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);fetcher.mockReset().mockImplementation(async(path:string)=>path==='/auth/csrf'?json({csrfToken:'token'}):json(current()));session.mockClear();vi.stubGlobal('fetch',fetcher)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()});
const mount=()=>act(async()=>root.render(<LoopWorkspace expectedSchemaVersion={2} matchId="match" onSessionError={session}/>));
const click=(name:string)=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===name)!.click());
it('submits the exact Europe identity and intended turn, then reconciles once',async()=>{
 await mount();fetcher.mockImplementation(async(path:string,options:{method:string})=>path==='/auth/csrf'?json({csrfToken:'token'}):options.method==='POST'?json({...current(),own:{revision:1,ready:true,orders:[]}}):json(current(2)));
 await click('Mark Ready');const posts=fetcher.mock.calls.filter(([,o])=>o.method==='POST');expect(posts).toHaveLength(1);expect(JSON.parse(posts[0]![1].body)).toEqual({schemaVersion:2,profile,turnNumber:1,expectedRevision:0,kind:'set_ready',ready:true});expect(host.textContent).toContain('Current Turn 2');
});
it.each([ {...current(),schemaVersion:1,profile:undefined},{...current(),profile:{...profile,maskId:'old'}},{...current(),opponentHp:99},{...current(),formations:current().formations.map(f=>({...f,position:{x:1001,y:240}}))} ])('rejects stale profile and private/unrecognized projections',async(v)=>{
 fetcher.mockResolvedValue(json(v));await mount();expect(host.textContent).toContain('Current planning could not be verified');expect(host.textContent).not.toContain('Current Turn 1');expect(host.querySelector('select')).toBeNull();
});
it('ignores a late prior-profile GET even when transport ignores abort',async()=>{
 let resolve!:(v:Response)=>void;fetcher.mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r}));await mount();await click('Refresh current turn');expect(host.textContent).toContain('Current Turn 1');await act(async()=>resolve(json({...current(7),profile:{...profile,mapId:'stale'}})));expect(host.textContent).toContain('Current Turn 1');expect(host.textContent).not.toContain('Turn 7');
});
it('clears private Europe data on auth loss and never automatically replays a POST',async()=>{
 await mount();fetcher.mockResolvedValue(json({schemaVersion:1,error:'UNAUTHENTICATED'},401));await click('Refresh current turn');expect(session).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('camp-west');expect(fetcher.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(0);
});
