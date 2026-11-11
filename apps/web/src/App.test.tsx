// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedPlayer, LobbyDetail } from '@strategy-game/shared-types'
import { classifyLobbyTurnDuration, LobbyDetailSchema } from '@strategy-game/shared-types'
import App from './App'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const profile: AuthenticatedPlayer = { schemaVersion: 1, id: 'private-account', username: 'Commander', linkedProviders: ['google'] }
function room(role: 'HOST' | 'PARTICIPANT' | 'NON_PARTICIPANT' = 'NON_PARTICIPANT', status: 'OPEN' | 'RUNNING' = 'OPEN', ready = false, pair = false): LobbyDetail {
  const host = { playerId: 'public-host', username: role === 'HOST' ? 'Commander' : 'HostUser', ready }
  const participants = pair || role === 'PARTICIPANT' || status === 'RUNNING' ? [host, { playerId: 'public-guest', username: role === 'HOST' ? 'OtherPlayer' : 'Commander', ready }] : [host]
  return LobbyDetailSchema.parse({ schemaVersion: 1, lobbyId: 'council', settings: { name: 'Evening Council', playerCapacity: 2, turnDurationMs: 300000, visibility: 'PUBLIC' },
    status, host, participants, participantCount: participants.length, readyCount: ready ? participants.length : 0, availableSlots: status === 'OPEN' ? 2 - participants.length : 0, durationCategory: 'QUICK',
    viewer: { role, playerId: role === 'HOST' ? host.playerId : role === 'PARTICIPANT' ? 'public-guest' : null, username: 'Commander',
      canJoin: status === 'OPEN' && role === 'NON_PARTICIPANT' && participants.length < 2, canLeave: status === 'OPEN' && role === 'PARTICIPANT',
      canStart: status === 'OPEN' && role === 'HOST' && participants.length >= 2 && ready } })
}
const json = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const failure = (error: string, status = 409) => json({ schemaVersion: 1, error }, status)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let user: AuthenticatedPlayer | null
let current: LobbyDetail
let tokens: number
let listed: boolean
let intercept: ((path: string, init: RequestInit) => Response | Promise<Response> | undefined) | undefined
const redirect = { assign: vi.fn(), replace: vi.fn(), search: '' }
const request = vi.fn(async (path: string, init: RequestInit = {}): Promise<Response> => {
  const override = intercept?.(path, init)
  if (override) return override
  if (path === '/auth/config') return json({ enabled: true, providers: ['google', 'discord'] })
  if (path === '/auth/csrf') return json({ csrfToken: `current-token-${++tokens}` })
  if (path === '/auth/me') return user ? json({ user }) : json({ error: 'unauthorized' }, 401)
  if (path === '/auth/username') { user = profile; return json({ user }) }
  if (path.startsWith('/auth/logout')) return json(null, 204)
  if (path.startsWith('/auth/login/') || path.startsWith('/auth/link/')) return json({ authorizationUrl: 'https://identity.example/authorize' })
  if (path === '/api/lobbies?status=OPEN' || path === '/api/lobbies?status=RUNNING') {
    const { participants: roster, viewer, ...summary } = current
    void roster; void viewer
    return json({ schemaVersion: 1, lobbies: path.endsWith('RUNNING') ? current.status === 'RUNNING' ? [summary] : [] : listed ? [summary] : [] })
  }
  if (path === '/api/lobbies' && init.method === 'POST') {
    const body = JSON.parse(init.body as string)
    current = LobbyDetailSchema.parse({ ...room('HOST'), settings: body.settings, availableSlots: body.settings.playerCapacity - 1,
      durationCategory: classifyLobbyTurnDuration(body.settings.turnDurationMs) })
    listed = true; return json({ schemaVersion: 1, lobby: current }, 201)
  }
  if (path.endsWith('/join')) { current = room('PARTICIPANT'); return json({ schemaVersion: 1, lobby: current, outcome: 'JOINED' }) }
  if (path.endsWith('/leave')) { current = room(); return json({ schemaVersion: 1, lobby: current }) }
  if (path.endsWith('/ready')) {
    const ready = (JSON.parse(init.body as string) as { ready: boolean }).ready
    const participants = current.participants.map((player) => player.playerId === current.viewer.playerId ? { ...player, ready } : player)
    const readyCount = participants.filter((player) => player.ready).length
    current = LobbyDetailSchema.parse({ ...current, participants, readyCount,
      host: participants.find((player) => player.playerId === current.host.playerId),
      viewer: { ...current.viewer, canStart: current.viewer.role === 'HOST' && participants.length >= 2 && readyCount === participants.length } })
    return json({ schemaVersion: 1, lobby: current })
  }
  if (path.endsWith('/start')) { current = room('HOST', 'RUNNING', true); listed = false; return json({ schemaVersion: 1, lobby: current, outcome: 'STARTED' }) }
  if (path === '/api/lobbies/council') return json({ schemaVersion: 1, lobby: current })
  throw new Error(`Unexpected test request: ${path}`)
})

beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  user = profile; current = room(); tokens = 0; listed = true; intercept = undefined; request.mockClear(); redirect.assign.mockClear(); redirect.replace.mockClear()
  const originalWindow = window
  vi.stubGlobal('window', new Proxy(originalWindow, { get(target, key) { return key === 'location' ? redirect : Reflect.get(target, key, target) } }))
  vi.stubGlobal('fetch', request)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount() { await act(async () => { root.render(<StrictMode><App /></StrictMode>) }) }
const text = () => host.textContent ?? ''
function button(name: string) {
  const result = [...host.querySelectorAll('button')].find((element) => {
    const copy = element.cloneNode(true) as HTMLElement
    copy.querySelectorAll('[aria-hidden=true]').forEach((node) => node.remove())
    return copy.textContent?.trim() === name
  })
  expect(result, `Missing button: ${name}`).toBeDefined(); return result!
}
async function click(name: string) { await act(async () => button(name).click()) }
async function value(id: string, content: string) {
  await act(async () => {
    const element = host.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, content)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function submit(id: string) { await act(async () => { host.querySelector(id)!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
const posts = () => request.mock.calls.filter(([, init]) => init?.method === 'POST')

describe('Sovereign account and lobby UI', () => {
  it('uses original assets and offers configured sign-in without loading lobby data for signed-out users', async () => {
    user = null; await mount()
    expect(button('Continue with Discord').disabled).toBe(false)
    expect(host.querySelector('img[alt="Sovereign"]')?.getAttribute('src')).toBe('/assets/branding/wordmark.svg')
    expect(host.querySelector('img[alt="Gold crown over a circular globe"]')?.getAttribute('src')).toBe('/assets/branding/emblem.svg')
    expect(text()).not.toContain('STRATEGY GAME'); expect(request.mock.calls.some(([path]) => path.startsWith('/api'))).toBe(false)
    await click('Continue with Discord')
    expect(posts()[0]?.[0]).toBe('/auth/login/discord'); expect(redirect.assign).toHaveBeenCalledWith('https://identity.example/authorize')
  })
  it('disables unavailable sign-in providers and keeps auth-disabled setup understandable', async () => {
    user = null; intercept = (path) => path === '/auth/config' ? json({ enabled: false, providers: [] }) : undefined
    await mount(); expect(text()).toContain('Sign-in is temporarily unavailable.')
    expect(button('Continue with Google').disabled).toBe(true); expect(button('Continue with Discord').disabled).toBe(true)
    expect(request.mock.calls.some(([path]) => path === '/auth/csrf')).toBe(false)
  })
  it('keeps username onboarding separate and unlocks lobbies only after server confirmation', async () => {
    user = { ...profile, username: null }; await mount()
    expect(text()).toContain('Choose your call sign'); expect(host.querySelector('#lobby-name')).toBeNull()
    await value('username', 'Commander'); await submit('#username')
    expect(posts()[0]?.[0]).toBe('/auth/username'); expect(text()).toContain('The assembly')
  })
  it.each([false, undefined, 'true', 'false'])('hides local test login unless advertised with boolean true (%s)', async (enabled) => {
    user = null; intercept = (path) => path === '/auth/config' ? json({ enabled: true, providers: ['google'], devLoginEnabled: enabled }) : undefined
    await mount(); expect(host.querySelector('#local-test-player')).toBeNull()
  })
  it('uses the advertised local fixture control and reloads after server session rotation', async () => {
    user = null
    intercept = (path) => path === '/auth/config' ? json({ enabled: true, providers: [], devLoginEnabled: true })
      : path === '/auth/dev-login' ? json({ user: { ...profile, username: null, linkedProviders: [] } }) : undefined
    await mount(); await value('local-test-player', 'player-two'); await click('Local test sign-in')
    expect(posts()).toHaveLength(1); expect(posts()[0]?.[0]).toBe('/auth/dev-login')
    expect(JSON.parse(posts()[0]?.[1]?.body as string)).toEqual({ fixture: 'player-two' })
    expect(posts()[0]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'current-token-1' })
    expect(posts()[0]?.[1]?.credentials).toBe('same-origin'); expect(redirect.replace).toHaveBeenCalledWith('/')
  })
  it('keeps local fixture failures safe and does not offer local sign-in to an authenticated account', async () => {
    user = null
    intercept = (path) => path === '/auth/config' ? json({ enabled: true, providers: [], devLoginEnabled: true })
      : path === '/auth/dev-login' ? json({ privateError: 'do-not-display' }, 500) : undefined
    await mount(); await click('Local test sign-in')
    expect(text()).toContain('Local test sign-in could not be completed.'); expect(text()).not.toContain('do-not-display')
  })
  it('explains fixture account isolation and disables linking without affecting normal OAuth UI', async () => {
    user = { ...profile, linkedProviders: [] }
    intercept = (path) => path === '/auth/config' ? json({ enabled: true, providers: ['google', 'discord'], devLoginEnabled: true }) : undefined
    await mount(); expect(host.querySelector('#local-test-player')).toBeNull()
    expect(text()).toContain('Provider linking is disabled.')
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent === 'Link account').every((b) => b.disabled)).toBe(true)
  })
  it('honors per-provider availability when authentication is enabled', async () => {
    user = null; intercept = (path) => path === '/auth/config' ? json({ enabled: true, providers: ['google'] }) : undefined
    await mount(); expect(button('Continue with Google').disabled).toBe(false); expect(button('Continue with Discord').disabled).toBe(true)
  })
  it('keeps username conflicts actionable without inventing a successful registration', async () => {
    user = { ...profile, username: null }; intercept = (path) => path === '/auth/username' ? json({ error: 'username_taken' }, 409) : undefined
    await mount(); await value('username', 'Commander'); await submit('#username')
    expect(text()).toContain('That username is unavailable.'); expect(host.querySelector('#lobby-name')).toBeNull()
  })
  it('preserves provider linking, the initial session CSRF token and OAuth navigation', async () => {
    await mount(); await click('Link account')
    expect(posts()[0]?.[0]).toBe('/auth/link/discord')
    expect(posts()[0]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'current-token-1' })
    expect(redirect.assign).toHaveBeenCalledWith('https://identity.example/authorize')
  })
  it.each([['Sign out', '/auth/logout'], ['Sign out everywhere', '/auth/logout-all']])('preserves %s', async (label, path) => {
    await mount(); await click(label!)
    expect(posts()[0]?.[0]).toBe(path); expect(redirect.replace).toHaveBeenCalledWith('/')
  })
  it('shows the public list and authoritative detail, joins and leaves through real API paths', async () => {
    await mount(); expect(text()).toContain('Hosted by HostUser'); expect(text()).not.toContain('private-account')
    await click('Inspect Evening Council'); expect(button('Join lobby').disabled).toBe(false)
    await click('Join lobby'); expect(text()).toContain('You joined the lobby.'); expect(button('Leave lobby').disabled).toBe(false)
    await click('Leave lobby'); expect(text()).toContain('You left the lobby.'); expect(button('Join lobby').disabled).toBe(false)
    expect(posts().map(([path]) => path)).toEqual(['/api/lobbies/council/join', '/api/lobbies/council/leave'])
    for (const [, init] of posts()) { expect(init?.credentials).toBe('same-origin'); expect(JSON.parse(init?.body as string)).toEqual({ schemaVersion: 1 }) }
    expect(posts()[0]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'current-token-2' })
    expect(posts()[1]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'current-token-3' })
  })
  it('creates with shared-schema validation and refreshes list/detail after confirmation', async () => {
    listed = false; await mount(); expect(text()).toContain('No open lobbies yet.')
    await value('lobby-name', 'Morning Council'); await value('capacity', '10'); await value('turn-duration', '3600000'); await submit('#lobby-name')
    expect(JSON.parse(posts()[0]?.[1]?.body as string)).toEqual({ schemaVersion: 1, settings: { name: 'Morning Council', playerCapacity: 10, turnDurationMs: 3600000, visibility: 'PUBLIC' } })
    expect(text()).toContain('Lobby created. You are the host.'); expect(text()).toContain('You are the host. Hosts cannot leave')
    expect([...host.querySelectorAll('button')].some((b) => /^(Join lobby|Leave lobby)/.test(b.textContent ?? ''))).toBe(false)
    expect(button('Start Match').disabled).toBe(true)
  })
  it.each([[' padded ', '10'], ['Valid', '1'], ['Valid', '41'], ['Valid', '2.5']])('rejects invalid creation settings %s / %s', async (name, capacity) => {
    await mount(); await value('lobby-name', name!); await value('capacity', capacity!); await submit('#lobby-name')
    expect(text()).toContain('Enter a name without surrounding spaces, 2–40 players'); expect(posts()).toHaveLength(0)
  })
  it.each(['HOST', 'PARTICIPANT'] as const)('uses server flags for %s without offering forbidden actions', async (role) => {
    current = room(role); await mount(); await click('Inspect Evening Council')
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Join lobby')).toBe(false)
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Leave lobby')).toBe(role === 'PARTICIPANT')
  })
  it('shows readiness but offers no ready/start controls to nonparticipants', async () => {
    await mount(); await click('Inspect Evening Council')
    expect(text()).toContain('NOT READY'); expect(text()).toContain('0 / 1 ready')
    expect([...host.querySelectorAll('button')].some((b) => /^(Mark|Start Match)/.test(b.textContent ?? ''))).toBe(false)
  })
  it.each(['HOST', 'PARTICIPANT'] as const)('sets explicit own readiness both ways for %s with fresh CSRF and authoritative refresh', async (role) => {
    current = room(role); await mount(); await click('Inspect Evening Council')
    await click('Mark ready'); expect(button('Mark not ready').getAttribute('aria-pressed')).toBe('true')
    expect(posts()[0]?.[1]?.body).toBe(JSON.stringify({ schemaVersion: 1, ready: true }))
    await click('Mark not ready'); expect(button('Mark ready').getAttribute('aria-pressed')).toBe('false')
    expect(posts()[1]?.[1]?.body).toBe(JSON.stringify({ schemaVersion: 1, ready: false }))
    expect(posts()[0]?.[1]?.headers).not.toEqual(posts()[1]?.[1]?.headers)
    expect(request.mock.calls.filter(([path]) => path === '/api/lobbies/council')).toHaveLength(3)
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Start Match')).toBe(role === 'HOST')
  })
  it('explains minimum count, host readiness and waiting for others before enabling host start', async () => {
    current = room('HOST'); await mount(); await click('Inspect Evening Council')
    expect(button('Start Match').disabled).toBe(true); expect(text()).toContain('At least two players')
    current = room('HOST', 'OPEN', false, true); await click('Refresh details')
    expect(button('Start Match').disabled).toBe(true); expect(text()).toContain('Mark yourself ready')
    await click('Mark ready'); expect(button('Start Match').disabled).toBe(true); expect(text()).toContain('Waiting for every player')
    current = room('HOST', 'OPEN', true, true); await click('Refresh details')
    expect(button('Start Match').disabled).toBe(false); expect(text()).toContain('All players are ready')
    await click('Start Match'); expect(button('Start Match').disabled).toBe(true)
    expect(text()).toContain('Match started. Open the initial map to inspect your world.')
    expect(text()).toContain('RUNNING'); expect(text()).toContain('5 minutes')
    expect(posts().at(-1)?.[1]?.body).toBe(JSON.stringify({ schemaVersion: 1 }))
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Mark '))).toBe(false)
    await click('Refresh details'); expect(text()).toContain('RUNNING')
  })
  it.each(['NOT_ALL_READY', 'NOT_ENOUGH_PARTICIPANTS', 'HOST_REQUIRED', 'LOBBY_NOT_OPEN'])('refreshes a rejected %s start without retrying it', async (code) => {
    current = room('HOST', 'OPEN', true, true); await mount(); await click('Inspect Evening Council')
    intercept = (path) => {
      if (path.endsWith('/start')) { current = room('HOST', 'OPEN', false, true); return failure(code, code === 'HOST_REQUIRED' ? 403 : 409) }
    }
    await click('Start Match'); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(button('Start Match').disabled).toBe(true); expect(button('Mark ready').disabled).toBe(false)
    expect(posts()).toHaveLength(1)
  })
  it('acknowledges an already-started host response and keeps running controls closed', async () => {
    current = room('HOST', 'OPEN', true, true); await mount(); await click('Inspect Evening Council')
    intercept = (path) => {
      if (path.endsWith('/start')) { current = room('HOST', 'RUNNING', true); listed = false; return json({ schemaVersion: 1, lobby: current, outcome: 'ALREADY_STARTED' }) }
    }
    await click('Start Match'); expect(text()).toContain('This match has already started.')
    expect(button('Start Match').disabled).toBe(true); expect(posts()).toHaveLength(1)
  })
  it('lets a fresh page discover and inspect started lobbies with persisted duration and closed controls', async () => {
    current = room('HOST', 'RUNNING', true); listed = false; await mount()
    expect(text()).toContain('No open lobbies yet.')
    await value('lobby-status', 'RUNNING'); await click('Inspect Evening Council')
    expect(text()).toContain('Started lobbies'); expect(text()).toContain('RUNNING'); expect(text()).toContain('5 minutes')
    expect(button('Start Match').disabled).toBe(true)
    expect(button('View map').disabled).toBe(false)
    expect([...host.querySelectorAll('button')].some((b) => /^(Mark|Join lobby|Leave lobby)/.test(b.textContent ?? ''))).toBe(false)
    await value('lobby-status', 'OPEN'); expect(text()).toContain('No open lobbies yet.')
  })
  it('reloads stale/full/closed state once and never retries the rejected mutation', async () => {
    await mount(); await click('Inspect Evening Council')
    intercept = (path) => { if (path.endsWith('/join')) { current = room('PARTICIPANT', 'RUNNING'); listed = false; return failure('LOBBY_NOT_OPEN') } }
    await click('Join lobby'); expect(text()).toContain('That lobby is no longer open.'); expect(text()).toContain('Joining, leaving and readiness changes are closed.')
    expect(posts()).toHaveLength(1); expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Join lobby')).toBe(false)
  })
  it.each(['LOBBY_FULL', 'HOST_CANNOT_LEAVE', 'NOT_A_PARTICIPANT', 'CSRF_REJECTED', 'RATE_LIMITED', 'INVALID_REQUEST', 'INTERNAL_ERROR'])('explains %s safely without automatically repeating an action', async (code) => {
    await mount(); await click('Inspect Evening Council'); intercept = (path) => path.endsWith('/join') ? failure(code) : undefined
    await click('Join lobby'); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy(); expect(posts()).toHaveLength(1)
  })
  it.each(['UNAUTHENTICATED', 'USERNAME_REQUIRED'])('rechecks account authority after %s and removes lobby actions', async (code) => {
    await mount(); await click('Inspect Evening Council')
    intercept = (path) => { if (path.endsWith('/join')) { user = code === 'UNAUTHENTICATED' ? null : { ...profile, username: null }; return failure(code, 401) } }
    await click('Join lobby'); expect(host.querySelector('#lobby-name')).toBeNull()
    expect(text()).toContain(code === 'UNAUTHENTICATED' ? 'Sign in to continue' : 'Choose your call sign')
  })
  it('rejects malformed/private response fields and exposes no server error details', async () => {
    intercept = (path) => path.startsWith('/api') ? json({ schemaVersion: 1, lobbies: [], secret: 'private-database-password' }) : undefined
    await mount(); expect(text()).toContain('Unable to load lobbies.'); expect(text()).not.toContain('private-database-password')
  })
  it('supports explicit refresh and loading/error states without a polling loop', async () => {
    intercept = (path) => path.startsWith('/api') ? failure('INTERNAL_ERROR', 500) : undefined
    await mount(); expect(text()).toContain('Lobbies are temporarily unavailable.')
    intercept = undefined; listed = false; await click('Refresh list'); expect(text()).toContain('No open lobbies yet.')
    const count = request.mock.calls.length; await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) }); expect(request.mock.calls).toHaveLength(count)
  })
  it('shows loading until the initial public list resolves, then an accurate empty state', async () => {
    let resolve!: (response: Response) => void
    intercept = (path) => path.startsWith('/api') ? new Promise<Response>((done) => { resolve = done }) : undefined
    await mount(); expect(text()).toContain('Loading lobbies…'); expect(button('Refresh list').disabled).toBe(true)
    await act(async () => resolve(json({ schemaVersion: 1, lobbies: [] }))); expect(text()).toContain('No open lobbies yet.')
  })
  it('rejects an invalid duration instead of submitting a malformed create command', async () => {
    await mount(); await value('lobby-name', 'Council'); await value('turn-duration', 'invalid'); await submit('#lobby-name')
    expect(posts()).toHaveLength(0); expect(text()).toContain('a valid turn duration.')
  })
  it('prevents duplicate creates and conflicting account actions during a pending request', async () => {
    await mount(); await value('lobby-name', 'New Council')
    let resolve!: (response: Response) => void
    intercept = (path) => path === '/api/lobbies' ? new Promise<Response>((done) => { resolve = done }) : undefined
    await submit('#lobby-name'); await submit('#lobby-name')
    expect(posts()).toHaveLength(1); expect(button('Sign out').disabled).toBe(true)
    await act(async () => resolve(json({ schemaVersion: 1, lobby: room('HOST') }, 201)))
    expect(button('Sign out').disabled).toBe(false)
  })
  it('aborts pending reads and ignores late detail responses on unmount in StrictMode', async () => {
    await mount(); let resolve!: (response: Response) => void
    intercept = (path) => path === '/api/lobbies/council' ? new Promise<Response>((done) => { resolve = done }) : undefined
    await click('Inspect Evening Council'); expect(text()).toContain('Loading lobby details…')
    expect(host.querySelector<HTMLSelectElement>('#lobby-status')!.disabled).toBe(true)
    const signal = request.mock.calls.at(-1)![1]!.signal!
    await act(async () => root.render(<StrictMode><p>Different screen</p></StrictMode>)); expect(signal.aborted).toBe(true)
    await act(async () => resolve(json({ schemaVersion: 1, lobby: room() }))); expect(text()).toBe('Different screen')
  })
})
