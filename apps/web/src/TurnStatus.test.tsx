// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TurnStatus from './TurnStatus'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const ready = { schemaVersion: 1, matchId: 'match', state: 'READY',
  turn: { schemaVersion: 1, gameId: 'match', turnNumber: 1, status: 'open', openedAtMs: 1000, deadlineAtMs: 2000 },
  own: { schemaVersion: 1, gameId: 'match', turnNumber: 1, revision: 0, ready: false, orders: [] } }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>
const request = vi.fn(); const session = vi.fn(async () => {})
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  request.mockReset().mockImplementation(async () => json(ready)); session.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', request)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount(matchId = 'match') {
  await act(async () => root.render(<StrictMode><TurnStatus matchId={matchId} onSessionError={session} /></StrictMode>))
}
async function refresh() { await act(async () => host.querySelector('button')!.click()) }
const deferred = () => {
  let finish!: (response: Response) => void
  const promise = new Promise<Response>((resolve) => { finish = resolve })
  return { promise, finish }
}

describe('read-only turn panel', () => {
  it('separates availability from own readiness and shows stored absolute timestamps without advancing overdue turns', async () => {
    await mount()
    expect(host.textContent).toContain('Turn data available. Your readiness is shown separately')
    expect(host.textContent).toContain('Your turn readinessNot ready'); expect(host.textContent).toContain('Your revision0')
    expect(host.textContent).toContain('Turn number1'); expect(host.textContent).toContain('Stored statusopen')
    expect([...host.querySelectorAll('time')].map((t) => t.dateTime)).toEqual(['1970-01-01T00:00:01.000Z', '1970-01-01T00:00:02.000Z'])
    expect(host.textContent).not.toMatch(/closed|countdown/i)
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Refresh turn'])
    expect(request).toHaveBeenCalledOnce(); await refresh(); expect(request).toHaveBeenCalledTimes(2)
    for (const [path, options] of request.mock.calls) {
      expect(path).toBe('/api/matches/match/turn'); expect(options.method).toBe('GET'); expect(options.body).toBeUndefined()
    }
  })
  it('displays the caller readiness and revision, never their orders or private fields', async () => {
    request.mockResolvedValue(json({ ...ready, own: { ...ready.own, revision: 7, ready: true,
      orders: [{ type: 'move', orderId: 'own-order-secret', stackId: 'own-stack-secret', destination: { x: 0, y: 0 } }] } }))
    await mount(); expect(host.textContent).toContain('Your turn readinessReady'); expect(host.textContent).toContain('Your revision7')
    expect(host.textContent).not.toContain('secret')
  })
  it.each(['NOT_STARTED', 'UNINITIALIZED'])('clears prior private data when refresh returns %s', async (state) => {
    await mount(); request.mockImplementation(async () => json({ schemaVersion: 1, matchId: 'match', state }))
    await refresh(); expect(host.querySelector('dl')).toBeNull(); expect(host.querySelector('time')).toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toContain(state === 'NOT_STARTED' ? 'has not started a turn' : 'No saved turn')
    expect(session).not.toHaveBeenCalled()
  })
  it.each([[401, 'UNAUTHENTICATED'], [403, 'USERNAME_REQUIRED']] as const)('clears data and invokes account recovery on HTTP %i', async (status, error) => {
    await mount(); request.mockImplementation(async () => json({ schemaVersion: 1, error }, status))
    session.mockImplementation(async () => { throw new Error('private-account-failure') })
    await refresh(); expect(host.querySelector('dl')).toBeNull(); expect(session).toHaveBeenCalledOnce()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(status === 401 ? 'session has ended' : 'registered username')
    expect(host.textContent).not.toContain('private-account-failure')
  })
  it.each([[403, 'permission'], [404, 'no longer have access'], [429, 'Too many requests'], [500, 'temporarily unavailable']] as const)('handles HTTP %i privately', async (status, message) => {
    request.mockImplementation(async () => json({ secret: 'private-storage-detail' }, status)); await mount()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(message)
    expect(host.querySelector('dl')).toBeNull(); expect(host.textContent).not.toContain('private-storage-detail'); expect(session).not.toHaveBeenCalled()
  })
  it('distinguishes malformed responses and network failure and recovers only on manual refresh', async () => {
    request.mockResolvedValue(json({ ...ready, seed: 42 })); await mount()
    expect(host.textContent).toContain('could not be verified')
    request.mockRejectedValue(new Error('private-network-failure')); await refresh()
    expect(host.textContent).toContain('Unable to connect'); expect(host.textContent).not.toContain('private-network-failure')
    request.mockImplementation(async () => json(ready)); await refresh()
    expect(host.querySelector('dl')).not.toBeNull(); expect(request).toHaveBeenCalledTimes(3)
  })
  it('clears data while loading, aborts superseded reads and ignores a late successful response', async () => {
    await mount(); const older = deferred(); const newer = deferred()
    request.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)
    // Two clicks in one batch exercise supersession before the disabled state is painted.
    await act(async () => { host.querySelector('button')!.click(); host.querySelector('button')!.click() })
    expect(host.querySelector('dl')).toBeNull(); expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(request.mock.calls[1]![1].signal.aborted).toBe(true)
    await act(async () => newer.finish(json({ schemaVersion: 1, matchId: 'match', state: 'UNINITIALIZED' })))
    await act(async () => older.finish(json(ready)))
    expect(host.textContent).toContain('No saved turn'); expect(host.querySelector('dl')).toBeNull()
  })
  it('remounts private state on match navigation and aborts/ignores the previous match response', async () => {
    const older = deferred(); request.mockImplementationOnce(() => older.promise); await mount()
    const oldSignal = request.mock.calls[0]![1].signal as AbortSignal
    request.mockResolvedValue(json({ schemaVersion: 1, matchId: 'other', state: 'NOT_STARTED' })); await mount('other')
    expect(oldSignal.aborted).toBe(true)
    await act(async () => older.finish(json(ready)))
    expect(host.textContent).toContain('has not started a turn'); expect(host.querySelector('dl')).toBeNull()
  })
  it('aborts on session-driven unmount and ignores even a fetch that disregards cancellation', async () => {
    const pending = deferred(); request.mockImplementation(() => pending.promise); await mount()
    const signal = request.mock.calls[0]![1].signal as AbortSignal
    await act(async () => root.render(<p>Signed out</p>)); expect(signal.aborted).toBe(true)
    await act(async () => pending.finish(json(ready))); expect(host.textContent).toBe('Signed out')
  })
  it('renders safe-integer deadlines beyond the calendar range without throwing', async () => {
    request.mockResolvedValue(json({ ...ready, turn: { ...ready.turn, deadlineAtMs: Number.MAX_SAFE_INTEGER } }))
    await mount(); expect(host.textContent).toContain(`${Number.MAX_SAFE_INTEGER} milliseconds after 1970-01-01`)
  })
})
