// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EUROPE_FIXTURE_ID, EUROPE_MASK_ID, EUROPE_PROFILE_ID, europeWorldToMap } from '../../../../packages/shared-types/src/europe-preview.js'
import type { EuropePreviewCommand } from '../../../../packages/shared-types/src/europe-preview.js'
import PlanningTools from './PlanningTools'
import type { PlanningHandle, PlanningMode } from './PlanningTools'
import { fitSpain, fitTheatre, project } from './camera'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const identity = { schemaVersion: 1, fixtureId: EUROPE_FIXTURE_ID, maskId: EUROPE_MASK_ID, profileId: EUROPE_PROFILE_ID }
const session = { ...identity, formations: [
  { id: 'iberian-division', name: 'Division fixture', domain: 'LAND', position: europeWorldToMap(project(-3.7038, 40.4168)) },
  { id: 'atlantic-fleet', name: 'Fleet fixture', domain: 'NAVAL', position: europeWorldToMap(project(-11, 39)) },
] }
const view = { width: 1920, height: 948 }
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
const result = (command: EuropePreviewCommand) => ({ ...identity, kind: command.kind, revision: command.revision, eligible: true, reason: 'ELIGIBLE', segmentIndex: null })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, ref: ReturnType<typeof createRef<PlanningHandle>>
const commands: EuropePreviewCommand[] = []
const request = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  if (url.endsWith('/session')) return json(session)
  const command = JSON.parse(String(init?.body)) as EuropePreviewCommand
  commands.push(command); return json(result(command))
})
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); ref = createRef(); commands.length = 0; request.mockClear(); vi.stubGlobal('fetch', request) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const render = (camera = fitSpain(view), mode: PlanningMode = 'defense') => act(async () => root.render(<PlanningTools ref={ref} camera={camera} view={view} mode={mode} onModeChange={vi.fn()} onCenter={vi.fn()} />))
const click = (label: string) => act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click())
it('keeps defense world coordinates unchanged across camera changes and sends versioned server checks', async () => {
  await render(); await click('Check defense surface')
  const before = commands[0]!
  expect(before.kind).toBe('DEFENSE')
  await render(fitTheatre(view)); await click('Check defense surface')
  expect(commands[1]).toEqual(before)
  expect(host.textContent).toContain('Surface check passed')
  expect(host.querySelectorAll('[data-planning-handle][tabindex="0"]')).toHaveLength(1)
})
it('adds, nudges, removes and undoes vertices while invalidating the prior result', async () => {
  await render(); await click('Check defense surface')
  await act(async () => ref.current!.pick(project(-2.5, 40.6)))
  expect(host.querySelectorAll('[data-planning-handle]')).toHaveLength(4)
  expect(host.textContent).not.toContain('Surface check passed')
  await click('Check defense surface')
  const added = commands.at(-1)!
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nudge selected point right"]')!.click())
  await click('Check defense surface')
  const moved = commands.at(-1)!
  expect(added.kind === 'DEFENSE' && moved.kind === 'DEFENSE' && moved.points[3]!.x > added.points[3]!.x).toBe(true)
  await click('Remove point'); expect(host.querySelectorAll('[data-planning-handle]')).toHaveLength(3)
  await click('Undo edit'); expect(host.querySelectorAll('[data-planning-handle]')).toHaveLength(4)
  await click('Clear line'); expect(host.querySelectorAll('[data-planning-handle]')).toHaveLength(0)
})
it('previews a naval route without supplying a domain or origin from the client', async () => {
  await render(fitSpain(view), 'route')
  await act(async () => { const select = host.querySelector<HTMLSelectElement>('#ep-formation-select')!; select.value = 'atlantic-fleet'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => ref.current!.pick(project(-12, 40)))
  await click('Check route surface · 1/32')
  expect(commands[0]).toMatchObject({ kind: 'ROUTE', formationId: 'atlantic-fleet', waypoints: [europeWorldToMap(project(-12, 40))] })
  expect(commands[0]).not.toHaveProperty('domain'); expect(commands[0]).not.toHaveProperty('origin')
})
it('does not show an old success after clearing geometry during a request', async () => {
  await render()
  let finish: (value: Response) => void = () => {}
  let sent: EuropePreviewCommand | null = null
  request.mockImplementationOnce(async (_url: string, init?: RequestInit) => { sent = JSON.parse(String(init?.body)) as EuropePreviewCommand; return new Promise(resolve => { finish = resolve }) })
  await click('Check defense surface'); await click('Clear line')
  await act(async () => finish(json(result(sent!))))
  expect(host.textContent).not.toContain('Surface check passed')
  expect(host.querySelectorAll('[data-planning-handle]')).toHaveLength(0)
})
