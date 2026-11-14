// @vitest-environment jsdom
import {act}from'react';import{createRoot}from'react-dom/client';import{afterEach,beforeEach,describe,it,expect,vi}from'vitest';
import MovementResolution from'./MovementResolution';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const formation={schemaVersion:1,formationId:`formation:${'a'.repeat(64)}`,ownerPlayerId:'own',position:{x:79.999,y:100},units:Array.from({length:6},(_,i)=>({schemaVersion:1,unitId:`unit:${String(i).repeat(64)}`,originalSpawnNodeId:'supplies',...(i?{kind:'INFANTRY'}:{kind:'LEADER',rank:'LIEUTENANT',specialization:'INFANTRY'})}))};
const audit=(outcome:string,traveled:number,index:number)=>({auditId:`audit-${index}`,orderId:`order-${index}`,moveNumber:index+1,outcome,from:{x:0,y:100},to:{x:traveled,y:100},traveled,remaining:250-traveled,encounterId:outcome==='executed'?null:'encounter-own'});
function resolved(){const audits=[audit('executed',0,0),audit('blocked_encounter',79.999,1),audit('not_executed_after_encounter',0,2)];return{schemaVersion:1,matchId:'match',state:'RESOLVED',formation,summary:{completed:1,stopped:1,notExecuted:1,pendingEncounters:1},audits,eventOffset:0,eventTotal:3,nextEventCursor:null,events:audits.map((a,i)=>({eventId:a.auditId,sequence:i,orderId:a.orderId,moveNumber:a.moveNumber,type:a.outcome,from:a.from,to:a.to,traveled:a.traveled,encounterId:a.encounterId})),pendingEncounterIds:['encounter-own']}}
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;const fetcher=vi.fn(),session=vi.fn(async()=>{});
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify(resolved()),{status:200}));session.mockClear();vi.stubGlobal('fetch',fetcher)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()});
const mount=()=>act(async()=>root.render(<MovementResolution matchId="match" onSessionError={session}/>));
describe('read-only authoritative movement summary and timeline',()=>{
 it('renders partial and valid zero-distance completed orders separately from skips',async()=>{await mount();expect(host.textContent).toContain('1 completed');expect(host.textContent).toContain('Move 1: Completed');expect(host.textContent).toContain('Move 2: Stopped by enemy');expect(host.textContent).toContain('Move 3: Not executed');expect(host.textContent).toContain('79.999');expect(host.textContent).toContain('Pending battle');expect(host.textContent).toContain('combat has not occurred');expect(host.textContent).toContain('Turn 2 has not opened');expect(fetcher.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)});
 it('creates no phantom pending indicator for empty authoritative encounters',async()=>{const v=resolved();v.summary.pendingEncounters=0;v.pendingEncounterIds=[];fetcher.mockResolvedValue(new Response(JSON.stringify(v)));await mount();expect(host.textContent).not.toContain('Pending battle')});
 it('rejects inconsistent counts and hidden enemy fields',async()=>{const v={...resolved(),enemyOrders:['hidden']};fetcher.mockResolvedValue(new Response(JSON.stringify(v)));await mount();expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).not.toContain('hidden')});
 it('reconnects using GET and clears stale private results on session failure',async()=>{await mount();fetcher.mockResolvedValue(new Response('{}',{status:401}));await act(async()=>window.dispatchEvent(new Event('online')));expect(session).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('Move 2: Stopped by enemy');expect(fetcher.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)});
 it('shows waiting separately from movement completion',async()=>{fetcher.mockResolvedValue(new Response(JSON.stringify({schemaVersion:1,matchId:'match',state:'WAITING'})));await mount();expect(host.textContent).toContain('waits for authoritative');expect(host.textContent).not.toContain('Turn 1 RESOLVED')});
});

it('renders the defender contact event without inventing a move number or enemy detail',async()=>{
 const original=resolved(),audit=original.audits[0]!,event=original.events[0]!;
 const v={...original,summary:{completed:1,stopped:0,notExecuted:0,pendingEncounters:1},audits:[audit],eventTotal:2,
 events:[event,{eventId:'own-contact',sequence:1,orderId:null,moveNumber:0,type:'hostile_contact',from:{x:0,y:100},to:{x:0,y:100},traveled:0,encounterId:'encounter-own'}]};
 fetcher.mockResolvedValue(new Response(JSON.stringify(v)));await mount();expect(host.textContent).toContain('Hostile contact — pending battle');expect(host.textContent).not.toContain('Move 0');
});
