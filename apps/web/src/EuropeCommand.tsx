import {useEffect,useId,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import type {RepeatingCurrent,RepeatingCommand,MovementRoute,OwnFormation} from '@strategy-game/shared-types'
import type {FormationInspection} from './Formations'
import type {FormationMapInteraction} from './europe/map-interaction'

type Current=Extract<RepeatingCurrent,{schemaVersion:2}>
export type PlanningMap=(formation:OwnFormation|null,route:MovementRoute|null,inspection:FormationInspection,context:{view:RepeatingCurrent;choose:((p:{x:number;y:number})=>void)|null;interaction?:FormationMapInteraction})=>ReactNode
type Props={view:Current;busy:boolean;mutate:(command:RepeatingCommand)=>void;inspect:(turn:number)=>void;map?:PlanningMap|undefined;historyPanel?:ReactNode}

export default function EuropeCommand({view,busy,mutate,inspect,map,historyPanel}:Props){
  const [selected,setSelected]=useState(''),[drawer,setDrawer]=useState<'units'|'orders'|'reports'|null>(null)
  const [destination,setDestination]=useState<{x:string;y:string}>({x:'',y:''})
  const [historyTurn,setHistoryTurn]=useState(String(Math.max(1,view.turn.turnNumber-1)))
  const [now,setNow]=useState(()=>Date.now())
  const [focusRequest,requestFocus]=useState(0)
  const detailsId=useId(),markerId=useId(),heading=useRef<HTMLHeadingElement>(null)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  useEffect(()=>{if(focusRequest>0)heading.current?.focus({preventScroll:true})},[focusRequest])
  const f=view.formations.find(f=>f.formationId===selected)??null
  const locked=busy||view.turn.status!=='open',editable=!locked&&!view.own.ready
  const common={schemaVersion:2 as const,profile:view.profile,turnNumber:view.turn.turnNumber,expectedRevision:view.own.revision}
  let from=f?.position??{x:0,y:0},distance=0
  const segments=view.own.orders.filter(o=>o.stackId===f?.formationId).map((o,i)=>{
    const d=Math.hypot(o.destination.x-from.x,o.destination.y-from.y);distance+=d
    const segment={orderId:o.orderId,moveNumber:i+1,from,destination:o.destination,distance:d,cumulative:distance};from=o.destination;return segment
  })
  const route:MovementRoute|null=f?{formationId:f.formationId,range:250,distance,remaining:Math.max(0,250-distance),segments}:null
  function select(id:string){setSelected(id);setDestination({x:'',y:''});setDrawer('units')}
  function queueMove(formationId:string,p:{x:number;y:number}){
    const army=view.formations.find(f=>f.formationId===formationId)
    if(!editable||!army?.units.some(u=>u.kind==='LEADER')||!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.y))return
    setSelected(formationId);setDrawer('orders');setDestination({x:'',y:''})
    mutate({...common,kind:'replace_orders',orders:[...view.own.orders,{orderId:crypto.randomUUID(),type:'move',stackId:formationId,destination:p}]})
  }
  const inspection:FormationInspection={markerId,detailsId,expanded:drawer==='units'&&!!f,inspect:()=>{setDrawer('units');requestFocus(n=>n+1)}}
  const choose=editable&&f?(p:{x:number;y:number})=>{setDestination({x:String(p.x),y:String(p.y)});setDrawer('orders')}:null
  const seconds=Math.max(0,Math.ceil((view.turn.deadlineAtMs-now)/1000))
  const countdown=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')
  const armyNumber=(id:string)=>view.formations.findIndex(f=>f.formationId===id)+1
  return <div className="sovereign-command">
    <header className="command-bar" aria-label="Turn controls">
      <div className="command-title"><span className="eyebrow">EUROPE / SOVEREIGN</span><strong>Turn {view.turn.turnNumber}</strong></div>
      <nav aria-label="Command panels">{(['units','orders','reports'] as const).map(panel=><button key={panel} aria-expanded={drawer===panel} onClick={()=>setDrawer(drawer===panel?null:panel)}>{panel==='units'?'Units':panel==='orders'?'Orders':'Reports'}{panel==='units'?' ('+view.formations.reduce((n,f)=>n+f.units.length,0)+')':panel==='orders'?' ('+view.own.orders.length+')':''}</button>)}</nav>
      <time className="command-clock" aria-label="Informational countdown">{countdown}</time>
      <button className="command-ready primary" disabled={locked} onClick={()=>mutate({...common,kind:'set_ready',ready:!view.own.ready})}>{busy?'Saving...':view.own.ready?'Become Unready':'Mark Ready'}</button>
    </header>
    <div className="command-stage">
      {map?.(f?{...f,units:[...f.units]}:null,route,inspection,{view,choose,interaction:{selectedId:f?.formationId??null,select,queueMove:editable?queueMove:null}})}
      {drawer&&<aside className="command-drawer" aria-label={drawer==='units'?'Your forces':drawer==='orders'?'Movement orders':'Battle reports'}>
        <div className="section-heading"><h2>{drawer==='units'?'Your forces':drawer==='orders'?'Movement orders':'Battle reports'}</h2><button aria-label="Close command panel" onClick={()=>setDrawer(null)}>Close</button></div>
        {drawer==='units'&&<>
          <label>Own formation<select value={selected} onChange={e=>select(e.target.value)}><option value="">Select an own formation</option>{view.formations.map((army,i)=><option key={army.formationId} value={army.formationId}>Formation {i+1} - {army.units.length} units</option>)}</select></label>
          {!view.formations.length&&<p>No surviving own formations. You remain a participant and may Ready with empty orders.</p>}
          {!f&&view.formations.length>0&&<p>Select an army on the map or from this list. Drag it to queue a move.</p>}
          {f&&<section id={detailsId} aria-label="Current own formation"><h3 ref={heading} tabIndex={-1}>Formation {armyNumber(f.formationId)}</h3><p>{f.units.length} units. Movement remaining: {Math.max(0,250-distance).toFixed(0)} / 250.</p><ul className="command-units">{f.units.map(unit=><li key={unit.unitId}><span>{unit.kind==='LEADER'?'Lieutenant':'Infantry '+(f.units.filter(u=>u.kind==='INFANTRY').indexOf(unit)+1)}</span><strong>{unit.hp}/{unit.maxHp} HP</strong></li>)}</ul><p>Drag the army to its destination. Movement is planned now and executes when the turn ends.</p>{!f.units.some(u=>u.kind==='LEADER')&&<p>This formation cannot move under the approved leader policy.</p>}<details className="command-diagnostics"><summary>Technical details</summary><p>Current stored position: {f.position.x}, {f.position.y}.</p><p className="formation-id">{f.formationId}</p>{f.units.map(u=><p className="formation-id" key={u.unitId}>{u.unitId} - original spawn {u.originalSpawnNodeId}</p>)}</details></section>}
          <p>Recruitment is not yet available in this scenario.</p>
        </>}
        {drawer==='orders'&&<>
          <p>Drag a formation to add a numbered move. Dotted paths are plans; the server validates each order.</p>
          <ol aria-label="Current own orders">{view.own.orders.map((o,i)=><li key={o.orderId}><strong>Move {i+1} - Formation {armyNumber(o.stackId)}</strong><button disabled={!editable} onClick={()=>mutate({...common,kind:'cancel_order',orderId:o.orderId})}>Cancel move {i+1}</button></li>)}</ol>
          {!view.own.orders.length&&<p>No movement queued.</p>}
          {destination.x&&destination.y&&<p role="status">Destination selected on the map.</p>}
          <button disabled={!editable||!f?.units.some(u=>u.kind==='LEADER')||!destination.x.trim()||!destination.y.trim()} onClick={()=>{if(f)queueMove(f.formationId,{x:Number(destination.x),y:Number(destination.y)})}}>Add movement</button>
          <details className="command-diagnostics"><summary>Keyboard / coordinate fallback</summary><p>Optional keyboard alternative to dragging. Select a formation in Units first.</p><label>Destination X<input type="number" value={destination.x} disabled={!editable||!f} onChange={e=>setDestination(p=>({...p,x:e.target.value}))}/></label><label>Destination Y<input type="number" value={destination.y} disabled={!editable||!f} onChange={e=>setDestination(p=>({...p,y:e.target.value}))}/></label></details>
        </>}
        {drawer==='reports'&&<><fieldset disabled={busy||view.turn.turnNumber===1}><legend>Inspect one completed own turn</legend><label>Completed turn number<input type="number" min={1} max={view.turn.turnNumber-1} value={historyTurn} onChange={e=>setHistoryTurn(e.target.value)}/></label><button onClick={()=>inspect(Number(historyTurn))}>Read own aftermath</button></fieldset>{historyPanel}</>}
      </aside>}
    </div>
    <footer className="command-status"><p role="status">Current Turn {view.turn.turnNumber}: {view.turn.status==='open'?'Planning open':'Resolving on server'}.</p><span>{view.own.ready?'Ready - editing locked':'Unready'} - Updates automatically</span><span>{view.ownedLocationIds.length} controlled camps</span></footer>
  </div>
}
