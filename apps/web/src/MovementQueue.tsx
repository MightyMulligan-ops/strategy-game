import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, SyntheticEvent } from 'react'
import type { MovementDraftOrder, MovementDraftRequest, MovementRoute, OwnFormation, PublicWorld, ReadMovementDraft } from '@strategy-game/shared-types'
import { MovementRequestError, readMovementDraft, writeMovementDraft } from './movement-api'

type Point = { x: number; y: number }
export default function MovementQueue({ matchId, world, formation, onSessionError, map }: {
  matchId: string; world: PublicWorld; formation: OwnFormation | null; onSessionError: () => Promise<void>
  map: (route: MovementRoute | null, choose: ((point: Point) => void) | null) => ReactNode
}) {
  const id = useId()
  const [result, setResult] = useState<ReadMovementDraft | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [selected, setSelected] = useState(false), [choosing, setChoosing] = useState(false)
  const [x, setX] = useState(''), [y, setY] = useState(''), [editing, setEditing] = useState<string | null>(null)
  const [destinationFocusRequest, requestDestinationFocus] = useState(0)
  const read = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null), locked = useRef(false)
  const destinationX = useRef<HTMLInputElement>(null)
  useEffect(() => { if (destinationFocusRequest > 0) destinationX.current?.focus() }, [destinationFocusRequest])
  const validateContext = useCallback((response: ReadMovementDraft) => {
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
      if (!controller.signal.aborted) setResult(response)
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
  async function submit(command: MovementDraftRequest) {
    if (locked.current || !ready) return
    locked.current = true; setBusy(true); setChoosing(false); setError(''); setNotice('')
    const controller = new AbortController(); write.current = controller
    try {
      const response = await writeMovementDraft(matchId, command, controller.signal)
      try { validateContext(response) } catch { throw new MovementRequestError(undefined, true) }
      if (!controller.signal.aborted) { setResult(response); setEditing(null); setX(''); setY(''); setNotice('Draft saved. The dotted route shows your accepted queue.') }
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof MovementRequestError && (failure.uncertain || failure.code === 'STALE_REVISION')) {
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
  const choose = choosing && ready && selected && !busy ? (point: Point) => {
    setX(String(point.x)); setY(String(point.y)); setChoosing(false); setNotice('Destination selected. Add or save it to change your draft.')
    requestDestinationFocus((value) => value + 1)
  } : null
  return <>{map(ready?.route ?? null, choose)}{formation && <section className="panel movement-queue" aria-labelledby={id} aria-busy={loading || busy}>
    <div className="section-heading"><h2 id={id}>Movement Queue</h2><button type="button" disabled={loading || busy} onClick={() => void refresh()}>Refresh movement queue</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading movement queue…</p> : ready ? <>
      <p>Planned route only. Your formation stays at its capital. No movement or encounters execute.</p>
      <p>Revision {ready.own.revision} · Distance {ready.route.distance.toFixed(2)} / 250 · Remaining {ready.route.remaining.toFixed(2)} map units</p>
      <form onSubmit={destination} className="movement-entry">
        <div className="movement-field"><label htmlFor={`${id}-formation`}>Owned formation</label><select id={`${id}-formation`} value={selected ? formation.formationId : ''} disabled={busy}
          onChange={(e) => { setSelected(e.target.value === formation.formationId); setChoosing(false) }}>
          <option value="">Select your formation</option><option value={formation.formationId}>Lieutenant + 5 Infantry</option></select></div>
        <label htmlFor={`${id}-x`}>Destination X<input ref={destinationX} id={`${id}-x`} type="number" min="0" max={world.bounds.width} step="1" required value={x} disabled={busy || !selected} onChange={(e) => setX(e.target.value)} /></label>
        <label htmlFor={`${id}-y`}>Destination Y<input id={`${id}-y`} type="number" min="0" max={world.bounds.height} step="1" required value={y} disabled={busy || !selected} onChange={(e) => setY(e.target.value)} /></label>
        <button type="button" disabled={busy || !selected} aria-pressed={choosing} onClick={() => setChoosing(!choosing)}>Choose destination on map</button>
        <button type="submit" disabled={busy || !selected}>{editing ? 'Save destination' : 'Add movement'}</button>
        {editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setX(''); setY('') }}>Discard destination edit</button>}
      </form>
      {choosing && <p role="status">Click the map to fill coordinates, or use the selected territory center. Then save the destination.</p>}
      {ready.own.orders.length ? <ol className="movement-list">{ready.route.segments.map((segment, index) => <li key={segment.orderId}>
        <p>Move {segment.moveNumber}: {segment.destination.x}, {segment.destination.y} · Segment {segment.distance.toFixed(2)} · Cumulative {segment.cumulative.toFixed(2)}</p>
        <div className="movement-actions">
          <button type="button" disabled={busy} onClick={() => { setSelected(true); setEditing(segment.orderId); setX(String(segment.destination.x)); setY(String(segment.destination.y)); setChoosing(false) }}>Edit Move {segment.moveNumber}</button>
          <button type="button" disabled={busy || index === 0} onClick={() => reorder(index, -1)}>Move {segment.moveNumber} earlier</button>
          <button type="button" disabled={busy || index === ready.own.orders.length - 1} onClick={() => reorder(index, 1)}>Move {segment.moveNumber} later</button>
          <button type="button" disabled={busy} onClick={() => void submit({ schemaVersion: 1, kind: 'cancel_order', expectedRevision: ready.own.revision, orderId: segment.orderId })}>Cancel Move {segment.moveNumber}</button>
        </div></li>)}</ol> : <p>No saved movement orders.</p>}
      <p className="small muted">The server checks the full route and deadline on every save. Refresh after an uncertain save; requests are never automatically resubmitted.</p>
    </> : !error && <p role="status">Movement drafts are unavailable for this match.</p>}
  </section>}</>
}
