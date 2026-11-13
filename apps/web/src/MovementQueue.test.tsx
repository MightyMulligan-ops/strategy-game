// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MovementDraftRequestSchema, PublicWorldSchema, OwnFormationSchema } from '@strategy-game/shared-types'
import type { MovementDraftOrder, MovementRoute } from '@strategy-game/shared-types'
import MovementQueue from './MovementQueue'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const formation = OwnFormationSchema.parse({ schemaVersion: 1, formationId: `formation:${'a'.repeat(64)}`, ownerPlayerId: 'own', position: { x: 250, y: 250 },
  units: Array.from({ length: 6 }, (_, i) => ({ schemaVersion: 1, unitId: `unit:${String(i).repeat(64)}`, originalSpawnNodeId: 'supply-own',
    ...(i ? { kind: 'INFANTRY' } : { kind: 'LEADER', rank: 'LIEUTENANT', specialization: 'INFANTRY' }) })) })
const world = PublicWorldSchema.parse({ visibility: 'INITIAL_SHARED', bounds: { width: 1000, height: 500 }, grid: { columns: 2, rows: 1 },
  players: [{ playerId: 'own', username: 'Commander' }, { playerId: 'other', username: 'OtherUser' }], links: [{ a: 'capital', b: 'other-capital' }],
  territories: [0, 1].map((i) => ({ territoryId: i ? 'other-capital' : 'capital', row: 0, column: i,
    polygon: [{ x: i*500, y: 0 }, { x: i*500+500, y: 0 }, { x: i*500+500, y: 500 }, { x: i*500, y: 500 }],
    center: { x: i*500+250, y: 250 }, terrain: 'PLAINS', ownerPlayerId: i ? 'other' : 'own', capital: true,
    city: { cityId: i ? 'city-other' : 'city-own', kind: 'CAPITAL' }, resources: [] })) })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
let orders: readonly MovementDraftOrder[], revision: number, host: HTMLDivElement, root: ReturnType<typeof createRoot>
const request = vi.fn(), session = vi.fn(async () => {})
let currentMatch = 'match'
function response() {
  let from = formation.position, distance = 0
  const segments = orders.map((o, i) => { const length = Math.sqrt((from.x - o.destination.x) ** 2 + (from.y - o.destination.y) ** 2); distance += length
    const s = { orderId: o.orderId, moveNumber: i + 1, from, destination: o.destination, distance: length, cumulative: distance }; from = o.destination; return s })
  return { schemaVersion: 1, matchId: currentMatch, state: 'READY',
    turn: { schemaVersion: 1, gameId: currentMatch, turnNumber: 1, status: 'open', openedAtMs: 1000, deadlineAtMs: 2000 },
    own: { schemaVersion: 1, gameId: currentMatch, turnNumber: 1, revision, ready: false, orders },
    route: { formationId: formation.formationId, range: 250, distance, remaining: 250 - distance, segments } }
}
const map = (route: MovementRoute | null, choose: ((p: { x: number; y: number }) => void) | null) => <div>
  <output data-testid="route">{route?.segments.map((s) => `Move ${s.moveNumber}:${s.destination.x},${s.destination.y}`).join(';') ?? ''}</output>
  {choose && <button onClick={() => choose({ x: 350, y: 250 })}>Mock map destination</button>}
</div>
beforeEach(() => {
  orders = []; revision = 0; currentMatch = 'match'; request.mockReset(); session.mockReset().mockResolvedValue(undefined)
  request.mockImplementation(async (path: string, options: RequestInit) => {
    if (path === '/auth/csrf') return json({ csrfToken: 'synthetic-current-token' })
    if (options.method === 'POST') {
      const input = MovementDraftRequestSchema.parse(JSON.parse(options.body as string))
      if (input.expectedRevision !== revision) return json({ schemaVersion: 1, error: 'STALE_REVISION' }, 409)
      const next = input.kind === 'replace_orders' ? input.orders : orders.filter((o) => o.orderId !== input.orderId)
      const previous = orders; orders = next
      if (response().route.distance > 250) { orders = previous; return json({ schemaVersion: 1, error: 'INVALID_DRAFT' }, 422) }
      revision++; return json(response())
    }
    return json(response())
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('fetch', request)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount(matchId = 'match', own = formation as typeof formation | null) {
  await act(async () => root.render(<StrictMode><MovementQueue key={matchId} matchId={matchId} formation={own} world={world} onSessionError={session} map={map} /></StrictMode>))
}
async function click(name: string) { await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!.click()) }
async function select() { await act(async () => { const select = host.querySelector('select')!; select.value = formation.formationId; select.dispatchEvent(new Event('change', { bubbles: true })) }) }
async function coordinate(label: string, value: string) {
  const name = [...host.querySelectorAll('label')].find((l) => l.textContent === label)!.htmlFor
  await act(async () => { const input = document.getElementById(name) as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function add(x: string, y = '250') { await coordinate('Destination X', x); await coordinate('Destination Y', y); await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
const planned = () => host.querySelector('[data-testid="route"]')!.textContent

describe('authoritative Movement Queue', () => {
  it('selects only owned formation, edits/reorders/cancels stable IDs and renders server budgets', async () => {
    await mount(); expect(host.textContent).toContain('No saved movement orders'); expect(host.querySelectorAll('option')).toHaveLength(2)
    const selector = host.querySelector('select')!
    expect([...host.querySelectorAll('label')].find((l) => l.htmlFor === selector.id)?.textContent).toBe('Owned formation')
    await select(); await add('300'); const firstId = orders[0]!.orderId
    await add('350'); const secondId = orders[1]!.orderId
    expect(planned()).toBe('Move 1:300,250;Move 2:350,250'); expect(host.textContent).toContain('Remaining 150.00')
    await click('Edit Move 1'); await add('310'); expect(orders[0]!.orderId).toBe(firstId)
    await click('Move 2 earlier'); expect(orders.map((o) => o.orderId)).toEqual([secondId, firstId]); expect(host.textContent).toContain('Cumulative 140.00')
    await click('Cancel Move 1'); expect(orders.map((o) => o.orderId)).toEqual([firstId]); expect(planned()).toBe('Move 1:310,250')
    expect(formation.position).toEqual({ x: 250, y: 250 }); expect(host.textContent).toContain('Your formation stays at its capital')
    const posts = request.mock.calls.filter(([, o]) => o.method === 'POST')
    expect(posts).toHaveLength(5)
    posts.forEach(([, options], index) => {
      expect(options.credentials).toBe('same-origin'); expect(options.cache).toBe('no-store'); expect(options.headers['x-csrf-token']).toBe('synthetic-current-token')
      const body = JSON.parse(options.body); expect(body.expectedRevision).toBe(index); expect(body).not.toHaveProperty('playerId'); expect(body).not.toHaveProperty('ready')
    })
  })
  it('explicit map selection fills integer inputs before a separate save', async () => {
    await mount(); await select(); await click('Choose destination on map'); await click('Mock map destination')
    expect(request.mock.calls.filter(([, o]) => o.method === 'POST')).toHaveLength(0)
    expect([...host.querySelectorAll('input')].map((i) => i.value)).toEqual(['350', '250'])
    expect(document.activeElement).toBe(host.querySelector('input'))
    await click('Add movement'); expect(planned()).toBe('Move 1:350,250')
  })
  it('accepts 250 and rejects a complete over-budget draft without changing saved paths', async () => {
    await mount(); await select(); await add('500'); expect(host.textContent).toContain('Remaining 0.00')
    await add('501'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('cumulative 250-unit budget')
    expect(planned()).toBe('Move 1:500,250'); expect(revision).toBe(1)
    await add('250.5'); expect(host.textContent).toContain('integer coordinates'); expect(revision).toBe(1)
  })
  it('reconciles stale revisions with one GET and never automatically resubmits', async () => {
    await mount(); await select(); revision = 7; await add('300')
    expect(host.textContent).toContain('Your draft changed'); expect(host.textContent).toContain('Revision 7')
    expect(request.mock.calls.filter(([, o]) => o.method === 'POST')).toHaveLength(1)
    expect(request.mock.calls.filter(([p, o]) => p.endsWith('/orders') && o.method === 'GET')).toHaveLength(2)
  })
  it('reconciles an uncertain successful commit by GET without duplicating the order', async () => {
    await mount(); const normal = request.getMockImplementation()!
    request.mockImplementation(async (p, o) => { const result = await normal(p, o); if (o.method === 'POST') throw new Error('private-network-detail'); return result })
    await select(); await add('300'); expect(host.textContent).toContain('save outcome was uncertain'); expect(host.textContent).toContain('Revision 1')
    expect(planned()).toBe('Move 1:300,250'); expect(orders).toHaveLength(1); expect(request.mock.calls.filter(([, o]) => o.method === 'POST')).toHaveLength(1)
    expect(host.textContent).not.toContain('private-network-detail')
  })
  it('reconciles a well-shaped acknowledgement with a mismatched route origin', async () => {
    await mount(); const normal = request.getMockImplementation()!
    request.mockImplementation(async (p, o) => {
      const result = await normal(p, o)
      if (o.method !== 'POST') return result
      const altered = await result.json(); altered.route.segments[0].from.x--
      altered.route.segments[0].distance++; altered.route.segments[0].cumulative++
      altered.route.distance++; altered.route.remaining--
      return json(altered)
    })
    await select(); await add('300')
    expect(host.textContent).toContain('save outcome was uncertain'); expect(host.textContent).toContain('Distance 50.00')
    expect(request.mock.calls.filter(([, o]) => o.method === 'POST')).toHaveLength(1)
    expect(request.mock.calls.filter(([p, o]) => p.endsWith('/orders') && o.method === 'GET')).toHaveLength(2)
  })
  it.each([401, 403, 404])('clears private state on access loss HTTP %i', async (status) => {
    await mount(); await select(); await add('300')
    request.mockImplementation(async () => json({ schemaVersion: 1, error: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'USERNAME_REQUIRED' : 'NOT_FOUND' }, status))
    await click('Refresh movement queue'); expect(planned()).toBe(''); expect(host.querySelector('form')).toBeNull(); expect(session).toHaveBeenCalledOnce()
  })
  it('shows older-cohort unavailability and ignores late reads after navigation/unmount', async () => {
    let finish!: (response: Response) => void
    request.mockImplementation(() => new Promise<Response>((done) => { finish = done })); await mount()
    const signal = request.mock.calls[0]![1].signal as AbortSignal
    currentMatch = 'other'; request.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'other', state: 'UNSUPPORTED' })); await mount('other')
    expect(signal.aborted).toBe(true); await act(async () => finish(json({ ...response(), matchId: 'match' })))
    expect(planned()).toBe(''); expect(host.textContent).toContain('unavailable for this match'); expect(host.querySelector('form')).toBeNull()
  })
  it('clears route on formation/world cleanup and aborts pending writes without assuming rollback', async () => {
    await mount(); await select(); await add('300')
    await mount('match', null); expect(planned()).toBe(''); expect(host.querySelector('.movement-queue')).toBeNull()
    expect(host.textContent).not.toContain('Move 1')
  })
  it('releases a canceled action on formation refresh and ignores its late acknowledgement', async () => {
    await mount(); await select()
    let finish!: (response: Response) => void
    const normal = request.getMockImplementation()!
    request.mockImplementation((p, o) => o.method === 'POST' ? new Promise<Response>((done) => { finish = done }) : normal(p, o))
    await add('300')
    const signal = request.mock.calls.find(([, o]) => o.method === 'POST')![1].signal as AbortSignal
    await mount('match', null); expect(signal.aborted).toBe(true)
    await mount(); expect(host.querySelector('.movement-queue')!.getAttribute('aria-busy')).toBe('false')
    const old = response(); await act(async () => finish(json({ ...old, own: { ...old.own, revision: 1 } })))
    expect(host.textContent).toContain('Revision 0'); expect(planned()).toBe('')
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Refresh movement queue')!.disabled).toBe(false)
  })
  it('rejects malformed private fields and deadline errors without raw server details', async () => {
    request.mockImplementation(async () => json({ ...response(), seed: 'private-seed' })); await mount()
    expect(host.querySelector('form')).toBeNull(); expect(host.textContent).not.toContain('private-seed')
    request.mockImplementation(async (p) => p === '/auth/csrf' ? json({ csrfToken: 'synthetic' }) : json(response())); await click('Refresh movement queue'); await select()
    const normal = request.getMockImplementation()!
    request.mockImplementation(async (p, o) => o.method === 'POST' ? json({ schemaVersion: 1, error: 'DEADLINE_PASSED' }, 409) : normal(p, o))
    await add('300'); expect(host.textContent).toContain('deadline has passed'); expect(planned()).toBe('')
  })
});
