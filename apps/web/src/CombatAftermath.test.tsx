// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {CombatAftermathSchema} from '@strategy-game/shared-types'
import MovementResolution from './MovementResolution'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const fid=(c:string)=>`formation:${c.repeat(64)}`,uid=(c:string)=>`unit:${c.repeat(64)}`
const formation=(c:string,x:number)=>({schemaVersion:1,formationId:fid(c),ownerPlayerId:'own',position:{x,y:110},units:[{schemaVersion:1,kind:'INFANTRY',unitId:uid(c),originalSpawnNodeId:'own-spawn',hp:c==='a'?5:7,maxHp:7}]})
function result(){return CombatAftermathSchema.parse({schemaVersion:2,matchId:'match',state:'RESOLVED',formations:[formation('a',121),formation('b',145)],battles:[{outcome:'victory',ownFormationIds:[fid('a'),fid('b'),fid('c')],lostUnitIds:['own-lost'],survivingUnitIds:[uid('a'),uid('b')],position:{x:100,y:100},ownership:{locationId:'city',recipient:'ally'}}]})}
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status})
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve}}
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,mounted:boolean
const fetcher=vi.fn(),session=vi.fn(async()=>{})
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);mounted=true;fetcher.mockReset().mockImplementation(async()=>json(result()));session.mockClear();vi.stubGlobal('fetch',fetcher)})
afterEach(async()=>{if(mounted)await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const mount=(matchId='match',combat=true)=>act(async()=>root.render(<MovementResolution combat={combat} matchId={matchId} onSessionError={session}/>))
const reconnect=()=>act(async()=>window.dispatchEvent(new Event('online')))
const refresh=()=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Refresh battle aftermath')!.click())
describe('authorized own aftermath acceptance (synthetic UI fixtures, no live city capture)',()=>{
 it('associates participants with combined losses and each own survivor with its stored final position and HP',async()=>{
  await mount();expect(host.textContent).toContain('Movement and battles are complete');expect(host.textContent).toContain('Turn 2 has not opened');
  const battle=host.querySelector('article')!;for(const c of ['a','b','c'])expect(battle.textContent).toContain(fid(c));
  expect(battle.textContent).toContain('1 own unit lost');expect(battle.textContent).toContain('2 own units survived');expect(battle.textContent).toContain('Combined own losses');expect(battle.textContent).toContain('own-lost');
  expect(battle.textContent).toContain('Encounter position: 100, 100');expect(battle.textContent).toContain('stored final position 121, 110');expect(battle.textContent).toContain('stored final position 145, 110');
  expect(battle.textContent).toContain('Destroyed; no active formation remains. No final position is provided.');
  const disclosures=[...host.querySelectorAll('details')].filter(d=>!d.closest('article'));expect(disclosures).toHaveLength(2);
  for(const [i,c]of ['a','b'].entries()){expect(disclosures[i]!.textContent).toContain(fid(c));expect(disclosures[i]!.textContent).toContain(uid(c));expect(disclosures[i]!.textContent).toContain(c==='a'?'5/7 HP':'7/7 HP');expect(disclosures[i]!.textContent).toContain('own-spawn')}
  expect(host.textContent).toContain('not a current ownership map');expect(fetcher.mock.calls[0]![0]).toContain('/aftermath');
  expect(fetcher.mock.calls.every(([,o])=>o.method==='GET'&&o.credentials==='same-origin'&&o.cache==='no-store')).toBe(true)
 })
 it.each([['victory','Victory'],['defeat','Defeat'],['mutual_destruction','Mutual destruction']])('labels %s without raw enum text',async(outcome,label)=>{
  const v=result();fetcher.mockResolvedValue(json({...v,battles:[{...v.battles[0],outcome}]}));await mount();expect(host.querySelector('article h3')!.textContent).toBe(label)
 })
 it.each([['own','Your force receives ownership'],['ally','An allied force receives ownership'],['opponent','An opposing force receives ownership'],['unchanged','Ownership unchanged']])('labels authorized %s ownership without an owner identity',async(recipient,label)=>{
  const v=result();fetcher.mockResolvedValue(json({...v,battles:[{...v.battles[0],ownership:{locationId:'city',recipient}}]}));await mount();expect(host.querySelector('article')!.textContent).toContain(label);expect(host.textContent).not.toMatch(/enemy|opponent-id|allied-player-id/)
 })
 it('distinguishes off-city battles from ownership unchanged',async()=>{const v=result();fetcher.mockResolvedValue(json({...v,battles:[{...v.battles[0],ownership:null}]}));await mount();expect(host.textContent).toContain('Off-city battle: no ownership transfer.');expect(host.textContent).not.toContain('Ownership unchanged')})
 it('retains destroyed own participants and losses after mutual destruction; reconnect authorization loss clears them',async()=>{
  const v=result();fetcher.mockResolvedValue(json({...v,formations:[],battles:[{...v.battles[0],outcome:'mutual_destruction',survivingUnitIds:[],ownership:{locationId:'city',recipient:'unchanged'}}]}));await mount();
  expect(host.textContent).toContain('Mutual destruction');expect(host.textContent).toContain('No active own formations remain');expect(host.textContent).toContain('No own units survived');expect(host.textContent).toContain('Ownership unchanged');expect(host.textContent).toContain('own-lost');
  fetcher.mockResolvedValue(json({},401));await reconnect();expect(session).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('own-lost')
 })
 it('reports no battles involving own formations without asserting that the whole match had no battles',async()=>{fetcher.mockResolvedValue(json({...result(),battles:[]}));await mount();expect(host.textContent).toContain('No battles involved your formations');expect(host.textContent).toContain('Stored final position');expect(host.querySelector('article')).toBeNull()})
 it.each([['WAITING','waits for authoritative'],['NOT_STARTED','This match has not started'],['UNSUPPORTED','unavailable for this historical match']])('distinguishes %s from resolution and fetch errors',async(state,label)=>{
  fetcher.mockResolvedValue(json({schemaVersion:1,matchId:'match',state}));await mount();expect(host.textContent).toContain(label);expect(host.textContent).not.toContain('Movement and battles are complete');expect(host.querySelector('[role="alert"]')).toBeNull()
 })
 it('provides native named disclosures, Escape focus return, and stable focus before refresh removes inspection',async()=>{
  await mount();const d=host.querySelector('details')!,summary=d.querySelector('summary')!;expect(summary.textContent).toContain('Inspect your participating formations');d.open=true;summary.focus();
  await act(async()=>d.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(d.open).toBe(false);expect(document.activeElement).toBe(summary);
  const pending=deferred<Response>();fetcher.mockReturnValue(pending.promise);await refresh();expect(document.activeElement).toBe(host.querySelector('section'));expect(host.textContent).toContain('Loading battle aftermath');expect(host.textContent).not.toContain('own-lost');await act(async()=>pending.resolve(json(result())))
 })
 it('offers recoverable network errors and a deliberate GET refresh',async()=>{fetcher.mockRejectedValueOnce(Error('private-network-detail'));await mount();expect(host.querySelector('[role="alert"]')!.textContent).toContain('Refresh to try again');expect(host.textContent).not.toContain('private-network-detail');await refresh();expect(host.textContent).toContain('Victory')})
 it.each([401,403,404])('removes private results on %i and invokes the session boundary once',async(status)=>{await mount();fetcher.mockResolvedValue(json({},status));await reconnect();expect(session).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('own-lost');expect(host.querySelector('details')).toBeNull()})
 it.each(['wrong-match','hidden-root','hidden-battle','hidden-unit'])('rejects %s responses before rendering private input',async(kind)=>{
  const v=JSON.parse(JSON.stringify(result()));if(kind==='wrong-match')v.matchId='other';if(kind==='hidden-root')v.seed='hidden-canary';if(kind==='hidden-battle')v.battles[0].opponentIds=['hidden-canary'];if(kind==='hidden-unit')v.formations[0].units[0].enemyHp='hidden-canary';fetcher.mockResolvedValue(json(v));await mount();expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).not.toContain('hidden-canary');expect(host.textContent).not.toContain('own-lost')
 })
})
describe('late responses ignoring abort cannot restore private data',()=>{
 it('never paints loaded private results under a new match before its queued fetch begins',async()=>{
  await mount();expect(host.textContent).toContain('own-lost');const next=deferred<Response>();fetcher.mockReturnValueOnce(next.promise);
  await act(async()=>{flushSync(()=>root.render(<MovementResolution combat matchId="next" onSessionError={session}/>));expect(host.textContent).not.toContain('own-lost');expect(host.textContent).toContain('Loading battle aftermath')});
  await act(async()=>next.resolve(json({schemaVersion:1,matchId:'next',state:'WAITING'})))
 })

 it('clears a loaded result immediately on match switch and rejects a late previous-match read',async()=>{
  await mount();const old=deferred<Response>(),next=deferred<Response>();fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);await refresh();const signal=fetcher.mock.calls.at(-1)![1].signal as AbortSignal;await mount('next');expect(signal.aborted).toBe(true);expect(host.textContent).not.toContain('own-lost');await act(async()=>old.resolve(json(result())));expect(host.textContent).not.toContain('own-lost');await act(async()=>next.resolve(json({schemaVersion:1,matchId:'next',state:'WAITING'})));expect(host.textContent).toContain('waits for authoritative')
 })
 it('isolates cohort switches even with the same match ID',async()=>{
  const old=deferred<Response>();fetcher.mockReturnValueOnce(old.promise).mockResolvedValueOnce(json({schemaVersion:1,matchId:'match',state:'WAITING'}));await mount();const signal=fetcher.mock.calls[0]![1].signal as AbortSignal;await mount('match',false);expect(signal.aborted).toBe(true);await act(async()=>old.resolve(json(result())));expect(host.textContent).toContain('Movement waits for authoritative');expect(host.textContent).not.toContain('own-lost');expect(host.querySelector('h2')!.textContent).toBe('Movement results')
 })
 it('keeps a newer refresh result when an older JSON body finishes later',async()=>{
  const body=deferred<unknown>();fetcher.mockResolvedValueOnce({ok:true,json:()=>body.promise});await mount();fetcher.mockResolvedValueOnce(json({...result(),battles:[]}));await reconnect();await act(async()=>body.resolve(result()));expect(host.textContent).toContain('No battles involved your formations');expect(host.textContent).not.toContain('own-lost')
 })
 it('does not restore results after reconnect loses authorization while an old request is pending',async()=>{
  const old=deferred<Response>();fetcher.mockReturnValueOnce(old.promise);await mount();fetcher.mockResolvedValueOnce(json({},401));await reconnect();await act(async()=>old.resolve(json(result())));expect(session).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('own-lost');expect(host.querySelector('[role="alert"]')).not.toBeNull()
 })
 it('aborts on unmount and removes the reconnect listener even when the server ignores abort',async()=>{
  const old=deferred<Response>();fetcher.mockReturnValueOnce(old.promise);await mount();const signal=fetcher.mock.calls[0]![1].signal as AbortSignal;await act(async()=>root.unmount());mounted=false;expect(signal.aborted).toBe(true);await act(async()=>old.resolve(json(result())));await reconnect();expect(host.textContent).toBe('');expect(fetcher).toHaveBeenCalledOnce();expect(session).not.toHaveBeenCalled()
 })
})
