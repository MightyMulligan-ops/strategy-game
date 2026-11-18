import {lazy,Suspense} from 'react'
const EuropeMap=lazy(()=>import('./europe/EuropeMap'))
import LoopWorkspace from './LoopWorkspace'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ReadWorldResponseSchema } from '@strategy-game/shared-types'
import type { MovementRoute, OwnFormation, PublicWorld, ReadWorldResponse } from '@strategy-game/shared-types'
import { lobbyRequest, LobbyRequestError } from './lobby-api'
import TurnStatus from './TurnStatus'
import Formations from './Formations'
import type { FormationInspection } from './Formations'
import MovementQueue from './MovementQueue'
import MovementResolution from './MovementResolution'

function MapView({ world, formation, route, choose, inspection,policy }: { inspection: FormationInspection; world: PublicWorld; formation: OwnFormation | null; route: MovementRoute | null; choose: ((point: { x: number; y: number }) => void) | null;policy?:{radius:10;pending:boolean;combat?:boolean;loop?:boolean} }) {
  const [selection, setSelection] = useState(0)
  const mapId = useId()
  const refs = useRef(new Map<string, SVGPolygonElement>())
  const inspector = useRef<HTMLHeadingElement>(null)
  const selected = world.territories[selection] ?? world.territories[0]!
  const owner = (id: string | null) => world.players.find((p) => p.playerId === id)?.username ?? 'Neutral'
  const ownerId = (id: string | null) => id === null ? 'Neutral' : `P${world.players.findIndex((p) => p.playerId === id) + 1}`
  const color = (id: string | null) => id === null ? '#C9CDD6' : `hsl(${(40 + world.players.findIndex((p) => p.playerId === id) * 137.508) % 360} 65% 65%)`
  const terrain = { PLAINS: '#243d30', FOREST: '#163025', HILLS: '#544b38' }
  // Preserve the public geometry while keeping even the narrowest cell readable.
  const smallestEdge = Math.min(...world.territories.flatMap((t) => [
    Math.max(...t.polygon.map((p) => p.x)) - Math.min(...t.polygon.map((p) => p.x)),
    Math.max(...t.polygon.map((p) => p.y)) - Math.min(...t.polygon.map((p) => p.y)),
  ]))
  const minimumWidth = Math.ceil(world.bounds.width * 48 / Math.max(1, smallestEdge))
  function keepVisible(node: SVGPolygonElement) {
    node.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  }
  function focusTerritory(index: number) {
    refs.current.get(world.territories[index]!.territoryId)?.focus({ preventScroll: true })
  }
  function navigate(event: KeyboardEvent<SVGPolygonElement>, index: number) {
    const current = world.territories[index]!
    const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection(index); return }
    const step = directions[event.key]
    if (!step) return
    event.preventDefault()
    const next = world.territories.findIndex((t) => t.row === current.row + step[0] && t.column === current.column + step[1])
    if (next >= 0) focusTerritory(next)
  }
  const adjacent = world.links.filter((e) => e.a === selected.territoryId || e.b === selected.territoryId).map((e) => e.a === selected.territoryId ? e.b : e.a)
  return <>
    <p className="muted" id={`${mapId}-instructions`}>Initial map shared with active participants. Ownership colors and territory owners are archived initial data, not current ownership. Authorized capture changes appear only in your battle aftermath. Tab enters the map at the selected territory. Arrow keys select neighboring territories without wrapping; Enter or Space selects. Tab reaches your own formation marker when available, or leaves the map; Shift+Tab moves back. Enter or Space on the marker opens formation details; Escape in details returns to the marker. Scroll to explore. Borders show adjacency; {policy?'movement outcomes are server-authoritative.':'movement is not implemented.'}</p>
    <ul className="world-legend" aria-label="Player identifiers">{world.players.map((p) => <li key={p.playerId}><span aria-hidden="true" style={{ color: color(p.playerId) }}>■</span> {ownerId(p.playerId)}: {p.username}</li>)}<li>★ Capital · Unmarked territories are neutral</li></ul>
    <p className="small muted">Terrain patterns: dots = plains, diagonal lines = forest, peaks = hills. Selection has a solid gold border; keyboard focus has an inset dashed outline.</p>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Selected {selected.territoryId}.</p>
    <button type="button" className="world-details-control" onClick={() => inspector.current?.focus()}>Inspect selected territory</button>
    {choose && <button type="button" onClick={() => choose(selected.center)}>Use selected territory center as destination</button>}
    <div className="world-grid"><div className="world-map">
      <svg viewBox={`0 0 ${world.bounds.width} ${world.bounds.height}`} width={world.bounds.width} height={world.bounds.height}
        style={{ minWidth: minimumWidth }} role="group" aria-label="Initial territory map" aria-describedby={`${mapId}-instructions`}>
        <defs>{Object.entries(terrain).map(([kind, fill]) => <pattern key={kind} id={`${mapId}-${kind}`} width="20" height="20" patternUnits="userSpaceOnUse">
          <rect className="world-terrain-base" width="20" height="20" fill={fill} />
          {kind === 'PLAINS' ? <circle className="world-terrain-mark" cx="10" cy="10" r="1" />
            : <path className="world-terrain-mark" d={kind === 'FOREST' ? 'M-5 5L5 -5M0 20L20 0M15 25L25 15' : 'M3 14L10 6L17 14'} />}
        </pattern>)}</defs>
        {world.territories.map((t, index) => <g key={t.territoryId}>
          <polygon ref={(node) => { if (node) refs.current.set(t.territoryId, node); else refs.current.delete(t.territoryId) }}
            className="world-territory" points={t.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={`url(#${mapId}-${t.terrain})`}
            stroke={index === selection ? '#D4AF37' : color(t.ownerPlayerId)} strokeWidth={index === selection ? 5 : 2} vectorEffect="non-scaling-stroke"
            role="button" tabIndex={index === selection ? 0 : -1} aria-pressed={index === selection}
            aria-label={`Territory ${t.territoryId}, row ${t.row + 1}, column ${t.column + 1}, ${t.terrain.toLowerCase()}, ${ownerId(t.ownerPlayerId)}${t.ownerPlayerId === null ? '' : `: ${owner(t.ownerPlayerId)}`}${t.capital ? ', capital' : ''}`}
            onFocus={(event) => { setSelection(index); keepVisible(event.currentTarget) }}
            onClick={(event) => {
              focusTerritory(index)
              const svg = event.currentTarget.ownerSVGElement, matrix = svg?.getScreenCTM?.()
              if (choose && svg && matrix) {
                const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY
                const target = point.matrixTransform(matrix.inverse()); choose({ x: Math.round(target.x), y: Math.round(target.y) })
              }
            }} onKeyDown={(event) => navigate(event, index)} />
          {(t.capital || t.ownerPlayerId !== null) && <text className="world-owner-marker" x={t.center.x} y={t.center.y}
            textAnchor="middle" pointerEvents="none" aria-hidden="true">
            {t.capital && <tspan x={t.center.x} dy="-6">★</tspan>}
            {t.ownerPlayerId !== null && <tspan x={t.center.x} dy={t.capital ? 26 : 7}>{ownerId(t.ownerPlayerId)}</tspan>}
          </text>}
        </g>)}
        {formation && <g id={inspection.markerId} className="formation-marker" transform={`translate(${formation.position.x} ${formation.position.y})`}
          role="button" tabIndex={0} aria-label={`Your formation: ${formation.units.some(u=>u.kind==='LEADER')?'Lieutenant, Infantry specialization, ':''}${formation.units.filter(u=>u.kind==='INFANTRY').length} Infantry. Inspect details`}
          aria-expanded={inspection.expanded} aria-controls={inspection.detailsId}
          onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' })}
          onClick={(event) => { event.stopPropagation(); inspection.inspect() }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); inspection.inspect() } }}>
          <path className="formation-hit-target" d="M0 -36L36 0L0 36L-36 0Z" />
          {policy&&<circle r={policy.radius} fill="none" stroke="#D4AF37" strokeWidth="1" data-testid="collision-circle"/>}
          {policy?.pending&&<text x="0" y="-42" textAnchor="middle" fill="#fff">Pending battle</text>}
          <path className="formation-symbol" d="M0 -36L36 0L0 36L-36 0Z" fill="none" stroke="#fff" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </g>}
        <g className="planned-route" aria-hidden="true" pointerEvents="none">{route?.segments.map((s) => <g key={s.orderId}>
          <line x1={s.from.x} y1={s.from.y} x2={s.destination.x} y2={s.destination.y} stroke="#D4AF37" strokeWidth="3" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
          <text x={s.destination.x + 10} y={s.destination.y - 12} fill="#fff">Move {s.moveNumber}</text>
        </g>)}</g>
      </svg></div>
      <section className="panel territory-inspector" aria-label="Territory inspector">
        <h2 ref={inspector} tabIndex={-1}>Territory inspector</h2><h3>{selected.territoryId}</h3>
        <button type="button" onClick={() => focusTerritory(selection)}>Return to selected territory</button>
        <dl><dt>Terrain</dt><dd>{selected.terrain}</dd><dt>Owner</dt><dd>{ownerId(selected.ownerPlayerId)}{selected.ownerPlayerId === null ? '' : `: ${owner(selected.ownerPlayerId)}`}</dd>
          <dt>City</dt><dd>{selected.city ? 'Capital' : 'None'}</dd><dt>Position</dt><dd>{selected.center.x}, {selected.center.y}</dd>
          <dt>Resources</dt><dd>{selected.resources.length ? 'Military Supplies: 0 (initial fixture)' : 'None'}</dd>
          <dt>Adjacent territories</dt><dd>{adjacent.join(', ')}</dd></dl>
        <p className="small muted">{policy?.loop?'Archived initial map; current own positions and ownership are in the repeating planning panel.':policy?.combat?'Immutable initial map; formation positions come from stored state. Consult your battle aftermath for authorized capture changes. Turn 2 has not opened.':policy?'Immutable initial map; formation markers show stored movement state. No combat or Turn 2.':'Read-only initial world. A saved Turn 1 may be open; movement, economy processing and turn controls are not available.'}</p>
      </section>
    </div>
  </>
}

function MatchWorldView({ matchId, onClose, onSessionError }: { matchId: string; onClose: () => void; onSessionError: () => Promise<void> }) {
  const [result, setResult] = useState<ReadWorldResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sessionUnavailable, setSessionUnavailable] = useState(false)
  const [isLoop,setIsLoop]=useState(false)
  const markLoop=useCallback(()=>setIsLoop(true),[])
  const [selectedFormationId, setSelectedFormationId] = useState<string | null>(null)
  const read = useRef<AbortController | null>(null)
  const sessionError = useCallback(async () => {
    read.current?.abort(); setResult(null); setSelectedFormationId(null); setSessionUnavailable(true)
    try { await onSessionError() } catch { /* Do not retain private match data on account failure. */ }
  }, [onSessionError])
  const refresh = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller
    setLoading(true); setResult(null); setError('')
    try {
      const response = await lobbyRequest(`/api/matches/${encodeURIComponent(matchId)}/world`, ReadWorldResponseSchema, controller.signal)
      if (response.matchId !== matchId) throw new Error('Mismatched response')
      if (!controller.signal.aborted) { setResult(response); if (response.state !== 'READY') setSelectedFormationId(null) }
    } catch (failure) {
      if (controller.signal.aborted) return
      setSelectedFormationId(null)
      if (failure instanceof LobbyRequestError && ['UNAUTHENTICATED', 'USERNAME_REQUIRED'].includes(failure.code ?? '')) await sessionError()
      if (!controller.signal.aborted) setError(failure instanceof LobbyRequestError && failure.code === 'NOT_FOUND'
        ? 'World unavailable or you no longer have access to this match.' : 'Unable to load the world. Refresh to try again.')
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [matchId, sessionError])
  useEffect(() => {
    let cancelled = false; queueMicrotask(() => { if (!cancelled) void refresh() })
    return () => { cancelled = true; read.current?.abort() }
  }, [refresh])
  if (sessionUnavailable) return <section className="world-workspace" aria-labelledby="world-title">
    <h1 id="world-title">Match unavailable</h1>
    <p role="alert">Your session is unavailable. Sign in or complete your username, then reopen this match.</p>
    <button type="button" onClick={onClose}>Back to lobbies</button>
  </section>
  return <section className="world-workspace" aria-labelledby="world-title" aria-busy={loading}>
    <div className="section-heading"><h1 id="world-title">Initial world</h1><button onClick={onClose}>Back to lobbies</button><button disabled={loading} onClick={() => void refresh()}>Refresh world</button></div>
    {loading ? <p role="status">Loading world…</p> : error ? <p role="alert">{error}</p>
      : result?.state === 'READY' ? <Formations matchId={matchId} world={result.world} onSessionError={sessionError}
        onLoopReady={markLoop} renderLoop={europe=><LoopWorkspace expectedSchemaVersion={europe?2:1} matchId={matchId} onSessionError={sessionError} map={(formation,route,inspection,context)=>context.view.schemaVersion===2?<Suspense fallback={<p role="status">Loading Europe display…</p>}><EuropeMap world={result.world} view={context.view} route={route} choose={context.choose}/></Suspense>:<MapView world={result.world} formation={formation} route={route} choose={null} inspection={inspection} policy={{radius:10,pending:false,combat:true,loop:true}}/>}/>} selectedFormationId={selectedFormationId} onSelectionChange={setSelectedFormationId}
        map={(formation,inspection,policy) => <><MovementQueue matchId={matchId} world={result.world} formation={formation} onSessionError={sessionError}
          map={(route, choose) => <MapView inspection={inspection} world={result.world} formation={formation} route={route} choose={choose} {...(policy?{policy}:{})} />} />{policy&&<MovementResolution matchId={matchId} onSessionError={sessionError} combat={policy.combat??false}/>}</>} />
        : result?.state === 'UNINITIALIZED' ? <section className="panel" role="status" aria-live="polite" aria-atomic="true" aria-labelledby="world-unavailable-title">
          <h2 id="world-unavailable-title">Map unavailable for this match</h2>
          <p>This match started before world-map support was added and has no saved map to display.</p>
          <p>Refreshing this view will not create a map. Return to lobbies to view a newer match.</p>
        </section>
          : result?.state === 'NOT_STARTED' ? <p role="status">This match has not started.</p> : null}
    {!isLoop&&<TurnStatus matchId={matchId} onSessionError={sessionError} />}
  </section>
}

export default function WorldView(props: { matchId: string; onClose: () => void; onSessionError: () => Promise<void> }) {
  return <MatchWorldView key={props.matchId} {...props} />
}
