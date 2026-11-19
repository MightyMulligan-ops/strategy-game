import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { OwnFormation, PublicWorld, ReadFormationView } from '@strategy-game/shared-types'
import { FormationReadError, readFormations } from './formation-api'

export type FormationInspection = {
  markerId: string
  detailsId: string
  expanded: boolean
  inspect: () => void
}

/** Mounted only alongside a matching READY world. Unmount clears all private data. */
export default function Formations({ matchId, world, onSessionError, map, selectedFormationId, onSelectionChange, renderLoop, onLoopReady }: {
  onLoopReady?:()=>void
  renderLoop?:(schemaVersion:1|2|3)=>ReactNode
  matchId: string; world: PublicWorld; onSessionError: () => Promise<void>; selectedFormationId: string | null; onSelectionChange: Dispatch<SetStateAction<string | null>>
  map: (formation: OwnFormation | null, inspection: FormationInspection, policy?:{radius:10;pending:boolean;combat?:boolean}) => ReactNode
}) {
  const title = useId()
  const detailsId = `${title}-details`
  const markerId = `${title}-marker`
  const heading = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [focusRequest, requestFocus] = useState(0)
  useEffect(() => { if (focusRequest > 0) heading.current?.focus() }, [focusRequest])
  function closeDetails() {
    onSelectionChange(null)
    document.getElementById(markerId)?.focus()
  }
  const [result, setResult] = useState<ReadFormationView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const read = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller
    // Keep focus on a stable named region before details disappear or the refresh button disables.
    if (panel.current?.contains(document.activeElement)) panel.current.focus()
    setLoading(true); setResult(null); setError('')
    try {
      const response = await readFormations(matchId, controller.signal)
      if (response.schemaVersion===1 && response.state === 'READY' && response.formations.some((f) => !world.territories.some((t) => t.capital && t.ownerPlayerId === f.ownerPlayerId && t.center.x === f.position.x && t.center.y === f.position.y))) throw new FormationReadError('malformed')
      if(response.state==='READY'&&response.formations.some(f=>!world.players.some(p=>p.playerId===f.ownerPlayerId)||f.position.x>world.bounds.width||f.position.y>world.bounds.height))throw new FormationReadError('malformed')
      if (!controller.signal.aborted) {
        setResult(response)
        onSelectionChange((selected) => response.state === 'READY' && response.formations.some(f=>f.formationId === selected) ? selected : null)
      }
    } catch (failure) {
      if (controller.signal.aborted) return
      onSelectionChange(null)
      setError(failure instanceof FormationReadError ? failure.message : 'Formations unavailable. Refresh to try again.')
      if (failure instanceof FormationReadError && ['session', 'username'].includes(failure.reason)) {
        try { await onSessionError() } catch { /* Private data is already cleared. */ }
      }
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [matchId, world, onSessionError, onSelectionChange])
  useEffect(() => {
    let cancelled = false; queueMicrotask(() => { if (!cancelled) void refresh() })
    const online=()=>void refresh();window.addEventListener('online',online)
    return () => { cancelled = true; read.current?.abort();window.removeEventListener('online',online) }
  }, [refresh])
  useEffect(()=>{if((result?.schemaVersion===4||result?.schemaVersion===5||result?.schemaVersion===6))onLoopReady?.()},[result?.schemaVersion,onLoopReady])
  const own = result?.state === 'READY' ? (result.formations[0]??null) : null
  const expanded = !!own && selectedFormationId === own.formationId
  const infantryCount = own?.units.filter((unit) => unit.kind === 'INFANTRY').length ?? 0
  function inspect() {
    if (!own) return
    onSelectionChange(own.formationId)
    requestFocus((value) => value + 1)
  }
  const mapFormation = useMemo(() => own ? {...own,units:[...own.units]} : null, [own])
  if((result?.schemaVersion===4||result?.schemaVersion===5||result?.schemaVersion===6))return <>{renderLoop?.(result.schemaVersion===6?3:result.schemaVersion===5?2:1)}</>
  return <>{map(mapFormation, { markerId, detailsId, expanded, inspect },result?.schemaVersion!==1&&result?.state==='READY'?{radius:10,pending:result.pendingEncounter,combat:result.schemaVersion===3}:undefined)}<section ref={panel} tabIndex={-1} className="panel formation-panel" aria-labelledby={title} aria-busy={loading}
    onKeyDown={(event) => { if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); closeDetails() } }}>
    <div className="section-heading"><h2 id={title}>Your formations</h2><button type="button" disabled={loading} onClick={() => void refresh()}>Refresh formations</button></div>
    {loading ? <p role="status">Loading formations…</p> : error ? <p role="alert">{error}</p>
      : own ? <ul className="formation-list"><li><button type="button" aria-expanded={expanded} aria-controls={detailsId}
          onClick={() => expanded ? closeDetails() : inspect()}>◇ {own.units.some(u=>u.kind==='LEADER')?'Lieutenant + ':''}{infantryCount} Infantry</button>
        <div id={detailsId} hidden={!expanded} className="formation-details">
        <h3 ref={heading} tabIndex={-1}>Formation details</h3>
        <p>{own.units.some(u=>u.kind==='LEADER')?'Lieutenant · Infantry specialization · ':''}{infantryCount} Infantry</p>
        <button type="button" onClick={closeDetails}>Return to map marker</button>
        <dl><dt>Formation</dt><dd className="formation-id">{own.formationId}</dd><dt>Position</dt><dd>{own.position.x}, {own.position.y} {result?.schemaVersion!==1&&result?.state==='READY'?'(stored authoritative position)':'(authoritative starting capital position)'}</dd></dl>
        {result?.schemaVersion === 2 && <p>Pending battle: {result.pendingEncounter ? 'Yes' : 'No'}.</p>}
        <ul>{own.units.map((u) => <li key={u.unitId}>
          {u.kind === 'LEADER' ? 'Lieutenant · Infantry specialization' : 'Infantry'}
          <dl><dt>Unit</dt><dd className="formation-id">{u.unitId}</dd>{'hp' in u&&<><dt>HP</dt><dd>{String(u.hp)}/{'maxHp' in u?String(u.maxHp):'?'} HP</dd></>}<dt>Original spawn node</dt><dd className="formation-id">{u.originalSpawnNodeId}</dd></dl>
        </li>)}</ul>
      </div></li></ul>
        : <p role="status">{result?.schemaVersion===3&&result.state==='READY'?'Your formations were destroyed. Own losses remain available in battle aftermath.':result?.state === 'NOT_STARTED' ? 'This match has not started.' : 'Formations are unavailable for this older match. Refreshing will not initialize armies.'}</p>}
    <p className="small muted">◇ marks your formation. {result?.schemaVersion!==1&&result?.state==='READY'?'Circle: radius 10 world units. Marker positions come from stored state. Refresh after server processing.':'Read-only starting armies; movement and turn controls are unavailable.'}</p>
  </section></>
}
