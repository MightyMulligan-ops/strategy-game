import {useCallback,useEffect,useId,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import {RepeatingCommandSchema as LoopCommandSchema,RepeatingCurrentSchema as LoopCurrentSchema,RepeatingHistorySchema as LoopHistorySchema,MovementDraftErrorSchema} from '@strategy-game/shared-types'
import type {RepeatingCurrent as LoopCurrent,RepeatingCommand as LoopCommand,MovementRoute} from '@strategy-game/shared-types'
import type {FormationInspection} from './Formations'
import CombatAftermath from './CombatAftermath'
import EuropeCommand from './EuropeCommand'
import type {PlanningMap} from './EuropeCommand'
import {useAutoRefresh} from './useAutoRefresh'

type Props={expectedSchemaVersion?:1|2;matchId:string;onSessionError:()=>Promise<void>;map?:PlanningMap}
export default function LoopWorkspace(props:Props){return <LoopReader key={props.matchId} {...props}/>}
function LoopReader({matchId,onSessionError,map,expectedSchemaVersion}:Props){
 const [view,setView]=useState<LoopCurrent|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const [history,setHistory]=useState<ReturnType<typeof LoopHistorySchema.parse>|null>(null),[historyError,setHistoryError]=useState('')
 const read=useRef<AbortController|null>(null),write=useRef<AbortController|null>(null),past=useRef<AbortController|null>(null),panel=useRef<HTMLElement>(null),title=useId()
 const writing=useRef(false),accessLost=useRef(false),currentView=useRef<LoopCurrent|null>(null)
 const base=`/api/matches/${encodeURIComponent(matchId)}/loop`
 const checked=useCallback(async(r:Response,signal:AbortSignal)=>{
  if(r.ok)return
  if([401,403,404].includes(r.status)){if(!signal.aborted){accessLost.current=true;currentView.current=null;read.current?.abort();write.current?.abort();past.current?.abort();setView(null);setHistory(null);setBusy(false);setNotice('Access unavailable. Reopen this match after signing in.');await onSessionError()}throw Error('Access unavailable. Reopen this match after signing in.')}
  const e=MovementDraftErrorSchema.safeParse(await r.json().catch(()=>null));throw Error(e.success&&['WRONG_TURN','STALE_REVISION','TURN_CLOSED'].includes(e.data.error)?'The turn or queue changed. Review the refreshed state.':'The request could not be verified. Refresh to reconcile; no action is automatically replayed.')
 },[onSessionError])
 const refresh=useCallback(async(abortWrite=true,background=false):Promise<boolean>=>{
  if(background&&(writing.current||read.current||accessLost.current))return true
  read.current?.abort();if(!background){past.current?.abort();if(abortWrite){write.current?.abort();writing.current=false}
   if(panel.current?.contains(document.activeElement))panel.current.focus();setView(null);setHistory(null);setHistoryError('');setNotice('');setBusy(true)}
  const c=new AbortController();read.current=c
  const timeout=setTimeout(()=>c.abort('timeout'),15_000)
  try{const r=await fetch(`${base}/current`,{method:'GET',credentials:'same-origin',cache:'no-store',signal:c.signal});await checked(r,c.signal);const v=LoopCurrentSchema.parse(await r.json());if(v.matchId!==matchId||expectedSchemaVersion!==undefined&&v.schemaVersion!==expectedSchemaVersion)throw Error('Wrong match/profile');
   if(c.signal.aborted)return false
   const previous=currentView.current
   if(previous&&(previous.turn.turnNumber!==v.turn.turnNumber||previous.schemaVersion!==v.schemaVersion||previous.own.revision!==v.own.revision)){past.current?.abort();setHistory(null);setHistoryError('')}
   currentView.current=v;setView(old=>JSON.stringify(old)===JSON.stringify(v)?old:v);setNotice('');return true
  }catch{if(!c.signal.aborted||c.signal.reason==='timeout'){currentView.current=null;past.current?.abort();setView(null);setHistory(null);setNotice('Current planning could not be verified. Automatic updates will retry; Refresh is also available.')}return false}
  finally{clearTimeout(timeout);if(read.current===c)read.current=null;if(!background&&(!c.signal.aborted||c.signal.reason==='timeout'))setBusy(false)}
 },[base,matchId,checked,expectedSchemaVersion])
 useAutoRefresh(()=>refresh(true,true),!busy)
 useEffect(()=>{let cancelled=false;queueMicrotask(()=>{if(!cancelled)void refresh()});const online=()=>{if(!writing.current&&!accessLost.current)void refresh()};window.addEventListener('online',online);return()=>{cancelled=true;read.current?.abort();write.current?.abort();past.current?.abort();window.removeEventListener('online',online)}},[refresh])
 async function mutate(input:LoopCommand){
  if(!view||busy||writing.current)return;read.current?.abort();read.current=null;writing.current=true;const c=new AbortController();write.current?.abort();write.current=c;past.current?.abort();setHistory(null);setBusy(true);setNotice('');let message=''
  try{const command=LoopCommandSchema.parse(input),token=await fetch('/auth/csrf',{method:'GET',credentials:'same-origin',cache:'no-store',signal:c.signal});await checked(token,c.signal);const t:unknown=await token.json();if(!t||typeof t!=='object'||!('csrfToken'in t)||typeof t.csrfToken!=='string'||!t.csrfToken)throw Error('Token unavailable')
   if(c.signal.aborted)return;const r=await fetch(`${base}/turns/${command.turnNumber}/commands`,{method:'POST',credentials:'same-origin',cache:'no-store',signal:c.signal,headers:{'Content-Type':'application/json','x-csrf-token':t.csrfToken},body:JSON.stringify(command)});await checked(r,c.signal);const v=LoopCurrentSchema.parse(await r.json());if(v.matchId!==matchId||v.turn.turnNumber!==command.turnNumber||v.own.revision!==command.expectedRevision+1||v.schemaVersion!==command.schemaVersion)throw Error('Unverified write')
  }catch{message='Write outcome could not be confirmed. The current turn is reloaded; review it before taking another action. No POST is retried.'}
  finally{writing.current=false;if(!c.signal.aborted){await refresh(false,true);if(!c.signal.aborted){setBusy(false);setNotice(message)}}}
 }
 async function inspect(n:number){
  past.current?.abort();const c=new AbortController();past.current=c;setHistory(null);setHistoryError('');const turn=view?.turn.turnNumber
  try{if(!Number.isSafeInteger(n)||n<1||!turn||n>=turn)throw Error('Invalid history turn');const r=await fetch(`${base}/turns/${n}/aftermath`,{method:'GET',credentials:'same-origin',cache:'no-store',signal:c.signal});await checked(r,c.signal);const h=LoopHistorySchema.parse(await r.json());if(h.matchId!==matchId||h.turnNumber!==n||h.schemaVersion!==view?.schemaVersion)throw Error('Wrong history');if(!c.signal.aborted)setHistory(h)}catch{if(!c.signal.aborted)setHistoryError('Own history could not be verified. Choose one completed turn and try again.')}
 }
 const historyPanel=<>  {historyError&&<p role="alert">{historyError}</p>}
  {history&&<section aria-label={`Your Turn ${history.turnNumber} aftermath`}><h3>Own Turn {history.turnNumber} history</h3><CombatAftermath view={history.aftermath} turnNumber={history.turnNumber} geographic={history.schemaVersion===2}/></section>}</>
 const geographic=expectedSchemaVersion===2||view?.schemaVersion===2
 return <section ref={panel} tabIndex={-1} className={"panel loop-workspace"+(geographic?" command-shell":"")} aria-labelledby={title} aria-busy={busy}>
  {geographic?<details className="command-sync"><summary>Connection</summary><h2 id={title}>Combat planning</h2><p>Updates automatically while this tab is visible.</p><button onClick={()=>void refresh()}>Refresh current turn</button></details>:<><div className="section-heading"><h2 id={title}>Combat planning</h2><button onClick={()=>void refresh()}>Refresh current turn</button></div><p className="small muted">Updates automatically while this tab is visible.</p></>}
  {notice&&<p className="command-notice" role="alert">{notice}</p>}
  {!view?<p role="status">{busy?'Loading current turn…':'Current turn unavailable.'}</p>:<LoopControls key={`${matchId}:${view.schemaVersion}:${view.turn.turnNumber}`} view={view} busy={busy} historyPanel={historyPanel} mutate={c=>void mutate(c)} inspect={n=>void inspect(n)} {...(map?{map}:{})}/>}
  {view?.schemaVersion!==2&&historyPanel}
 </section>
}
type Controls={view:LoopCurrent;busy:boolean;mutate:(c:LoopCommand)=>void;inspect:(n:number)=>void;map?:Props['map'];historyPanel?:ReactNode}
function LoopControls(props:Controls){return props.view.schemaVersion===2?<EuropeCommand {...props} view={props.view}/>:<HistoricalLoopControls {...props}/>}
function HistoricalLoopControls({view,busy,mutate,inspect,map}:{view:LoopCurrent;busy:boolean;mutate:(c:LoopCommand)=>void;inspect:(n:number)=>void;map?:Props['map']}){
 const [selected,setSelected]=useState(''),[x,setX]=useState(''),[y,setY]=useState(''),[historyTurn,setHistoryTurn]=useState(String(Math.max(1,view.turn.turnNumber-1))),[now,setNow]=useState(()=>Date.now())
 const detailsId=useId(),markerId=useId(),heading=useRef<HTMLHeadingElement>(null)
 const [focusRequest,requestFocus]=useState(0)
 useEffect(()=>{if(focusRequest>0)heading.current?.focus()},[focusRequest])
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
 const f=view.formations.find(f=>f.formationId===selected)??null,n=view.turn.turnNumber,locked=busy||view.turn.status!=='open',editable=!locked&&!view.own.ready
 const common={...(view.schemaVersion===2?{schemaVersion:2 as const,profile:view.profile}:{schemaVersion:1 as const}),turnNumber:n,expectedRevision:view.own.revision}
 let from=f?.position??{x:0,y:0},distance=0
 const segments=view.own.orders.filter(o=>o.stackId===f?.formationId).map((o,i)=>{const d=Math.sqrt((o.destination.x-from.x)**2+(o.destination.y-from.y)**2);distance+=d;const s={orderId:o.orderId,moveNumber:i+1,from,destination:o.destination,distance:d,cumulative:distance};from=o.destination;return s})
 const route:MovementRoute|null=f?{formationId:f.formationId,range:250,distance,remaining:Math.max(0,250-distance),segments}:null
 const inspection:FormationInspection={markerId,detailsId,expanded:!!f,inspect:()=>requestFocus(v=>v+1)}
 function add(){if(!f||!x.trim()||!y.trim())return;const destination={x:Number(x),y:Number(y)};if(!Number.isSafeInteger(destination.x)||!Number.isSafeInteger(destination.y))return;mutate({...common,kind:'replace_orders',orders:[...view.own.orders,{orderId:crypto.randomUUID(),type:'move',stackId:f.formationId,destination}]})}
 return <>
  <p role="status">Current Turn {n}: {view.turn.status==='open'?'Planning open':'Closed — awaiting complete server resolution'}.</p>
  <p>Informational countdown: {Math.max(0,Math.ceil((view.turn.deadlineAtMs-now)/1000))} seconds. The server decides deadline acceptance.</p>
  <p>Your revision {view.own.revision} · {view.own.ready?'Ready — editing locked':'Unready'}.</p>
  <button disabled={locked} onClick={()=>mutate({...common,kind:'set_ready',ready:!view.own.ready})}>{view.own.ready?'Become Unready':'Mark Ready'}</button>
  {!view.formations.length&&<p>No surviving own formations. You remain a participant and may Ready with empty orders.</p>}
  <label>Own formation<select value={selected} disabled={locked} onChange={e=>{setSelected(e.target.value);setX('');setY('')}}><option value="">Select an own formation</option>{view.formations.map(f=><option key={f.formationId} value={f.formationId}>Formation {view.formations.indexOf(f)+1} · {f.units.length} units</option>)}</select></label>
  {map?.(f?{...f,units:[...f.units]}:null,route,inspection,{view,choose:editable&&f?p=>{setX(String(p.x));setY(String(p.y))}:null})}
  {f&&<section id={detailsId} aria-label="Current own formation"><h3 ref={heading} tabIndex={-1}>Own formation {view.formations.indexOf(f)+1}</h3><p>Current stored position: {f.position.x}, {f.position.y}.</p><p>Fresh turn budget250; planned {distance.toFixed(3)}, remaining {Math.max(0,250-distance).toFixed(3)}. Planning does not move your formation.</p><ul>{f.units.map(u=><li key={u.unitId}>{u.kind==='LEADER'?u.rank.toLowerCase():`Infantry ${f.units.filter(v=>v.kind==='INFANTRY').indexOf(u)+1}`}: {u.hp}/{u.maxHp} HP</li>)}</ul><details><summary>Technical identifiers</summary><p className="formation-id">{f.formationId}</p><ul>{f.units.map(u=><li className="formation-id" key={u.unitId}>{u.unitId} · original spawn {u.originalSpawnNodeId}</li>)}</ul></details></section>}
  <label>Destination X<input type="number" value={x} disabled={!editable||!f?.units.some(u=>u.kind==='LEADER')} onChange={e=>setX(e.target.value)}/></label>
  <label>Destination Y<input type="number" value={y} disabled={!editable||!f?.units.some(u=>u.kind==='LEADER')} onChange={e=>setY(e.target.value)}/></label>
  <button disabled={!editable||!f?.units.some(u=>u.kind==='LEADER')||!x.trim()||!y.trim()} onClick={add}>Add movement</button>
  {f&&!f.units.some(u=>u.kind==='LEADER')&&<p>This surviving formation cannot move under the approved leadership/source-radius policy. Its original spawn is unchanged.</p>}
  <ol aria-label="Current own orders">{view.own.orders.map(o=><li key={o.orderId}>Formation {view.formations.findIndex(f=>f.formationId===o.stackId)+1} → {o.destination.x}, {o.destination.y}<button disabled={!editable} onClick={()=>mutate({...common,kind:'cancel_order',orderId:o.orderId})}>Cancel movement {o.orderId}</button></li>)}</ol>
  <p>Current locations owned by you: {view.ownedLocationIds.join(', ')||'None'}. Other current ownership is not included. {view.schemaVersion===2?'Camp markers show your current ownership; country borders are geographic context.':'The map retains archived initial ownership/colors.'}</p>
  <fieldset disabled={busy||n===1}><legend>Inspect one completed own turn</legend><label>Completed turn number<input type="number" min={1} max={n-1} value={historyTurn} onChange={e=>setHistoryTurn(e.target.value)}/></label><button onClick={()=>inspect(Number(historyTurn))}>Read own aftermath</button></fieldset>
 </>
}
