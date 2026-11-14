import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { OwnFormation, PublicWorld, ReadFormationView } from '@strategy-game/shared-types'
import { FormationReadError, readFormations } from './formation-api'

/** Mounted only alongside a matching READY world. Unmount clears all private data. */
export default function Formations({ matchId, world, onSessionError, map }: {
  matchId: string; world: PublicWorld; onSessionError: () => Promise<void>; map: (formation: OwnFormation | null, policy?:{radius:10;pending:boolean}) => ReactNode
}) {
  const title = useId()
  const [result, setResult] = useState<ReadFormationView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const read = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller
    setLoading(true); setResult(null); setError('')
    try {
      const response = await readFormations(matchId, controller.signal)
      if (response.schemaVersion===1 && response.state === 'READY' && response.formations.some((f) => !world.territories.some((t) => t.capital && t.ownerPlayerId === f.ownerPlayerId && t.center.x === f.position.x && t.center.y === f.position.y))) throw new FormationReadError('malformed')
      if(response.state==='READY'&&response.formations.some(f=>!world.players.some(p=>p.playerId===f.ownerPlayerId)||f.position.x>world.bounds.width||f.position.y>world.bounds.height))throw new FormationReadError('malformed')
      if (!controller.signal.aborted) setResult(response)
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure instanceof FormationReadError ? failure.message : 'Formations unavailable. Refresh to try again.')
      if (failure instanceof FormationReadError && ['session', 'username'].includes(failure.reason)) {
        try { await onSessionError() } catch { /* Private data is already cleared. */ }
      }
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [matchId, world, onSessionError])
  useEffect(() => {
    let cancelled = false; queueMicrotask(() => { if (!cancelled) void refresh() })
    const online=()=>void refresh();window.addEventListener('online',online)
    return () => { cancelled = true; read.current?.abort();window.removeEventListener('online',online) }
  }, [refresh])
  const own = result?.state === 'READY' ? result.formations[0]! : null
  return <>{map(own,result?.schemaVersion===2?{radius:10,pending:result.pendingEncounter}:undefined)}<section className="panel" aria-labelledby={title} aria-busy={loading}>
    <div className="section-heading"><h2 id={title}>Your formations</h2><button type="button" disabled={loading} onClick={() => void refresh()}>Refresh formations</button></div>
    {loading ? <p role="status">Loading formations…</p> : error ? <p role="alert">{error}</p>
      : own ? <ul className="formation-list"><li><details><summary>◇ Lieutenant + 5 Infantry</summary>
        <dl><dt>Formation</dt><dd className="formation-id">{own.formationId}</dd><dt>Position</dt><dd>{own.position.x}, {own.position.y} {result?.schemaVersion===2?'(stored authoritative position)':'(capital)'}</dd></dl>
        <ul>{own.units.map((u) => <li key={u.unitId}>
          {u.kind === 'LEADER' ? 'Lieutenant · Infantry specialization' : 'Infantry'}
          <dl><dt>Unit</dt><dd className="formation-id">{u.unitId}</dd><dt>Original spawn node</dt><dd className="formation-id">{u.originalSpawnNodeId}</dd></dl>
        </li>)}</ul>
      </details></li></ul>
        : <p role="status">{result?.state === 'NOT_STARTED' ? 'This match has not started.' : 'Formations are unavailable for this older match. Refreshing will not initialize armies.'}</p>}
    <p className="small muted">◇ marks your formation. {result?.schemaVersion===2?'Circle: radius 10 world units. Marker positions come from stored state. Refresh after server processing.':'Read-only starting armies; movement and turn controls are unavailable.'}</p>
  </section></>
}
