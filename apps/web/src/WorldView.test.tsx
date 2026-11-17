// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorldView from './WorldView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const world = { visibility: 'INITIAL_SHARED', bounds: { width: 200, height: 100 }, grid: { columns: 2, rows: 1 },
  players: [{ playerId: 'a', username: 'Commander' }, { playerId: 'b', username: 'Captain' }],
  territories: [0, 1].map((i) => ({ territoryId: `t${i}`, row: 0, column: i,
    polygon: [{ x: i * 100, y: 0 }, { x: i * 100 + 100, y: 0 }, { x: i * 100 + 100, y: 100 }, { x: i * 100, y: 100 }],
    center: { x: i * 100 + 50, y: 50 }, terrain: i === 0 ? 'PLAINS' : 'FOREST', ownerPlayerId: i === 0 ? 'a' : 'b', capital: true,
    city: { cityId: `c${i}`, kind: 'CAPITAL' }, resources: [{ nodeId: `n${i}`, kind: 'MILITARY_SUPPLIES', stockpile: 0 }] })), links: [{ a: 't0', b: 't1' }] }
const ready = { schemaVersion: 1, matchId: 'match', state: 'READY', world }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>
const request = vi.fn(); const close = vi.fn(); const session = vi.fn(async () => {})
const turnRequest = vi.fn()
const formationRequest = vi.fn()
const movementRequest = vi.fn()
const transport = vi.fn((path: string, options: RequestInit) => path.endsWith('/orders') ? movementRequest(path, options) : path.endsWith('/turn') ? turnRequest(path, options) : path.endsWith('/formations') ? formationRequest(path, options) : request(path, options))
const turnReady = { schemaVersion: 1, matchId: 'match', state: 'READY',
  turn: { schemaVersion: 1, gameId: 'match', turnNumber: 1, status: 'open', openedAtMs: 1000, deadlineAtMs: 2000 },
  own: { schemaVersion: 1, gameId: 'match', turnNumber: 1, revision: 9, ready: false, orders: [] } }
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  request.mockReset().mockImplementation(async () => json(ready)); close.mockReset(); session.mockClear()
  turnRequest.mockReset().mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'UNINITIALIZED' }))
  formationRequest.mockReset().mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'UNSUPPORTED' }))
  movementRequest.mockReset().mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'UNSUPPORTED' }))
  transport.mockClear(); vi.stubGlobal('fetch', transport)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount() { await act(async () => root.render(<StrictMode><WorldView matchId="match" onClose={close} onSessionError={session} /></StrictMode>)) }
async function click(name: string) { await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!.click()) }
function gridWorld(columns = 3, rows = 3) {
  return { ...world, bounds: { width: columns * 100, height: rows * 100 }, grid: { columns, rows },
    territories: Array.from({ length: columns * rows }, (_, i) => {
      const row = Math.floor(i / columns); const column = i % columns
      return { ...world.territories[i % 2]!, territoryId: `t${i}`, row, column,
        polygon: [{ x: column * 100, y: row * 100 }, { x: column * 100 + 100, y: row * 100 },
          { x: column * 100 + 100, y: row * 100 + 100 }, { x: column * 100, y: row * 100 + 100 }],
        center: { x: column * 100 + 50, y: row * 100 + 50 }, terrain: ['PLAINS', 'FOREST', 'HILLS'][i % 3],
        ownerPlayerId: i < 2 ? world.players[i]!.playerId : null, capital: i < 2,
        city: i < 2 ? world.territories[i]!.city : null, resources: [] }
    }), links: Array.from({ length: columns * rows }, (_, i) => [
      ...(i % columns + 1 < columns ? [i + 1] : []), ...(i + columns < columns * rows ? [i + columns] : []),
    ].map((next) => { const [a, b] = [`t${i}`, `t${next}`].sort(); return { a, b } })).flat() }
}
async function key(node: Element, value: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })
  await act(async () => { node.dispatchEvent(event) })
  return event
}
async function mountGrid(columns = 3, rows = 3) {
  request.mockImplementation(async () => json({ ...ready, world: gridWorld(columns, rows) })); await mount()
  return [...host.querySelectorAll('polygon')]
}
describe('read-only initial map', () => {
  it('renders public territory geometry, legend and inspector with pointer and keyboard selection', async () => {
    await mount(); expect(host.querySelectorAll('polygon')).toHaveLength(2)
    expect(host.querySelector('#world-unavailable-title')).toBeNull()
    expect(host.textContent).toContain('Military Supplies: 0'); expect(host.textContent).toContain('Commander')
    const polygons = host.querySelectorAll('polygon')
    await act(async () => polygons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(polygons[1]!.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-label="Territory inspector"]')?.textContent).toContain('FOREST')
    await act(async () => polygons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(polygons[0]!.getAttribute('tabindex')).toBe('0')
    await click('Refresh world'); expect(request).toHaveBeenCalledTimes(2)
    for (const [path, options] of request.mock.calls) {
      expect(path).toBe('/api/matches/match/world'); expect(options.credentials).toBe('same-origin'); expect(options.method).toBeUndefined()
    }
    await click('Back to lobbies'); expect(close).toHaveBeenCalledOnce()
  })
  it.each([['ArrowUp', 1], ['ArrowDown', 7], ['ArrowLeft', 3], ['ArrowRight', 5]] as const)('selects the %s neighbor and keeps exactly one territory in the Tab sequence', async (direction, next) => {
    const polygons = await mountGrid()
    await act(async () => polygons[4]!.focus())
    expect((await key(polygons[4]!, direction)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(polygons[next]); expect(polygons[next]!.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelectorAll('polygon[tabindex="0"]')).toHaveLength(1)
    expect(host.querySelectorAll('polygon[aria-pressed="true"]')).toHaveLength(1)
    expect(host.querySelector('.territory-inspector h3')?.textContent).toBe(`t${next}`)
  })
  it.each([['ArrowUp', 0], ['ArrowLeft', 0], ['ArrowDown', 8], ['ArrowRight', 8]] as const)('does not wrap at the %s boundary', async (direction, index) => {
    const polygons = await mountGrid(); await act(async () => polygons[index]!.focus())
    await key(polygons[index]!, direction)
    expect(document.activeElement).toBe(polygons[index]); expect(polygons[index]!.getAttribute('tabindex')).toBe('0')
    expect(host.querySelector('[role="status"]')?.textContent).toBe(`Selected t${index}.`)
  })
  it('preserves Enter/Space selection and lets Tab, Shift+Tab and other keys use native behavior', async () => {
    const polygons = await mountGrid(); await act(async () => polygons[4]!.focus())
    for (const value of ['Enter', ' ']) expect((await key(polygons[4]!, value)).defaultPrevented).toBe(true)
    for (const [value, shift] of [['Tab', false], ['Tab', true], ['Escape', false], ['a', false]] as const) {
      expect((await key(polygons[4]!, value, shift)).defaultPrevented).toBe(false)
    }
    expect(polygons[4]!.getAttribute('aria-pressed')).toBe('true')
    expect(request).toHaveBeenCalledOnce()
  })
  it('synchronizes pointer selection, focus, the Tab stop and nearest scrolling', async () => {
    const polygons = await mountGrid(); const scroll = vi.fn(); polygons[8]!.scrollIntoView = scroll
    await act(async () => polygons[8]!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(document.activeElement).toBe(polygons[8]); expect(polygons[8]!.getAttribute('tabindex')).toBe('0')
    expect(host.querySelectorAll('polygon[tabindex="0"]')).toHaveLength(1)
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  })
  it('announces only a concise selection summary and keeps the detailed inspector separately readable', async () => {
    const polygons = await mountGrid(); const map = host.querySelector('svg')!
    expect(document.getElementById(map.getAttribute('aria-describedby')!)?.textContent).toContain('Tab reaches your own formation marker when available')
    expect(polygons[4]!.getAttribute('aria-label')).toBe('Territory t4, row 2, column 2, forest, Neutral')
    expect(polygons[0]!.getAttribute('aria-label')).toContain('P1: Commander, capital')
    const status = host.querySelector('[role="status"]')!
    expect(status.getAttribute('aria-live')).toBe('polite'); expect(status.getAttribute('aria-atomic')).toBe('true')
    await act(async () => polygons[4]!.focus())
    expect(status.textContent).toBe('Selected t4.'); expect(status.textContent).not.toContain('Resources')
    const inspector = host.querySelector('[aria-label="Territory inspector"]')!
    expect(inspector.getAttribute('aria-live')).toBeNull(); expect(inspector.querySelector('dl')?.textContent).toContain('Neutral')
    expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
  })
  it('focuses the inspector and returns to the selected territory without changing the world hash', async () => {
    const polygons = await mountGrid(); const previousHash = window.location.hash
    window.location.hash = '#world=match'
    try {
      await act(async () => polygons[7]!.focus()); await click('Inspect selected territory')
      expect(document.activeElement).toBe(host.querySelector('.territory-inspector h2'))
      expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
      expect(host.querySelectorAll('polygon[tabindex="0"]')).toHaveLength(1)
      await click('Return to selected territory'); expect(document.activeElement).toBe(polygons[7])
      expect(window.location.hash).toBe('#world=match'); expect(request).toHaveBeenCalledOnce()
    } finally { window.location.hash = previousHash }
  })
  it('provides distinct terrain patterns, textual player identifiers and a readable dense-map scale', async () => {
    const polygons = await mountGrid(35, 30)
    expect(host.querySelectorAll('pattern')).toHaveLength(3)
    expect(new Set(polygons.slice(0, 3).map((p) => p.getAttribute('fill'))).size).toBe(3)
    for (const polygon of polygons.slice(0, 3)) {
      const id = polygon.getAttribute('fill')!.slice(5, -1)
      expect(document.getElementById(id)?.tagName.toLowerCase()).toBe('pattern')
    }
    expect(host.querySelector('.world-legend')?.textContent).toContain('P1: Commander')
    expect(host.querySelector('.world-legend')?.textContent).toContain('P2: Captain')
    expect(host.querySelectorAll('.world-owner-marker')).toHaveLength(2)
    expect(host.querySelector('.world-owner-marker')?.textContent).toBe('★P1')
    expect(host.querySelector('svg')?.style.minWidth).toBe('1680px')
    expect(host.querySelectorAll('polygon[tabindex="0"]')).toHaveLength(1)
  })
  it('keeps a not-started match distinct from a legacy match with no map', async () => {
    request.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'NOT_STARTED' })); await mount()
    expect(host.querySelector('svg')).toBeNull(); expect(request).toHaveBeenCalledOnce()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('This match has not started.')
    expect(host.querySelector('#world-unavailable-title')).toBeNull()
  })
  it('announces why a legacy RUNNING match cannot display a map and keeps refresh read-only', async () => {
    request.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'UNINITIALIZED' })); await mount()
    const status = host.querySelector('[role="status"]')!
    expect(status.getAttribute('aria-live')).toBe('polite'); expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(status.getAttribute('aria-labelledby')).toBe('world-unavailable-title')
    expect(host.querySelector('h2#world-unavailable-title')?.textContent).toBe('Map unavailable for this match')
    expect(status.textContent).toContain('started before world-map support was added')
    expect(status.textContent).toContain('no saved map to display')
    expect(status.textContent).toContain('Refreshing this view will not create a map')
    expect(host.querySelector('svg')).toBeNull(); expect(host.querySelector('[aria-label="Territory inspector"]')).toBeNull()
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(session).not.toHaveBeenCalled()
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Back to lobbies', 'Refresh world', 'Refresh turn'])
    expect(request).toHaveBeenCalledOnce(); await click('Refresh world'); expect(request).toHaveBeenCalledTimes(2)
    expect(host.querySelector('#world-unavailable-title')).not.toBeNull()
    for (const [path, options] of request.mock.calls) {
      expect(path).toBe('/api/matches/match/world'); expect(options.method).toBeUndefined(); expect(options.body).toBeUndefined()
    }
    await click('Back to lobbies'); expect(close).toHaveBeenCalledOnce()
  })
  it('removes stale READY geometry and inspector when refresh returns UNINITIALIZED', async () => {
    await mount(); expect(host.querySelector('svg')).not.toBeNull()
    request.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'UNINITIALIZED' }))
    await click('Refresh world')
    expect(host.querySelector('svg')).toBeNull(); expect(host.querySelector('[aria-label="Territory inspector"]')).toBeNull()
    expect(host.querySelector('#world-unavailable-title')).not.toBeNull()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('keeps network failure distinct and recovers a READY map after an explicit refresh', async () => {
    request.mockRejectedValue(new TypeError('private-network-detail')); await mount()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unable to load the world. Refresh to try again.')
    expect(host.textContent).not.toContain('private-network-detail'); expect(host.querySelector('#world-unavailable-title')).toBeNull()
    expect(request).toHaveBeenCalledOnce(); expect(session).not.toHaveBeenCalled()
    request.mockImplementation(async () => json(ready)); await click('Refresh world')
    expect(host.querySelectorAll('polygon')).toHaveLength(2); expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it.each([401, 403, 404, 500])('handles HTTP %i safely', async (status) => {
    request.mockImplementation(async () => json({ schemaVersion: 1, error: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'USERNAME_REQUIRED' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR' }, status)); await mount()
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector('svg')).toBeNull()
    expect(host.querySelector('#world-unavailable-title')).toBeNull()
    if (status === 404) expect(host.querySelector('[role="alert"]')?.textContent).toBe('World unavailable or you no longer have access to this match.')
    expect(session).toHaveBeenCalledTimes(status === 401 || status === 403 ? 1 : 0)
  })
  it.each([{ ...ready, seed: 42 }, { ...ready, world: { ...world, payload: {} } }, { ...ready, matchId: 'other' }])('rejects private or mismatched responses', async (value) => {
    request.mockImplementation(async () => json(value)); await mount(); expect(host.querySelector('svg')).toBeNull(); expect(host.querySelector('[role="alert"]')).not.toBeNull()
  })
  it('aborts a pending read on unmount and ignores late results', async () => {
    let finish!: (r: Response) => void; request.mockImplementation(() => new Promise<Response>((done) => { finish = done })); await mount()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading world…'); expect(host.querySelector('#world-unavailable-title')).toBeNull()
    const signal = request.mock.calls[0]![1].signal as AbortSignal
    await act(async () => root.render(<p>Elsewhere</p>)); expect(signal.aborted).toBe(true)
    await act(async () => finish(json(ready))); expect(host.textContent).toBe('Elsewhere')
  })
  it('keeps world and turn availability independent and refreshes each GET separately', async () => {
    await mount(); expect(host.querySelector('svg')).not.toBeNull(); expect(host.textContent).toContain('No saved turn')
    turnRequest.mockImplementation(async () => json(turnReady)); await click('Refresh turn')
    expect(host.textContent).toContain('Your revision9'); expect(request).toHaveBeenCalledOnce()
    request.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'UNINITIALIZED' }))
    await click('Refresh world')
    expect(host.querySelector('svg')).toBeNull(); expect(host.textContent).toContain('Your revision9')
    expect(turnRequest).toHaveBeenCalledTimes(2)
    for (const [path, options] of transport.mock.calls) {
      expect(path).toMatch(/^\/api\/matches\/match\/(world|turn|formations)$/)
      expect(options.method ?? 'GET').toBe('GET'); expect(options.body).toBeUndefined(); expect(options.credentials).toBe('same-origin')
    }
  })
  it('keeps a turn read failure independent from a working map', async () => {
    turnRequest.mockRejectedValue(new Error('private-network-detail')); await mount()
    expect(host.querySelector('svg')).not.toBeNull(); expect(host.textContent).toContain('Unable to connect to the turn service')
    expect(host.textContent).not.toContain('private-network-detail')
  })
  it('clears both map and private turn data when turn refresh detects session expiry', async () => {
    turnRequest.mockImplementation(async () => json(turnReady)); await mount()
    expect(host.textContent).toContain('Your revision9'); expect(host.querySelector('svg')).not.toBeNull()
    turnRequest.mockImplementation(async () => json({ schemaVersion: 1, error: 'UNAUTHENTICATED' }, 401))
    await click('Refresh turn')
    expect(session).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain('Your revision9')
    expect(host.querySelector('svg')).toBeNull(); expect(host.textContent).toContain('Your session is unavailable')
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Back to lobbies'])
  })
  it('aborts a pending turn read when world refresh detects an invalid session', async () => {
    let finish!: (response: Response) => void
    turnRequest.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve })); await mount()
    const signal = turnRequest.mock.calls[0]![1].signal as AbortSignal
    request.mockImplementation(async () => json({ schemaVersion: 1, error: 'USERNAME_REQUIRED' }, 403))
    await click('Refresh world'); expect(signal.aborted).toBe(true); expect(session).toHaveBeenCalledOnce()
    await act(async () => finish(json(turnReady)))
    expect(host.querySelector('svg')).toBeNull(); expect(host.textContent).not.toContain('Your revision9')
  })
})

const ownArmy = { schemaVersion: 1, matchId: 'match', state: 'READY', formations: [{ schemaVersion: 1,
  formationId: `formation:${'a'.repeat(64)}`, ownerPlayerId: 'a', position: { x: 50, y: 50 },
  units: Array.from({ length: 6 }, (_, i) => ({ schemaVersion: 1, unitId: `unit:${String(i).repeat(64)}`, originalSpawnNodeId: 'n0',
    ...(i === 0 ? { kind: 'LEADER', rank: 'LIEUTENANT', specialization: 'INFANTRY' } : { kind: 'INFANTRY' }) })) }] }
describe('own formation integration', () => {
  it('anchors one selectable diamond at the capital and supplies an accessible inspector', async () => {
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount()
    const marker = host.querySelector('.formation-marker')!
    expect(marker.getAttribute('transform')).toBe('translate(50 50)'); expect(marker.getAttribute('role')).toBe('button')
    expect(marker.getAttribute('tabindex')).toBe('0'); expect(host.querySelectorAll('svg [tabindex="0"]')).toHaveLength(2)
    const summary = host.querySelector<HTMLButtonElement>('.formation-list button')!; expect(summary.textContent).toContain('Lieutenant + 5 Infantry')
    summary.focus(); expect(document.activeElement).toBe(summary)
    await act(async () => summary.click()); expect(host.querySelector<HTMLElement>('.formation-details')!.hidden).toBe(false)
    expect(host.querySelectorAll('.formation-list li li')).toHaveLength(6)
    expect(host.textContent).toContain('Infantry specialization'); expect(host.textContent).toContain('Original spawn node')
    expect(host.querySelector('svg')!.textContent).not.toContain('unit:')
    await key(host.querySelector('polygon')!, 'ArrowRight')
    expect(host.querySelectorAll('svg [tabindex="0"]')).toHaveLength(2)
    for (const [path, options] of formationRequest.mock.calls) {
      expect(path).toBe('/api/matches/match/formations'); expect(options).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin' }); expect(options.body).toBeUndefined()
    }
  })
  it('clears markers while refreshing formations without refreshing the world or polling', async () => {
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount()
    let finish!: (response: Response) => void
    formationRequest.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve }))
    await click('Refresh formations'); expect(host.querySelector('.formation-marker')).toBeNull()
    expect(host.textContent).toContain('Loading formations'); expect(request).toHaveBeenCalledOnce()
    await act(async () => finish(json({ schemaVersion: 1, matchId: 'match', state: 'UNSUPPORTED' })))
    expect(host.textContent).toContain('older match'); expect(host.querySelector('.formation-list')).toBeNull()
    expect(formationRequest).toHaveBeenCalledTimes(2)
  })
  it.each([['wrong-match', 200], ['wrong-position', 200], ['private-field', 200], ['denied', 404], ['failure', 500]] as const)('rejects %s without retaining markers or raw errors', async (kind, status) => {
    let value: unknown = { private: 'server-secret' }
    if (kind === 'wrong-match') value = { ...ownArmy, matchId: 'other' }
    if (kind === 'wrong-position') value = { ...ownArmy, formations: [{ ...ownArmy.formations[0], position: { x: 51, y: 50 } }] }
    if (kind === 'private-field') value = { ...ownArmy, seed: 'server-secret' }
    formationRequest.mockImplementation(async () => json(value, status)); await mount()
    expect(host.querySelector('.formation-marker')).toBeNull(); expect(host.querySelector('.formation-list')).toBeNull()
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain('server-secret')
    expect(session).not.toHaveBeenCalled()
  })
  it('cancels and ignores late formation data when the world becomes unavailable', async () => {
    let finish!: (response: Response) => void
    formationRequest.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve })); await mount()
    const signal = formationRequest.mock.calls[0]![1].signal as AbortSignal
    request.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'UNINITIALIZED' })); await click('Refresh world')
    expect(signal.aborted).toBe(true); await act(async () => finish(json(ownArmy)))
    expect(host.querySelector('.formation-marker')).toBeNull(); expect(host.querySelector('.formation-list')).toBeNull(); expect(host.textContent).not.toContain('Your formations')
  })
  it.each([[401, 'UNAUTHENTICATED'], [403, 'USERNAME_REQUIRED']] as const)('clears the complete private workspace on formation HTTP %i', async (status, error) => {
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount()
    formationRequest.mockImplementation(async () => json({ schemaVersion: 1, error }, status)); await click('Refresh formations')
    expect(host.querySelector('svg')).toBeNull(); expect(host.querySelector('.formation-list')).toBeNull()
    expect(session).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Your session is unavailable')
  })
})

describe('versioned authoritative movement formation overlay',()=>{
 const f={schemaVersion:1,formationId:`formation:${'a'.repeat(64)}`,ownerPlayerId:'a',position:{x:79.999,y:50},units:Array.from({length:6},(_,i)=>({schemaVersion:1,unitId:`unit:${String(i).repeat(64)}`,originalSpawnNodeId:'n0',...(i?{kind:'INFANTRY'}:{kind:'LEADER',rank:'LIEUTENANT',specialization:'INFANTRY'})}))};
 it('draws the radius-10 world-space circle at stored fractional coordinates and retains native navigation',async()=>{
  formationRequest.mockImplementation(async()=>json({schemaVersion:2,matchId:'match',state:'READY',collisionRadius:10,pendingEncounter:true,formations:[f]}));
  await mount();const marker=host.querySelector('.formation-marker')!,circle=marker.querySelector('circle')!;
  expect(marker.getAttribute('transform')).toBe('translate(79.999 50)');expect(circle.getAttribute('r')).toBe('10');
  expect(marker.textContent).toContain('Pending battle');expect(host.querySelectorAll('polygon[tabindex="0"]')).toHaveLength(1);
  const svg=host.querySelector('svg')!;svg.style.width='400px';expect(circle.getAttribute('r')).toBe('10');svg.style.width='800px';expect(circle.getAttribute('r')).toBe('10');
 });
 it('does not infer a pending encounter from geometric overlap or paths',async()=>{
  formationRequest.mockImplementation(async()=>json({schemaVersion:2,matchId:'match',state:'READY',collisionRadius:10,pendingEncounter:false,formations:[{...f,position:{x:50,y:50}}]}));
  await mount();expect(host.querySelector('.formation-marker')!.textContent).not.toContain('Pending battle');
 });
});


describe('own formation selection and private lifecycle (Issue 74)', () => {
  const marker = () => host.querySelector<SVGGElement>('.formation-marker')!
  const details = () => host.querySelector<HTMLElement>('.formation-details')!
  async function inspect() { await act(async () => marker().dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
  const current = (pendingEncounter = false) => ({ ...ownArmy, schemaVersion: 2, collisionRadius: 10, pendingEncounter,
    formations: [{ ...ownArmy.formations[0], position: { x: 79.999, y: 50 } }] })

  it.each(['mouse', 'Enter', ' '])('opens and focuses the single real roster by %s and returns with Escape', async (input) => {
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount()
    expect(details().hidden).toBe(true)
    const calls = transport.mock.calls.length
    if (input === 'mouse') await inspect()
    else expect((await key(marker(), input)).defaultPrevented).toBe(true)
    expect(marker().getAttribute('aria-label')).toContain('Your formation: Lieutenant, Infantry specialization, 5 Infantry')
    expect(marker().getAttribute('aria-expanded')).toBe('true')
    expect(marker().getAttribute('aria-controls')).toBe(details().id)
    expect(details().hidden).toBe(false); expect(document.activeElement).toBe(details().querySelector('h3'))
    expect(details().textContent).toContain('50, 50 (authoritative starting capital position)')
    expect(details().textContent).not.toContain('Pending battle:')
    expect(details().querySelectorAll('li')).toHaveLength(6)
    expect(host.querySelectorAll('.formation-list')).toHaveLength(1)
    expect(transport.mock.calls).toHaveLength(calls)
    expect((await key(document.activeElement!, 'Escape')).defaultPrevented).toBe(true)
    expect(details().hidden).toBe(true); expect(document.activeElement).toBe(marker())
    await key(marker(), 'Enter'); await click('Return to map marker')
    expect(details().hidden).toBe(true); expect(document.activeElement).toBe(marker())
    await key(host.querySelector('polygon')!, 'ArrowRight')
    expect(host.querySelector('.territory-inspector h3')?.textContent).toBe('t1')
    expect(host.querySelectorAll('polygon[tabindex="0"]')).toHaveLength(1)
  })

  it.each([false, true])('shows stored moved coordinates and only the current pending flag (%s)', async (pending) => {
    formationRequest.mockImplementation(async () => json(current(pending))); await mount(); await inspect()
    expect(details().textContent).toContain('79.999, 50 (stored authoritative position)')
    expect(details().textContent).not.toContain('(capital)')
    expect(details().textContent).toContain(`Pending battle: ${pending ? 'Yes' : 'No'}.`)
    expect(details().textContent).not.toContain('opponent')
  })

  it('preserves selection across successful formation/world refresh and reconnect without stealing focus', async () => {
    formationRequest.mockImplementation(async () => json(current())); await mount(); await inspect()
    await click('Refresh formations'); expect(marker().getAttribute('aria-expanded')).toBe('true')
    await click('Refresh world'); expect(marker().getAttribute('aria-expanded')).toBe('true')
    let finish!: (response: Response) => void
    formationRequest.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve }))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(marker()).toBeNull(); expect(details()).toBeNull()
    const refreshButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Back to lobbies')!
    refreshButton.focus()
    await act(async () => finish(json(current(true))))
    expect(marker().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(refreshButton); expect(details().textContent).toContain('Pending battle: Yes.')
  })

  it.each(['reconnect', 'manual'])('keeps predictable focus while selected details disappear during %s refresh', async (trigger) => {
    formationRequest.mockImplementation(async () => json(current())); await mount(); await inspect()
    const panel = host.querySelector<HTMLElement>('.formation-panel')!
    expect(document.activeElement).toBe(details().querySelector('h3'))
    let finish!: (response: Response) => void
    formationRequest.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
    if (trigger === 'manual') {
      const button = [...panel.querySelectorAll('button')].find((node) => node.textContent === 'Refresh formations')!
      button.focus()
      await click('Refresh formations')
    } else await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(details()).toBeNull(); expect(marker()).toBeNull()
    expect(document.activeElement).toBe(panel)
    expect(panel.getAttribute('tabindex')).toBe('-1')
    expect(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent).toBe('Your formations')
    await act(async () => finish(json(current(true))))
    expect(marker().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(panel)
    expect(details().textContent).toContain('Pending battle: Yes.')
    await key(panel, 'Escape')
    expect(details().hidden).toBe(true); expect(document.activeElement).toBe(marker())
    await key(marker(), 'Enter'); await click('Return to map marker')
    expect(document.activeElement).toBe(marker())
  })

  it.each(['reconnect', 'manual'])('does not steal focus moved outside the panel during a %s refresh', async (trigger) => {
    formationRequest.mockImplementation(async () => json(current())); await mount(); await inspect()
    let finish!: (response: Response) => void
    formationRequest.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
    if (trigger === 'manual') await click('Refresh formations')
    else await act(async () => { window.dispatchEvent(new Event('online')) })
    const outside = [...host.querySelectorAll('button')].find((node) => node.textContent === 'Back to lobbies')!
    outside.focus()
    await act(async () => finish(json(current())))
    expect(document.activeElement).toBe(outside)
    expect(marker().getAttribute('aria-expanded')).toBe('true')
  })

  it('leaves existing external focus alone when reconnect begins and completes', async () => {
    formationRequest.mockImplementation(async () => json(current())); await mount(); await inspect()
    const outside = [...host.querySelectorAll('button')].find((node) => node.textContent === 'Back to lobbies')!
    outside.focus()
    let finish!: (response: Response) => void
    formationRequest.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(document.activeElement).toBe(outside)
    await act(async () => finish(json(current())))
    expect(document.activeElement).toBe(outside)
  })

  it('retains the refresh focus fallback on failed reads and ignores a superseded read', async () => {
    formationRequest.mockImplementation(async () => json(current())); await mount(); await inspect()
    const panel = host.querySelector<HTMLElement>('.formation-panel')!
    let stale!: (response: Response) => void, finish!: (response: Response) => void
    formationRequest.mockImplementationOnce(() => new Promise<Response>((resolve) => { stale = resolve }))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    const signal = formationRequest.mock.lastCall![1].signal as AbortSignal
    formationRequest.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(signal.aborted).toBe(true); expect(document.activeElement).toBe(panel)
    await act(async () => finish(json({}, 500)))
    expect(details()).toBeNull(); expect(marker()).toBeNull(); expect(document.activeElement).toBe(panel)
    await act(async () => stale(json(current())))
    expect(details()).toBeNull(); expect(document.activeElement).toBe(panel)
    await click('Refresh formations')
    expect(marker().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(panel)
  })

  it.each(['UNSUPPORTED', 'UNINITIALIZED', 'NOT_STARTED', 'failure', 'malformed'])('clears selection after %s and never restores it on later success', async (state) => {
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount(); await inspect()
    formationRequest.mockImplementation(async () => state === 'failure' ? json({}, 500) : state === 'malformed' ? json({ ...ownArmy, schemaVersion: 99 }) : json({ schemaVersion: 1, matchId: 'match', state }))
    await click('Refresh formations'); expect(marker()).toBeNull(); expect(details()).toBeNull()
    formationRequest.mockImplementation(async () => json(ownArmy)); await click('Refresh formations')
    expect(marker().getAttribute('aria-expanded')).toBe('false'); expect(details().hidden).toBe(true)
  })

  it('clears selection on world read failure', async () => {
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount(); await inspect()
    request.mockImplementation(async () => json({}, 500)); await click('Refresh world')
    expect(details()).toBeNull(); expect(marker()).toBeNull()
    request.mockImplementation(async () => json(ready)); await click('Refresh world')
    expect(marker().getAttribute('aria-expanded')).toBe('false')
  })

  it('aborts obsolete reconnect reads and ignores late successes or auth failures', async () => {
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount(); await inspect()
    let finish!: (response: Response) => void
    formationRequest.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    const signal = formationRequest.mock.lastCall![1].signal as AbortSignal
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(signal.aborted).toBe(true); expect(marker().getAttribute('aria-expanded')).toBe('true')
    await act(async () => finish(json({}, 401)))
    expect(session).not.toHaveBeenCalled(); expect(marker().getAttribute('aria-expanded')).toBe('true')
  })

  it('clears selection on match change and aborts pending reads on unmount', async () => {
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount(); await inspect()
    let finish!: (response: Response) => void
    formationRequest.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    const signal = formationRequest.mock.lastCall![1].signal as AbortSignal
    request.mockImplementation(async () => json({ ...ready, matchId: 'other' }))
    formationRequest.mockImplementation(async () => json({ ...ownArmy, matchId: 'other' }))
    await act(async () => root.render(<WorldView matchId="other" onClose={close} onSessionError={session} />))
    expect(signal.aborted).toBe(true); expect(marker().getAttribute('aria-expanded')).toBe('false')
    await act(async () => finish(json(ownArmy)))
    expect(marker().getAttribute('aria-expanded')).toBe('false')
  })

  it.each([[401, 'UNAUTHENTICATED'], [403, 'USERNAME_REQUIRED']] as const)('revokes selection on HTTP %i even if account recovery rejects', async (status, error) => {
    session.mockRejectedValueOnce(new Error('offline'))
    formationRequest.mockImplementation(async () => json(ownArmy)); await mount(); await inspect()
    formationRequest.mockImplementation(async () => json({ schemaVersion: 1, error }, status))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(marker()).toBeNull(); expect(details()).toBeNull(); expect(host.textContent).toContain('Your session is unavailable')
  })

  it('keeps a marker click out of destination picking and preserves dotted previews/territory clicks', async () => {
    formationRequest.mockImplementation(async () => json(ownArmy))
    const order = { type: 'move', orderId: 'order', stackId: ownArmy.formations[0]!.formationId, destination: { x: 75, y: 50 } }
    movementRequest.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state: 'READY',
      turn: turnReady.turn, own: { ...turnReady.own, orders: [order] }, route: { formationId: order.stackId, range: 250, distance: 25, remaining: 225,
        segments: [{ orderId: 'order', moveNumber: 1, from: { x: 50, y: 50 }, destination: order.destination, distance: 25, cumulative: 25 }] } }))
    await mount()
    const select = host.querySelector('select')!
    await act(async () => { select.value = order.stackId; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await click('Choose destination on map')
    const calls = transport.mock.calls.length
    await inspect(); await key(details().querySelector('h3')!, 'Escape')
    expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('')
    expect(host.textContent).toContain('Click the map to fill coordinates')
    expect(host.querySelector('.planned-route line')!.getAttribute('stroke-dasharray')).toBe('2 6')
    expect(transport.mock.calls).toHaveLength(calls)
    await click('Use selected territory center as destination')
    expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('50')
    expect(transport.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true)
  })
})

it('labels ownership as archived initial data and retains original colors and territory owners',async()=>{
 await mount();const map=host.querySelector('svg')!,before=[...map.querySelectorAll('.world-territory')].map(p=>({label:p.getAttribute('aria-label'),stroke:p.getAttribute('stroke')}));
 expect(host.textContent).toContain('Ownership colors and territory owners are archived initial data, not current ownership');
 expect(host.textContent).toContain('Authorized capture changes appear only in your battle aftermath');
 expect(before[0]!.label).toContain('Commander');expect(before[1]!.label).toContain('Captain');
 await click('Refresh world');expect([...host.querySelectorAll('.world-territory')].map(p=>({label:p.getAttribute('aria-label'),stroke:p.getAttribute('stroke')}))).toEqual(before);
 expect(world.territories.map(t=>t.ownerPlayerId)).toEqual(['a','b']);
})
