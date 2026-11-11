import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ReadWorldResponseSchema } from '@strategy-game/shared-types'
import type { PublicWorld, ReadWorldResponse } from '@strategy-game/shared-types'
import { lobbyRequest, LobbyRequestError } from './lobby-api'

function MapView({ world }: { world: PublicWorld }) {
  const [selection, setSelection] = useState(0)
  const refs = useRef(new Map<string, SVGPolygonElement>())
  const selected = world.territories[selection] ?? world.territories[0]!
  const owner = (id: string | null) => world.players.find((p) => p.playerId === id)?.username ?? 'Neutral'
  const color = (id: string | null) => id === null ? '#C9CDD6' : `hsl(${(40 + world.players.findIndex((p) => p.playerId === id) * 137.508) % 360} 65% 65%)`
  const terrain = { PLAINS: '#243d30', FOREST: '#163025', HILLS: '#544b38' }
  function navigate(event: KeyboardEvent<SVGPolygonElement>, index: number) {
    const current = world.territories[index]!
    const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection(index); return }
    const step = directions[event.key]
    if (!step) return
    event.preventDefault()
    const next = world.territories.findIndex((t) => t.row === current.row + step[0] && t.column === current.column + step[1])
    if (next >= 0) { setSelection(next); refs.current.get(world.territories[next]!.territoryId)?.focus() }
  }
  const adjacent = world.links.filter((e) => e.a === selected.territoryId || e.b === selected.territoryId).map((e) => e.a === selected.territoryId ? e.b : e.a)
  return <>
    <p className="muted">Initial map shared with active participants. Select a territory, or use Tab and arrow keys. Borders show adjacency; movement is not implemented.</p>
    <ul className="world-legend" aria-label="Player colors">{world.players.map((p) => <li key={p.playerId}><span aria-hidden="true" style={{ color: color(p.playerId) }}>■</span> {p.username}</li>)}<li>★ Capital · Neutral territories have silver borders</li></ul>
    <div className="world-grid"><div className="world-map">
      <svg viewBox={`0 0 ${world.bounds.width} ${world.bounds.height}`} role="group" aria-label="Initial territory map">
        {world.territories.map((t, index) => <g key={t.territoryId}>
          <polygon ref={(node) => { if (node) refs.current.set(t.territoryId, node); else refs.current.delete(t.territoryId) }}
            points={t.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={terrain[t.terrain]}
            stroke={index === selection ? '#D4AF37' : color(t.ownerPlayerId)} strokeWidth={index === selection ? 5 : 2} vectorEffect="non-scaling-stroke"
            role="button" tabIndex={index === selection ? 0 : -1} aria-pressed={index === selection}
            aria-label={`Territory ${t.territoryId}, ${t.terrain}, ${owner(t.ownerPlayerId)}${t.capital ? ', capital' : ''}`}
            onFocus={() => setSelection(index)} onClick={() => setSelection(index)} onKeyDown={(event) => navigate(event, index)} />
          {t.capital && <text x={t.center.x} y={t.center.y} fontSize="40" fill={color(t.ownerPlayerId)} textAnchor="middle" dominantBaseline="central" pointerEvents="none" aria-hidden="true">★</text>}
        </g>)}
      </svg></div>
      <section className="panel territory-inspector" aria-label="Territory inspector" aria-live="polite">
        <h2>Territory inspector</h2><h3>{selected.territoryId}</h3>
        <dl><dt>Terrain</dt><dd>{selected.terrain}</dd><dt>Owner</dt><dd>{owner(selected.ownerPlayerId)}</dd>
          <dt>City</dt><dd>{selected.city ? 'Capital' : 'None'}</dd><dt>Position</dt><dd>{selected.center.x}, {selected.center.y}</dd>
          <dt>Resources</dt><dd>{selected.resources.length ? 'Military Supplies: 0 (initial fixture)' : 'None'}</dd>
          <dt>Adjacent territories</dt><dd>{adjacent.join(', ')}</dd></dl>
        <p className="small muted">Read-only initial world. No armies, economy processing or turns are running.</p>
      </section>
    </div>
  </>
}

export default function WorldView({ matchId, onClose, onSessionError }: { matchId: string; onClose: () => void; onSessionError: () => Promise<void> }) {
  const [result, setResult] = useState<ReadWorldResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const read = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller
    setLoading(true); setResult(null); setError('')
    try {
      const response = await lobbyRequest(`/api/matches/${encodeURIComponent(matchId)}/world`, ReadWorldResponseSchema, controller.signal)
      if (response.matchId !== matchId) throw new Error('Mismatched response')
      if (!controller.signal.aborted) setResult(response)
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof LobbyRequestError && ['UNAUTHENTICATED', 'USERNAME_REQUIRED'].includes(failure.code ?? '')) await onSessionError()
      if (!controller.signal.aborted) setError(failure instanceof LobbyRequestError && failure.code === 'NOT_FOUND'
        ? 'World unavailable or you no longer have access to this match.' : 'Unable to load the world. Refresh to try again.')
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [matchId, onSessionError])
  useEffect(() => {
    let cancelled = false; queueMicrotask(() => { if (!cancelled) void refresh() })
    return () => { cancelled = true; read.current?.abort() }
  }, [refresh])
  return <section className="world-workspace" aria-labelledby="world-title" aria-busy={loading}>
    <div className="section-heading"><h1 id="world-title">Initial world</h1><button onClick={onClose}>Back to lobbies</button><button disabled={loading} onClick={() => void refresh()}>Refresh world</button></div>
    {loading ? <p role="status">Loading world…</p> : error ? <p role="alert">{error}</p>
      : result?.state === 'READY' ? <MapView world={result.world} />
        : <p role="status">{result?.state === 'NOT_STARTED' ? 'This match has not started.' : 'This older match has no initialized world. Reading or retrying start will not create one.'}</p>}
  </section>
}
