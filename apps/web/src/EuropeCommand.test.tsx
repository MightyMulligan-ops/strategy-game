// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {EuropeCurrentSchema,EUROPE_SCENARIO_VIEW} from '@strategy-game/shared-types'
import EuropeCommand from './EuropeCommand'
import type {PlanningMap} from './EuropeCommand'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const {originX,originY,maskPerGame,width,height,...profile}=EUROPE_SCENARIO_VIEW;void originX;void originY;void maskPerGame;void width;void height
const id=`formation:${'a'.repeat(64)}`
const view=EuropeCurrentSchema.parse({schemaVersion:2,profile,kind:'loop_current',matchId:'match',turn:{schemaVersion:1,gameId:'match',turnNumber:2,status:'open',openedAtMs:1000,deadlineAtMs:2000},own:{revision:3,ready:false,orders:[]},formations:[{schemaVersion:1,formationId:id,ownerPlayerId:'own',position:{x:240,y:240},units:[{schemaVersion:1,unitId:`unit:${'b'.repeat(64)}`,originalSpawnNodeId:'west',hp:1,maxHp:1,kind:'LEADER',rank:'LIEUTENANT',specialization:'INFANTRY'}]}],ownedLocationIds:['west']})
let host:HTMLDivElement,root:ReturnType<typeof createRoot>
const mutate=vi.fn(),inspect=vi.fn()
const map:PlanningMap=(formation,_route,_inspection,context)=><section aria-label="Test map"><p>Stored army: {formation?.position.x??'none'}</p><button onClick={()=>context.interaction!.select(id)}>Select army</button><button disabled={!context.interaction?.queueMove} onClick={()=>context.interaction?.queueMove?.(id,{x:480,y:240})}>Drop army</button></section>
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);mutate.mockReset();inspect.mockReset()})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
const click=(name:string)=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===name)!.click())
const mount=(ready=false)=>act(async()=>root.render(<EuropeCommand view={{...view,own:{...view.own,ready}}} busy={false} mutate={mutate} inspect={inspect} map={map} historyPanel={<p>Saved own aftermath</p>}/>))
it('queues a drag through the exact authoritative profile/turn/revision contract',async()=>{
 await mount();expect(host.querySelector('input')).toBeNull();await click('Select army');await click('Drop army');expect(mutate).toHaveBeenCalledTimes(1)
 expect(mutate.mock.calls[0]![0]).toMatchObject({schemaVersion:2,profile,turnNumber:2,expectedRevision:3,kind:'replace_orders',orders:[{type:'move',stackId:id,destination:{x:480,y:240}}]})
 expect(host.textContent).toContain('Stored army: 240');expect(host.querySelector('[aria-label="Movement orders"]')).not.toBeNull()
})
it('locks dragging while Ready and preserves exact intended-turn Ready controls',async()=>{
 await mount(true);expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Drop army')!.disabled).toBe(true);await click('Become Unready');expect(mutate).toHaveBeenCalledExactlyOnceWith({schemaVersion:2,profile,turnNumber:2,expectedRevision:3,kind:'set_ready',ready:false})
})
it('shows historical inspection in a contextual report panel',async()=>{
 await mount();await click('Reports');expect(host.querySelector('[aria-label="Battle reports"]')!.textContent).toContain('Saved own aftermath');await click('Read own aftermath');expect(inspect).toHaveBeenCalledExactlyOnceWith(1);expect(mutate).not.toHaveBeenCalled()
})

it('sends a dispatch from the city panel and discards a stale selection after a revision refresh',async()=>{
 const {CITY_BALANCE_V1,CITY_PROFILE,CityCurrentSchema}=await import('@strategy-game/shared-types')
 const c=CityCurrentSchema.parse({...view,schemaVersion:3,profile:CITY_PROFILE,balance:{...CITY_BALANCE_V1,startingCredits:2000},
  ownedLocationIds:['madrid'],cityPlan:{credits:2000,recruitment:[],dispatches:[],commanders:[]},
  cities:[
   {cityId:'madrid',name:'Madrid',capital:true,owned:true,neutral:false,garrisonId:id,commanderId:view.formations[0]!.units[0]!.unitId,position:{x:368,y:463}},
   {cityId:'andorra-la-vella',name:'Andorra la Vella',capital:true,owned:false,neutral:false,garrisonId:null,commanderId:null,position:{x:946,y:152}},
   {cityId:'bilbao',name:'Bilbao',capital:false,owned:false,neutral:true,garrisonId:null,commanderId:null,position:{x:452,y:38}}
  ]})
 const render=(revision:number)=>act(async()=>root.render(<EuropeCommand view={{...c,own:{...c.own,revision}}}
  busy={false} mutate={mutate} inspect={inspect} map={map}/>))
 await render(3);await click('Select army')
 expect(host.textContent).toContain('Madrid · Capital');expect(host.textContent).toContain('Your treasury')
 await act(()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
 await click('Set destination for selected units')
 await render(4);await click('Drop army');expect(mutate).not.toHaveBeenCalled()
 await click('Set destination for selected units');await click('Drop army')
 expect(mutate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
  schemaVersion:3,profile:CITY_PROFILE,turnNumber:2,expectedRevision:4,kind:'city_edit',
  edit:{kind:'dispatch',dispatch:{dispatchId:expect.any(String),cityId:'madrid',unitIds:[c.formations[0]!.units[0]!.unitId],destination:{x:480,y:240}}}
 }))
})
