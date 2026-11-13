import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReadTurnResponse } from '@strategy-game/shared-types'
import { readTurn, TurnReadError } from './turn-api'

function Timestamp({ value }: { value: number }) {
  const date = new Date(value)
  // The public contract permits safe-integer milliseconds beyond Date's calendar range.
  if (Number.isNaN(date.getTime())) return <>{value} milliseconds after 1970-01-01 00:00 UTC</>
  const iso = date.toISOString()
  return <time dateTime={iso}>{iso.replace('T', ' ').replace('Z', ' UTC')}</time>
}

function MatchTurnStatus({ matchId, onSessionError }: { matchId: string; onSessionError: () => Promise<void> }) {
  const title = useId()
  const [result, setResult] = useState<ReadTurnResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const read = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    read.current?.abort()
    const controller = new AbortController(); read.current = controller
    setResult(null); setError(''); setLoading(true)
    try {
      const response = await readTurn(matchId, controller.signal)
      if (!controller.signal.aborted) setResult(response)
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure instanceof TurnReadError ? failure.message : 'Turn information is unavailable. Refresh to try again.')
      if (failure instanceof TurnReadError && (failure.reason === 'session' || failure.reason === 'username')) {
        // Clear the panel before the account flow runs, even if account refresh fails.
        try { await onSessionError() } catch { /* Keep account errors private. */ }
      }
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [matchId, onSessionError])
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) void refresh() })
    return () => { cancelled = true; read.current?.abort() }
  }, [refresh])

  useEffect(() => {
    const update = (event: Event) => { if (event instanceof CustomEvent && event.detail === matchId) void refresh() }
    const reconnect = () => { void refresh() }
    window.addEventListener('sovereign-turn-refresh', update); window.addEventListener('online', reconnect)
    return () => { window.removeEventListener('sovereign-turn-refresh', update); window.removeEventListener('online', reconnect) }
  }, [matchId, refresh])
  return <section className="panel" aria-labelledby={title} aria-busy={loading}>
    <div className="section-heading"><h2 id={title}>Turn status</h2>
      <button type="button" disabled={loading} onClick={() => void refresh()}>Refresh turn</button></div>
    {loading ? <p role="status">Loading turn…</p> : error ? <p role="alert">{error}</p>
      : result?.state === 'NOT_STARTED' ? <p role="status">This match has not started a turn.</p>
        : result?.state === 'UNINITIALIZED' ? <p role="status">No saved turn is available for this match. Refreshing will not initialize a turn.</p>
          : result?.state === 'READY' ? <>
            <p>Turn data available. Your readiness is shown separately below.</p>
            <dl className="lobby-facts">
              <div><dt>Turn number</dt><dd>{result.turn.turnNumber}</dd></div>
              <div><dt>Stored status</dt><dd>{result.turn.status}</dd></div>
              <div><dt>Opened (UTC)</dt><dd><Timestamp value={result.turn.openedAtMs} /></dd></div>
              <div><dt>Deadline (UTC)</dt><dd><Timestamp value={result.turn.deadlineAtMs} /></dd></div>
              <div><dt>Your turn readiness</dt><dd>{result.own.ready ? 'Ready' : 'Not ready'}</dd></div>
              <div><dt>Your revision</dt><dd>{result.own.revision}</dd></div>
            </dl>
            <p className="small muted">Stored status only; this view does not advance turns. {result.turn.status==='resolved'?'Movement is resolved; combat has not occurred and Turn 2 has not opened.': result.turn.status === 'closed' ? 'CLOSED records frozen orders only; formations have not moved and Turn 2 has not opened.' : 'Gameplay processing is not available.'}</p>
          </> : null}
  </section>
}

export default function TurnStatus(props: { matchId: string; onSessionError: () => Promise<void> }) {
  return <MatchTurnStatus key={props.matchId} {...props} />
}
