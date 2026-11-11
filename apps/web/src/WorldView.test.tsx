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
describe('read-only initial map', () => {
  it('renders public territory geometry, legend and inspector with pointer and keyboard selection', async () => {
    await mount(); expect(host.querySelectorAll('polygon')).toHaveLength(2)
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
  it.each(['NOT_STARTED', 'UNINITIALIZED'])('shows %s without attempting initialization', async (state) => {
    request.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state })); await mount()
    expect(host.querySelector('svg')).toBeNull(); expect(request).toHaveBeenCalledOnce()
    expect(host.textContent).toContain(state === 'NOT_STARTED' ? 'has not started' : 'no initialized world')
  })
  it.each([401, 403, 404, 500])('handles HTTP %i safely', async (status) => {
    request.mockImplementation(async () => json({ schemaVersion: 1, error: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'USERNAME_REQUIRED' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR' }, status)); await mount()
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector('svg')).toBeNull()
    expect(session).toHaveBeenCalledTimes(status === 401 || status === 403 ? 1 : 0)
  })
  it.each([{ ...ready, seed: 42 }, { ...ready, world: { ...world, payload: {} } }, { ...ready, matchId: 'other' }])('rejects private or mismatched responses', async (value) => {
    request.mockImplementation(async () => json(value)); await mount(); expect(host.querySelector('svg')).toBeNull(); expect(host.querySelector('[role="alert"]')).not.toBeNull()
  })
  it('aborts a pending read on unmount and ignores late results', async () => {
    let finish!: (r: Response) => void; request.mockImplementation(() => new Promise<Response>((done) => { finish = done })); await mount()
    const signal = request.mock.calls[0]![1].signal as AbortSignal
    await act(async () => root.render(<p>Elsewhere</p>)); expect(signal.aborted).toBe(true)
    await act(async () => finish(json(ready))); expect(host.textContent).toBe('Elsewhere')
  })
})
