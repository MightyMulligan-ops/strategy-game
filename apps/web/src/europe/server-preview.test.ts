import { beforeAll, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { EUROPE_FIXTURE_ID, EUROPE_MASK_ID, EUROPE_PROFILE_ID, europeWorldToMap } from '../../../../packages/shared-types/src/europe-preview.js'
import { createEuropePreviewService, europePreviewAccess, europePreviewPlugin, handleEuropePreview } from '../../dev/europe-preview'
import { project } from './camera'

const identity = { schemaVersion: 1, fixtureId: EUROPE_FIXTURE_ID, maskId: EUROPE_MASK_ID, profileId: EUROPE_PROFILE_ID, revision: 0 }
const p = (lon: number, lat: number) => europeWorldToMap(project(lon, lat))
let service: ReturnType<typeof createEuropePreviewService>
beforeAll(() => { service = createEuropePreviewService() }, 20000)
const route = (formationId: string, waypoints: unknown[]) => ({ ...identity, kind: 'ROUTE', formationId, waypoints })
async function http(body: string, overrides: { method?: string; url?: string; origin?: string; address?: string; contentType?: string } = {}) {
  const request = Readable.from([body]) as unknown as IncomingMessage
  Object.assign(request, { method: overrides.method ?? 'POST', url: overrides.url ?? '/__prototype/europe/validate',
    socket: { remoteAddress: overrides.address ?? '127.0.0.1' }, headers: { host: '127.0.0.1:5173', origin: overrides.origin ?? 'http://127.0.0.1:5173', 'content-type': overrides.contentType ?? 'application/json' } })
  const headers = new Map<string, unknown>()
  let output = ''
  const response = { statusCode: 0, setHeader: (key: string, value: unknown) => headers.set(key, value), end: (value: string) => { output = value } }
  await handleEuropePreview(request, response as unknown as ServerResponse, service)
  return { status: response.statusCode, body: JSON.parse(output) as Record<string, unknown>, headers }
}
describe('server-owned Europe surface previews', () => {
  it('pins the exact prototype mask bytes and keeps physical layers separately versioned', () => {
    const bytes = readFileSync(new URL('../../dev/fixtures/europe-surface-mask.json', import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('82e3763c12caa1dfc002daba35aa378a3acb207a239434a5d30cdc8b44dd7cd9')
    const mask = JSON.parse(bytes.toString()) as { land: unknown[]; inlandWater: unknown[] }
    expect(mask.land).toHaveLength(194); expect(mask.inlandWater).toHaveLength(79)
  })
  it('permits real land and ocean paths with original national borders kept separate', () => {
    expect(service.validate(route('iberian-division', [p(-7, 41.5), p(-8, 41.5)]))).toMatchObject({ eligible: true, reason: 'ELIGIBLE' })
    expect(service.validate(route('atlantic-fleet', [p(-12, 40)]))).toMatchObject({ eligible: true })
    expect(service.validate({ ...identity, kind: 'DEFENSE', points: [p(-5, 41.2), p(-4, 40.8), p(-3, 40.4)] })).toMatchObject({ eligible: true })
  })
  it('rejects LAND in ocean and NAVAL on land using server domains', () => {
    expect(service.validate(route('iberian-division', [p(-11, 39)]))).toMatchObject({ eligible: false, reason: 'LAND_REQUIRED', segmentIndex: 0 })
    expect(service.validate(route('atlantic-fleet', [p(-3.7038, 40.4168)]))).toMatchObject({ eligible: false, reason: 'OCEAN_REQUIRED', segmentIndex: 0 })
  })
  it('rejects an intermediate sea crossing even when route destinations are land', () => {
    const result = service.validate(route('iberian-division', [p(-8.54, 42.88), p(-1.68, 48.12)]))
    expect(result.eligible).toBe(false); expect(result.segmentIndex).toBe(1)
  })
  it('blocks explicit Lake Ladoga water for both domains and rejects outside geometry', () => {
    for (const id of ['iberian-division', 'atlantic-fleet']) expect(service.validate(route(id, [p(31.5, 60.8)]))).toMatchObject({ eligible: false, reason: 'INLAND_WATER_BLOCKED' })
    expect(service.validate(route('atlantic-fleet', [{ x: -1, y: 100 }]))).toMatchObject({ eligible: false, reason: 'OUT_OF_BOUNDS' })
  })
  it('rejects client origins, domains, masks, unknown formations and oversized geometry', () => {
    const valid = route('iberian-division', [p(-4, 40.8)])
    for (const command of [{ ...valid, domain: 'NAVAL' }, { ...valid, origin: p(-11, 39) }, { ...valid, mask: {} }, { ...valid, maskId: 'other' }, { ...valid, formationId: 'enemy' }, { ...valid, waypoints: Array.from({ length: 33 }, () => p(-4, 40.8)) }]) expect(() => service.validate(command)).toThrow()
  })
  it('never mutates fixture positions or trusts a previously returned session object', () => {
    const before = service.session()
    const tampered = service.session(); tampered.formations[0]!.position = p(-11, 39)
    const command = route('iberian-division', [p(-4, 40.8)])
    expect(service.validate(command).eligible).toBe(true)
    expect(service.validate(command)).toEqual(service.validate(command))
    expect(service.session()).toEqual(before)
  })
  it('runs only as a serve plugin and requires loopback host/origin', () => {
    expect(europePreviewPlugin().apply).toBe('serve')
    const good = { address: '127.0.0.1', host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', method: 'POST' }
    expect(europePreviewAccess(good)).toBe(true)
    for (const bad of [{ address: '192.0.2.1' }, { host: 'attacker.example:5173' }, { origin: 'https://attacker.example' }, { origin: undefined }]) expect(europePreviewAccess({ ...good, ...bad })).toBe(false)
  })
  it('serves safe JSON without CORS or cookies and refuses malformed/foreign requests', async () => {
    const result = await http(JSON.stringify(route('atlantic-fleet', [p(-12, 40)])))
    expect(result.status).toBe(200); expect(result.body.eligible).toBe(true)
    expect(result.headers.get('Cache-Control')).toBe('no-store')
    expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(result.headers.has('Set-Cookie')).toBe(false)
    expect((await http('', { method: 'GET', url: '/__prototype/europe/session' })).body.fixtureId).toBe(EUROPE_FIXTURE_ID)
    expect((await http('{}', { origin: 'https://attacker.example' })).status).toBe(403)
    expect((await http('{}', { address: '192.0.2.1' })).status).toBe(403)
    expect((await http('{')).status).toBe(400)
    expect((await http('{}', { contentType: 'text/plain' })).status).toBe(415)
    expect((await http('{}', { method: 'PUT' })).status).toBe(405)
    expect((await http('', { url: '/__prototype/europe/unknown' })).status).toBe(404)
    expect((await http(' '.repeat(16385))).status).toBe(413)
  })
})
