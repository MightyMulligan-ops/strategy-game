import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import { EUROPE_FIXTURE_ID, EUROPE_MASK_ID, EUROPE_PROFILE, EUROPE_PROFILE_ID, EuropePreviewSessionSchema, europeMapToWorld, europeWorldToMap } from '../../../../packages/shared-types/src/europe-preview.js'
import type { EuropeMapPoint, EuropePreviewResult, EuropePreviewSession } from '../../../../packages/shared-types/src/europe-preview.js'
import { project, toScreen, toWorld } from './camera'
import type { Camera, Point, Viewport } from './camera'
import { createDefenseDraft, editDefenseDraft, insideEuropeMap } from './defense-draft'
import type { DraftAction } from './defense-draft'
import { EuropePreviewClient } from './preview-client'
import './planning.css'

export type PlanningMode = 'pan' | 'defense' | 'route'
export type PlanningHandle = { pick(world: Point): void; isDragging(): boolean }
type Props = { ref: Ref<PlanningHandle>; camera: Camera; view: Viewport; mode: PlanningMode; onModeChange(mode: PlanningMode): void; onCenter(point: Point): void }
const initial = [[-5, 41.2], [-4, 40.8], [-3, 40.4]].map(([lon, lat]) => europeWorldToMap(project(lon!, lat!)))
const identity = { schemaVersion: 1 as const, fixtureId: EUROPE_FIXTURE_ID, profileId: EUROPE_PROFILE_ID, maskId: EUROPE_MASK_ID } as const
const reasonText: Record<EuropePreviewResult['reason'], string> = {
  ELIGIBLE: 'Surface check passed. This is a prototype preview, not a committed order.',
  LAND_REQUIRED: 'Blocked: a land segment enters water.', OCEAN_REQUIRED: 'Blocked: a naval segment enters land.',
  INLAND_WATER_BLOCKED: 'Blocked: this inland water is not navigable in the prototype.',
  BOUNDARY_CONTACT: 'Blocked: the route touches the mapped coastline or water boundary.', OUT_OF_BOUNDS: 'Blocked: geometry leaves the supported theatre.',
}

export default function PlanningTools({ ref, camera, view, mode, onModeChange, onCenter }: Props) {
  const [draft, setDraft] = useState(() => createDefenseDraft(initial))
  const [route, setRoute] = useState(() => createDefenseDraft())
  const [session, setSession] = useState<EuropePreviewSession | null>(null)
  const [formationId, setFormationId] = useState<'iberian-division' | 'atlantic-fleet'>('iberian-division')
  const [result, setResult] = useState<EuropePreviewResult | null>(null)
  const [message, setMessage] = useState('Loading server surface preview…')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(() => window.innerWidth >= 900)
  const [client] = useState(() => new EuropePreviewClient())
  const drag = useRef<{ id: number; index: number; lastX: number; lastY: number; started: boolean } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/__prototype/europe/session', { credentials: 'omit', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return EuropePreviewSessionSchema.parse(await response.json()) })
      .then(value => { if (!controller.signal.aborted) { setSession(value); setMessage('Edit geometry, then request a server surface check.') } })
      .catch(() => { if (!controller.signal.aborted) setMessage('Surface preview unavailable. Start the Vite development server; draft editing still works.') })
    return () => { controller.abort(); client.invalidate() }
  }, [client])
  const invalidate = () => { client.invalidate(); setResult(null); setBusy(false); setMessage('Draft changed. Run the surface check again.') }
  const edit = (action: DraftAction) => { if (action.type !== 'select') invalidate(); setDraft(current => editDefenseDraft(current, action)) }
  const editRoute = (action: DraftAction) => { invalidate(); setRoute(current => editDefenseDraft(current, action)) }
  useImperativeHandle(ref, () => ({ isDragging: () => drag.current !== null, pick(world: Point) {
    const point = europeWorldToMap(world)
    if (!insideEuropeMap(point)) { setMessage('Choose a position inside the supported Europe theatre.'); return }
    if (mode === 'defense') edit({ type: 'add', point })
    if (mode === 'route') editRoute({ type: 'add', point })
  } }))
  const screen = (point: EuropeMapPoint) => toScreen(europeMapToWorld(point), camera, view)
  const formation = session?.formations.find(f => f.id === formationId)
  const selectFormation = (id: typeof formationId) => {
    invalidate(); setFormationId(id); setRoute(current => editDefenseDraft(current, { type: 'clear' }))
    const chosen = session?.formations.find(f => f.id === id)
    if (chosen) onCenter(europeMapToWorld(chosen.position))
    onModeChange('route'); setExpanded(true)
  }
  const path = (points: readonly EuropeMapPoint[]) => points.map(p => { const s = screen(p); return `${s.x},${s.y}` }).join(' ')
  const nudge = (index: number, dx: number, dy: number, checkpoint = true) => {
    const point = draft.points[index]
    if (!point) return false
    const s = screen(point)
    const moved = europeWorldToMap(toWorld({ x: s.x + dx, y: s.y + dy }, camera, view))
    const clamped = { x: Math.max(0, Math.min(EUROPE_PROFILE.width, moved.x)), y: Math.max(0, Math.min(EUROPE_PROFILE.height, moved.y)) }
    if (clamped.x === point.x && clamped.y === point.y) return false
    edit({ type: 'move', index, point: clamped, checkpoint })
    return true
  }
  const check = async (kind: 'DEFENSE' | 'ROUTE') => {
    if (!session) return
    setBusy(true); setResult(null); setMessage('Checking all segments against the server-owned surface mask…')
    const outcome = await client.validate(kind === 'DEFENSE'
      ? { ...identity, kind, revision: draft.revision, points: [...draft.points] }
      : { ...identity, kind, revision: route.revision, formationId, waypoints: [...route.points] })
    if (outcome.status === 'stale') return
    setBusy(false)
    if (outcome.status === 'error') { setMessage('Surface check unavailable or incompatible. No validation was accepted.'); return }
    setResult(outcome.result)
    setMessage(reasonText[outcome.result.reason] + (outcome.result.segmentIndex === null ? '' : ` Segment ${outcome.result.segmentIndex + 1}.`))
  }
  const defenseColor = result?.kind === 'DEFENSE' ? result.eligible ? '#7dd8ac' : '#ff8b7c' : '#d4af37'
  const routeColor = result?.kind === 'ROUTE' ? result.eligible ? '#7dd8ac' : '#ff8b7c' : '#c9cdd6'

  return <>
    <svg className="ep-planning-lines" width={view.width} height={view.height} aria-hidden="true">
      {draft.points.length > 1 && <polyline points={path(draft.points)} fill="none" stroke={defenseColor} strokeWidth={3} strokeDasharray="9 4" />}
      {formation && route.points.length > 0 && <polyline points={path([formation.position, ...route.points])} fill="none" stroke={routeColor} strokeWidth={3} strokeDasharray="3 6" />}
      {route.points.map((point, index) => { const p = screen(point); return <circle key={index} cx={p.x} cy={p.y} r={5} fill={routeColor} stroke="#0a0f16" strokeWidth={2} /> })}
    </svg>
    {draft.points.map((point, index) => {
      const p = screen(point)
      return <button key={index} data-planning-handle="true" className={`ep-defense-handle ${index === draft.selected ? 'selected' : ''}`}
        style={{ left: p.x, top: p.y }} tabIndex={index === draft.selected ? 0 : -1} aria-label={`Defense control point ${index + 1}`} aria-pressed={index === draft.selected}
        onClick={() => edit({ type: 'select', index })}
        onPointerDown={event => { event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); edit({ type: 'select', index }); drag.current = { id: event.pointerId, index, lastX: event.clientX, lastY: event.clientY, started: false } }}
        onPointerMove={event => {
          const previous = drag.current
          if (!previous || previous.id !== event.pointerId || previous.index !== index) return
          const dx = event.clientX - previous.lastX, dy = event.clientY - previous.lastY
          if (dx === 0 && dy === 0) return
          if (!nudge(index, dx, dy, !previous.started)) return
          drag.current = { ...previous, lastX: event.clientX, lastY: event.clientY, started: true }
        }} onPointerUp={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
        onPointerCancel={() => { if (drag.current?.started) edit({ type: 'undo' }); drag.current = null }}
        onKeyDown={event => {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          const step = event.shiftKey ? 10 : 1
          const directions: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
          const delta = directions[event.key]
          if (delta) { event.preventDefault(); event.stopPropagation(); nudge(index, ...delta) }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); drag.current = null; edit({ type: 'remove', index }) }
        }}><span>{index + 1}</span></button>
    })}
    {session?.formations.map(f => {
      const p = screen(f.position)
      return <button className={`ep-fixture-force ${f.domain === 'NAVAL' ? 'naval' : ''}`} style={{ left: p.x, top: p.y }} key={f.id}
        aria-label={`Inspect ${f.name}`} onClick={() => selectFormation(f.id)}>
        <span>{f.domain === 'NAVAL' ? 'N' : 'L'}</span>
      </button>
    })}
    <aside className={`ep-planning-panel ${expanded ? '' : 'collapsed'}`} aria-label="Defense drafts and surface previews">
      <button className="ep-planning-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>Planning tools {expanded ? '−' : '+'}</button>
      {expanded && <div className="ep-planning-content">
        <span className="ep-eyebrow">DEFENSE LINE · DRAFT ONLY</span>
        <p>No assigned forces, combat effects or live orders.</p>
        <p className={`ep-planning-status ${result ? result.eligible ? 'valid' : 'blocked' : ''}`} role="status" aria-live="polite" aria-atomic="true">{message}</p>
        <div className="ep-plan-modes"><button aria-pressed={mode === 'pan'} onClick={() => onModeChange('pan')}>Pan</button><button aria-pressed={mode === 'defense'} onClick={() => onModeChange('defense')}>Add points</button><button aria-pressed={mode === 'route'} onClick={() => onModeChange('route')}>Route</button></div>
        <p className="ep-planning-help">{mode === 'defense' ? 'Click to add a point; drag the background to pan.' : mode === 'route' ? 'Click route waypoints; the server supplies the formation origin.' : 'Drag to pan; scroll to zoom.'} Drag a numbered handle to adjust it.</p>
        <label htmlFor="ep-control-select">Control point · {draft.points.length}/32</label>
        <select id="ep-control-select" value={draft.selected ?? ''} disabled={!draft.points.length} onChange={event => edit({ type: 'select', index: Number(event.target.value) })}>
          {!draft.points.length && <option value="">No points</option>}{draft.points.map((_, index) => <option key={index} value={index}>Point {index + 1}</option>)}
        </select>
        <div className="ep-nudge" aria-label="Nudge selected control point">{([['Left', -1, 0], ['Up', 0, -1], ['Down', 0, 1], ['Right', 1, 0]] as const).map(([name, dx, dy]) => <button key={name} disabled={draft.selected === null} onClick={() => { if (draft.selected !== null) nudge(draft.selected, dx, dy) }} aria-label={`Nudge selected point ${name.toLowerCase()}`}>{name}</button>)}</div>
        <small>Focused handle: arrows = 1 screen pixel; Shift = 10. Delete removes it. Positions stay fixed when zooming.</small>
        <div className="ep-plan-actions"><button disabled={draft.selected === null} onClick={() => { if (draft.selected !== null) onCenter(europeMapToWorld(draft.points[draft.selected]!)) }}>Center point</button><button disabled={!draft.history.length} onClick={() => edit({ type: 'undo' })}>Undo edit</button><button disabled={draft.selected === null} onClick={() => { if (draft.selected !== null) edit({ type: 'remove', index: draft.selected }) }}>Remove point</button><button disabled={!draft.points.length} onClick={() => edit({ type: 'clear' })}>Clear line</button></div>
        <button className="ep-check" disabled={!session || draft.points.length < 2 || busy} onClick={() => { void check('DEFENSE') }}>Check defense surface</button>
        <div className="ep-rule" />
        <label htmlFor="ep-formation-select">Route preview · sample forces</label>
        <select id="ep-formation-select" value={formationId} disabled={!session} onChange={event => selectFormation(event.target.value as typeof formationId)}>
          {session ? session.formations.map(f => <option key={f.id} value={f.id}>{f.domain} · {f.name}</option>) : <option value="iberian-division">Loading fixtures…</option>}
        </select>
        <p className="ep-planning-help">L = land division; N = naval fleet. Inland water and coastline contact are blocked. These are surface checks, not full movement permission.</p>
        <div className="ep-plan-actions"><button disabled={!route.history.length} onClick={() => editRoute({ type: 'undo' })}>Undo waypoint</button><button disabled={!route.points.length} onClick={() => editRoute({ type: 'clear' })}>Clear route</button></div>
        <button className="ep-check" disabled={!session || !route.points.length || busy} onClick={() => { void check('ROUTE') }}>Check route surface · {route.points.length}/32</button>
        <small>In-memory drafts only. No match state or movement orders are changed.</small>
      </div>}
    </aside>
  </>
}
