import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, SyntheticEvent } from 'react'
import type { MovementDraftOrder, MovementDraftRequest, MovementRoute, OwnFormation, PublicWorld, ReadMovementQueue } from '@strategy-game/shared-types'
import { MovementRequestError, readMovementDraft, writeMovementDraft, writeTurnReady } from './movement-api'

type Point = { x: number; y: number }
export default function MovementQueue({ matchId, world, formation, onSessionError, map }: {
  matchId: string; world: PublicWorld; formation: OwnFormation | null; onSessionError: () => Promise<void>
  map: (route: MovementRoute | null, choose: ((point: Point) => void) | null) => ReactNode
}) {
  const id = useId()
  const [result, setResult] = useState<ReadMovementQueue | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [selected, setSelected] = useState(false), [choosing, setChoosing] = useState(false)
  const [x, setX] = useState(''), [y, setY] = useState(''), [editing, setEditing] = useState<string | null>(null)
  const [destinationFocusRequest, requestDestinationFocus] = useState(0)
  const read = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null), locked = useRef(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const destinationX = useRef<HTMLInputElement>(null)
  useEffect(() => { if (destinationFocusRequest > 0) destinationX.current?.focus() }, [destinationFocusRequest])
  const validateContext = useCallback((response: ReadMovementQueue) => {
    if (response.state === 'READY' && (!formation || response.route.formationId !== formation.formationId ||
      response.route.segments.some((s) => s.destination.x > world.bounds.width || s.destination.y > world.bounds.height) ||
      (response.route.segments[0] && (response.route.segments[0].from.x !== formation.position.x || response.route.segments[0].from.y !== formation.position.y)))) throw new MovementRequestError()
    return response
  }, [formation, world])
  const handleAccess = useCallback(async (failure: unknown) => {
    if (failure instanceof MovementRequestError && ['UNAUTHENTICATED', 'USERNAME_REQUIRED', 'NOT_FOUND'].includes(failure.code ?? '')) {
      setResult(null)
      try { await onSessionError() } catch { /* Private state stays cleared. */ }
    }
  }, [onSessionError])
  const refresh = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller
    setResult(null); setError(''); setNotice(''); setLoading(true); setSelected(false); setChoosing(false); setEditing(null); setX(''); setY(''); requestDestinationFocus(0)
    if (!formation) { setLoading(false); return }
    try {
      const response = validateContext(await readMovementDraft(matchId, controller.signal))
      if (!controller.signal.aborted) { setResult(response); if (response.schemaVersion === 2) window.dispatchEvent(new CustomEvent('sovereign-turn-refresh', { detail: matchId })) }
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure instanceof MovementRequestError ? failure.message : 'Unable to load movement drafts.')
      await handleAccess(failure)
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [matchId, formation, validateContext, handleAccess])
  useEffect(() => {
    let cancelled = false; queueMicrotask(() => { if (!cancelled) { locked.current = false; setBusy(false); void refresh() } })
    return () => { cancelled = true; read.current?.abort(); write.current?.abort(); locked.current = false }
  }, [refresh])
  const ready = formation && result?.state === 'READY' && result.matchId === matchId && result.route.formationId === formation.formationId ? result : null
  const canEdit = !!ready && ready.turn.status === 'open' && !ready.own.ready
  useEffect(() => {
    const reconnect = () => { if (!locked.current) void refresh() }
    window.addEventListener('online', reconnect)
    return () => window.removeEventListener('online', reconnect)
  }, [refresh])
  async function changeReadiness() {
    if (locked.current || !ready || ready.schemaVersion !== 2 || ready.turn.status !== 'open') return
    locked.current = true; setBusy(true); setChoosing(false); setError(''); setNotice('')
    const controller = new AbortController(); write.current = controller
    try {
      await writeTurnReady(matchId, ready.own.revision, !ready.own.ready, controller.signal)
      if (!controller.signal.aborted) { await refresh(); window.dispatchEvent(new CustomEvent('sovereign-turn-refresh', { detail: matchId })) }
    } catch (failure) {
      if (controller.signal.aborted) return
      await refresh() // Reconcile stale, late and uncertain commands, never replay a POST.
      setNotice(failure instanceof MovementRequestError ? failure.message : 'Readiness could not be verified. Review the refreshed state.')
      await handleAccess(failure)
    } finally { if (!controller.signal.aborted) { locked.current = false; setBusy(false) } }
  }
  async function submit(command: MovementDraftRequest) {
    if (locked.current || !ready || !canEdit) return
    locked.current = true; setBusy(true); setChoosing(false); setError(''); setNotice('')
    const controller = new AbortController(); write.current = controller
    try {
      const response = await writeMovementDraft(matchId, command, controller.signal)
      try { validateContext(response) } catch { throw new MovementRequestError(undefined, true) }
      if (!controller.signal.aborted) { setResult(response); setEditing(null); setX(''); setY(''); setNotice('Draft saved. The dotted route shows your accepted queue.') }
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof MovementRequestError && (failure.uncertain || ['STALE_REVISION', 'TURN_CLOSED', 'READY_LOCKED', 'DEADLINE_PASSED'].includes(failure.code ?? ''))) {
        await refresh() // One read-only reconciliation; never repeat the mutation.
        if (!controller.signal.aborted) setNotice(failure.uncertain
          ? 'The save outcome was uncertain. The authoritative queue was requested; review it before making another change.' : failure.message)
      } else {
        setError(failure instanceof MovementRequestError ? failure.message : 'Unable to save the draft.')
        await handleAccess(failure)
      }
    } finally { if (!controller.signal.aborted) { locked.current = false; setBusy(false) } }
  }
  function replace(orders: readonly MovementDraftOrder[]) {
    if (ready) void submit({ schemaVersion: 1, kind: 'replace_orders', expectedRevision: ready.own.revision, orders })
  }
  function destination(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!formation || !ready || !selected || busy) return
    const point = { x: Number(x), y: Number(y) }
    if (!x.trim() || !y.trim() || !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y) || point.x < 0 || point.y < 0 || point.x > world.bounds.width || point.y > world.bounds.height) { setError('Enter integer coordinates inside this map.'); return }
    const order: MovementDraftOrder = { type: 'move', orderId: editing ?? crypto.randomUUID(), stackId: formation.formationId, destination: point }
    replace(editing ? ready.own.orders.map((old) => old.orderId === editing ? order : old) : [...ready.own.orders, order])
  }
  function reorder(index: number, offset: number) {
    if (!ready) return
    const orders = [...ready.own.orders], target = index + offset
    if (target < 0 || target >= orders.length) return
    const moving = orders[index]!; orders[index] = orders[target]!; orders[target] = moving
    replace(orders)
  }
  const choose = choosing && ready && selected && !busy && canEdit ? (point: Point) => {
    setX(String(point.x)); setY(String(point.y)); setChoosing(false); setNotice('Destination selected. Add or save it to change your draft.')
    requestDestinationFocus((value) => value + 1)
  } : null
  return <>{map(ready?.route ?? null, choose)}{formation && <section className="panel movement-queue" aria-labelledby={id} aria-busy={loading || busy}>
    <div className="section-heading"><h2 id={id}>Movement Queue</h2><button type="button" disabled={loading || busy} onClick={() => void refresh()}>Refresh movement queue</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading movement queue…</p> : ready ? <>
      <p>Planned route only. Your formation stays at its capital. No movement or encounters execute.</p>
      <p>Revision {ready.own.revision} · Distance {ready.route.distance.toFixed(2)} / 250 · Remaining {ready.route.remaining.toFixed(2)} map units</p>
      {ready.schemaVersion === 2 && <div aria-label="Turn readiness">
        <p role="status">Authoritative Turn 1: {ready.turn.status.toUpperCase()} · Your status: {ready.own.ready ? 'Ready' : 'Unready'}.</p>
        {ready.turn.status === 'open' ? <>
          <p>Informational countdown: {Math.max(0, Math.ceil((ready.turn.deadlineAtMs - now) / 1000))} seconds. Only the server closes the turn.</p>
          <button type="button" disabled={busy} onClick={() => void changeReadiness()}>{ready.own.ready ? 'Become Unready' : 'Mark Ready'}</button>
          {ready.own.ready && <p>Editing is locked until you explicitly become Unready before closure.</p>}
        </> : <p>Turn 1 is closed. These orders are frozen; formations have not moved and Turn 2 has not opened.</p>}
      </div>}
      <form onSubmit={destination} className="movement-entry">
        <div className="movement-field"><label htmlFor={`${id}-formation`}>Owned formation</label><select id={`${id}-formation`} value={selected ? formation.formationId : ''} disabled={busy || !canEdit}
          onChange={(e) => { setSelected(e.target.value === formation.formationId); setChoosing(false) }}>
          <option value="">Select your formation</option><option value={formation.formationId}>Lieutenant + 5 Infantry</option></select></div>
        <label htmlFor={`${id}-x`}>Destination X<input ref={destinationX} id={`${id}-x`} type="number" min="0" max={world.bounds.width} step="1" required value={x} disabled={busy || !canEdit || !selected} onChange={(e) => setX(e.target.value)} /></label>
        <label htmlFor={`${id}-y`}>Destination Y<input id={`${id}-y`} type="number" min="0" max={world.bounds.height} step="1" required value={y} disabled={busy || !canEdit || !selected} onChange={(e) => setY(e.target.value)} /></label>
        <button type="button" disabled={busy || !canEdit || !selected} aria-pressed={choosing} onClick={() => setChoosing(!choosing)}>Choose destination on map</button>
        <button type="submit" disabled={busy || !canEdit || !selected}>{editing ? 'Save destination' : 'Add movement'}</button>
        {editing && <button type="button" disabled={busy || !canEdit} onClick={() => { setEditing(null); setX(''); setY('') }}>Discard destination edit</button>}
      </form>
      {choosing && <p role="status">Click the map to fill coordinates, or use the selected territory center. Then save the destination.</p>}
      {ready.own.orders.length ? <ol className="movement-list">{ready.route.segments.map((segment, index) => <li key={segment.orderId}>
        <p>Move {segment.moveNumber}: {segment.destination.x}, {segment.destination.y} · Segment {segment.distance.toFixed(2)} · Cumulative {segment.cumulative.toFixed(2)}</p>
        <div className="movement-actions">
          <button type="button" disabled={busy || !canEdit} onClick={() => { setSelected(true); setEditing(segment.orderId); setX(String(segment.destination.x)); setY(String(segment.destination.y)); setChoosing(false) }}>Edit Move {segment.moveNumber}</button>
          <button type="button" disabled={busy || !canEdit || index === 0} onClick={() => reorder(index, -1)}>Move {segment.moveNumber} earlier</button>
          <button type="button" disabled={busy || !canEdit || index === ready.own.orders.length - 1} onClick={() => reorder(index, 1)}>Move {segment.moveNumber} later</button>
          <button type="button" disabled={busy || !canEdit} onClick={() => void submit({ schemaVersion: 1, kind: 'cancel_order', expectedRevision: ready.own.revision, orderId: segment.orderId })}>Cancel Move {segment.moveNumber}</button>
        </div></li>)}</ol> : <p>No saved movement orders.</p>}
      <p className="small muted">The server checks the full route and deadline on every save. Refresh after an uncertain save; requests are never automatically resubmitted.</p>
    </> : !error && <p role="status">Movement drafts are unavailable for this match.</p>}
  </section>}</>
}
