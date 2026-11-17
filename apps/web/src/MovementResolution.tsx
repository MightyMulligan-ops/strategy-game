import {useCallback,useEffect,useId,useRef,useState} from 'react'
import {ResolutionViewSchema,CombatAftermathViewSchema} from '@strategy-game/shared-types'
import type {ResolutionView,CombatAftermath} from '@strategy-game/shared-types'
export default function MovementResolution({matchId,onSessionError,combat=false}:{matchId:string;onSessionError:()=>Promise<void>;combat?:boolean}){
 const [view,setView]=useState<ResolutionView|CombatAftermath|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const read=useRef<AbortController|null>(null),title=useId()
 const refresh=useCallback(async(eventOffset=0)=>{
  read.current?.abort();const c=new AbortController();read.current=c;setView(null);setError('');setLoading(true)
  try{
   const r=await fetch(`/api/matches/${encodeURIComponent(matchId)}/turns/1/${combat?'aftermath':'resolution?eventOffset='+eventOffset}`,{method:'GET',credentials:'same-origin',cache:'no-store',signal:c.signal})
   if(!r.ok){if(r.status===401||r.status===403||r.status===404){if(!c.signal.aborted)await onSessionError()}throw Error('unavailable')}
   const result=(combat?CombatAftermathViewSchema:ResolutionViewSchema).parse(await r.json());if(result.matchId!==matchId)throw Error('mismatched')
   if(!c.signal.aborted)setView(result)
  }catch{if(!c.signal.aborted)setError('Movement results could not be verified. Refresh to try again.')}
  finally{if(!c.signal.aborted)setLoading(false)}
 },[matchId,onSessionError,combat])
 useEffect(()=>{let cancelled=false;queueMicrotask(()=>{if(!cancelled)void refresh()});const online=()=>void refresh();window.addEventListener('online',online);return()=>{cancelled=true;read.current?.abort();window.removeEventListener('online',online)}},[refresh])
 const labels={executed:'Completed',blocked_encounter:'Stopped by enemy',not_executed_after_encounter:'Not executed'}
 return <section className="panel" aria-labelledby={title} aria-busy={loading}>
  <div className="section-heading"><h2 id={title}>Movement results</h2><button disabled={loading} onClick={()=>void refresh()}>Refresh movement results</button></div>
  {loading?<p role="status">Loading movement results…</p>:error?<p role="alert">{error}</p>:view?.state==='RESOLVED'&&view.schemaVersion===2?<>
   <p role="status">Turn 1 RESOLVED. Movement and battles are complete. Turn 2 has not opened.</p>
   <p>{view.formations.length} surviving own formations.</p>
   {view.battles.map((b,i)=><div key={i}><h3>Own battle outcome: {b.outcome.replaceAll('_',' ')}</h3><p>{b.lostUnitIds.length} own units lost · {b.survivingUnitIds.length} own units survived.</p><p>Stopped at {b.position.x}, {b.position.y}.</p>{b.ownership&&<p>Location {b.ownership.locationId}: {b.ownership.recipient==='own'?'your force receives ownership':b.ownership.recipient==='ally'?'allied force receives ownership':b.ownership.recipient==='opponent'?'opposing force receives ownership':'ownership unchanged'}.</p>}<details><summary>Your unit aftermath</summary><p>Lost: {b.lostUnitIds.join(', ')||'None'}</p><p>Survived: {b.survivingUnitIds.join(', ')||'None'}</p></details></div>)}
   {view.formations.map(f=><p key={f.formationId}>Own formation {f.formationId}: {f.units.length} survivors at {f.position.x}, {f.position.y}. {f.units.map(u=>`${u.unitId}: ${u.hp}/${u.maxHp} HP`).join('; ')}</p>)}
  </>:view?.state==='RESOLVED'?<>
   <p role="status">Turn 1 RESOLVED. Movement is complete; combat has not occurred and Turn 2 has not opened.</p>
   <p>{view.summary.completed} completed · {view.summary.stopped} stopped · {view.summary.notExecuted} not executed · {view.summary.pendingEncounters} pending encounters involving your formation.</p>
   {view.pendingEncounterIds.length>0&&<p role="status">Pending battle — unresolved. Opponent details remain private.</p>}
   <ol>{view.audits.map(a=><li key={a.auditId}>Move {a.moveNumber}: {labels[a.outcome]} · Traveled {a.traveled.toFixed(3)} · Remaining {a.remaining.toFixed(3)} world units · Position {a.to.x.toFixed(3)}, {a.to.y.toFixed(3)}</li>)}</ol>
   <details><summary>Read-only movement event timeline</summary><ol>{view.events.map(e=><li key={e.eventId}>{e.type==='initial_contact'?'Initial hostile contact':e.type==='hostile_contact'?'Hostile contact — pending battle':`Move ${e.moveNumber}: ${labels[e.type]}`} · {e.from.x.toFixed(3)}, {e.from.y.toFixed(3)} → {e.to.x.toFixed(3)}, {e.to.y.toFixed(3)} · {e.traveled.toFixed(3)} world units</li>)}</ol>{view.nextEventCursor!==null&&<button onClick={()=>void refresh(view.nextEventCursor!)}>Next movement events</button>}<p>Showing {view.events.length} of {view.eventTotal} own events.</p></details>
  </>:<p role="status">{view?.state==='UNSUPPORTED'?'This historical match has no movement resolution.':'Movement waits for authoritative Turn 1 closure and server processing.'}</p>}
 </section>
}
