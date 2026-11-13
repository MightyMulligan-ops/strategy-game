import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTurn } from './turn-api'

const ready = { schemaVersion: 1, matchId: 'match', state: 'READY',
  turn: { schemaVersion: 1, gameId: 'match', turnNumber: 1, status: 'open', openedAtMs: 1000, deadlineAtMs: 2000 },
  own: { schemaVersion: 1, gameId: 'match', turnNumber: 1, revision: 0, ready: false, orders: [] } }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const request = vi.fn()
beforeEach(() => { request.mockReset().mockResolvedValue(json(ready)); vi.stubGlobal('fetch', request) })
afterEach(() => vi.unstubAllGlobals())
const read = () => readTurn('match', new AbortController().signal)

describe('read-only turn transport', () => {
  it('uses one encoded same-origin GET with no body, token, retry or cache', async () => {
    const signal = new AbortController().signal
    request.mockResolvedValue(json({ schemaVersion: 1, matchId: 'a/b?#', state: 'NOT_STARTED' }))
    await readTurn('a/b?#', signal)
    expect(request.mock.calls).toEqual([['/api/matches/a%2Fb%3F%23/turn', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    }]])
  })
  it.each(['READY', 'NOT_STARTED', 'UNINITIALIZED'])('accepts the strict %s envelope', async (state) => {
    const value = state === 'READY' ? ready : { schemaVersion: 1, matchId: 'match', state }
    request.mockResolvedValue(json(value)); expect(await read()).toEqual(value)
  })
  it.each([
    { ...ready, seed: 123 }, { ...ready, players: [] }, { ...ready, snapshot: {} },
    { ...ready, turn: { ...ready.turn, lastObservedAtMs: 1000 } },
    { ...ready, own: { ...ready.own, identityId: 'private' } },
    { ...ready, own: { ...ready.own, revision: -1 } },
    { ...ready, own: { ...ready.own, ready: 'true' } },
    { ...ready, own: { ...ready.own, turnNumber: 2 } },
    { ...ready, turn: { ...ready.turn, deadlineAtMs: 500 } },
    { ...ready, matchId: 'other', turn: { ...ready.turn, gameId: 'other' }, own: { ...ready.own, gameId: 'other' } },
    { schemaVersion: 1, matchId: 'other', state: 'UNINITIALIZED' },
    { schemaVersion: 2, matchId: 'match', state: 'NOT_STARTED' },
    { schemaVersion: 1, matchId: 'match', state: 'UNINITIALIZED', orders: [] },
  ])('rejects mismatched, private or malformed responses', async (value) => {
    request.mockResolvedValue(json(value)); await expect(read()).rejects.toMatchObject({ reason: 'malformed' })
  })
  it.each([
    [401, 'UNAUTHENTICATED', 'session'], [403, 'USERNAME_REQUIRED', 'username'],
    [403, 'unknown-private-detail', 'forbidden'], [404, 'NOT_FOUND', 'not_found'],
    [429, 'RATE_LIMITED', 'rate_limited'], [500, 'private-storage-error', 'unavailable'],
  ])('sanitizes HTTP %i without exposing response text', async (status, error, reason) => {
    request.mockResolvedValue(json({ schemaVersion: 1, error }, status))
    await expect(read()).rejects.toMatchObject({ reason })
    await expect(read()).rejects.not.toThrow('private')
  })
  it('distinguishes network failure from invalid JSON without exposing either error', async () => {
    request.mockRejectedValue(new Error('private-host-or-token'))
    await expect(read()).rejects.toMatchObject({ reason: 'network' })
    request.mockResolvedValue(new Response('private-unparseable-json'))
    await expect(read()).rejects.toMatchObject({ reason: 'malformed' })
  })
  it('rejects invalid match IDs without issuing a request', async () => {
    await expect(readTurn('', new AbortController().signal)).rejects.toMatchObject({ reason: 'malformed' })
    expect(request).not.toHaveBeenCalled()
  })
})
