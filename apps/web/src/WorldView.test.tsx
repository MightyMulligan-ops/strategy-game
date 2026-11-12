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
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  request.mockReset().mockImplementation(async () => json(ready)); close.mockReset(); session.mockClear(); vi.stubGlobal('fetch', request)
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
    expect(document.getElementById(map.getAttribute('aria-describedby')!)?.textContent).toContain('Tab or Shift+Tab leaves the map')
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
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Back to lobbies', 'Refresh world'])
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
})
