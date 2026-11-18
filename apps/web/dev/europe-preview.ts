import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { EUROPE_FIXTURE_ID, EUROPE_MASK_ID, EUROPE_PROFILE, EUROPE_PROFILE_ID, EuropePreviewCommandSchema, EuropePreviewResultSchema, EuropePreviewSessionSchema, europeWorldToMap } from '../../../packages/shared-types/src/europe-preview.js'
import { prepareSurfaceNavigation } from '../../../packages/game-engine/src/surface-navigation.js'
import mask from './fixtures/europe-surface-mask.json' with { type: 'json' }

const identity = { schemaVersion: 1 as const, fixtureId: EUROPE_FIXTURE_ID, profileId: EUROPE_PROFILE_ID, maskId: EUROPE_MASK_ID }
const coordinate = (lon: number, lat: number) => europeWorldToMap({ x: (lon + 180) / 360,
  y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 })
// Public fixture formations only. These are never loaded from an account, match or database.
const formations = Object.freeze([
  Object.freeze({ id: 'iberian-division' as const, name: 'Iberian division · fixture', domain: 'LAND' as const, position: Object.freeze(coordinate(-3.7038, 40.4168)) }),
  Object.freeze({ id: 'atlantic-fleet' as const, name: 'Atlantic fleet · fixture', domain: 'NAVAL' as const, position: Object.freeze(coordinate(-11, 39)) }),
])

export function createEuropePreviewService() {
  if (mask.maskId !== EUROPE_MASK_ID || mask.bounds.width !== EUROPE_PROFILE.width || mask.bounds.height !== EUROPE_PROFILE.height) throw new Error('Incompatible Europe prototype mask')
  const navigation = prepareSurfaceNavigation(mask)
  for (const formation of formations) if (navigation.classifyPoint(formation.position) !== (formation.domain === 'LAND' ? 'LAND' : 'OCEAN')) throw new Error('Invalid prototype formation origin')
  return Object.freeze({
    session: () => EuropePreviewSessionSchema.parse({ ...identity, formations }),
    validate(input: unknown) {
      const command = EuropePreviewCommandSchema.parse(input)
      // Domain and origin are always server-owned. Unknown client fields fail strict parsing.
      const formation = command.kind === 'ROUTE' ? formations.find(f => f.id === command.formationId)! : null
      const points = command.kind === 'DEFENSE' ? command.points : [formation!.position, ...command.waypoints]
      const result = navigation.validateRoute(formation?.domain ?? 'LAND', points)
      return EuropePreviewResultSchema.parse({ ...identity, kind: command.kind, revision: command.revision,
        eligible: result.eligible, reason: result.reason, segmentIndex: result.segmentIndex })
    },
  })
}

export function europePreviewAccess(input: { address: string | undefined; host: string | undefined; origin: string | undefined; method: string | undefined }) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(input.address ?? '')) return false
  if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(input.host ?? '')) return false
  return input.method === 'GET' ? input.origin === undefined || input.origin === `http://${input.host}` : input.origin === `http://${input.host}`
}

type Service = ReturnType<typeof createEuropePreviewService>
export async function handleEuropePreview(request: IncomingMessage, response: ServerResponse, service: Service) {
  const send = (status: number, body: unknown) => {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify(body))
  }
  if (!europePreviewAccess({ address: request.socket.remoteAddress, host: request.headers.host, origin: request.headers.origin, method: request.method })) return send(403, { error: 'PROTOTYPE_LOOPBACK_ORIGIN_REQUIRED' })
  const path = request.url?.split('?')[0]
  if (request.method === 'GET' && path === '/__prototype/europe/session') return send(200, service.session())
  if (path !== '/__prototype/europe/validate') return send(404, { error: 'PROTOTYPE_NOT_FOUND' })
  if (request.method !== 'POST') return send(405, { error: 'PROTOTYPE_METHOD_NOT_ALLOWED' })
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return send(415, { error: 'PROTOTYPE_JSON_REQUIRED' })
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      size += buffer.length
      if (size > 16_384) return send(413, { error: 'PROTOTYPE_BODY_TOO_LARGE' })
      chunks.push(buffer)
    }
    return send(200, service.validate(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
  } catch { return send(400, { error: 'PROTOTYPE_INVALID_OR_INCOMPATIBLE_REQUEST' }) }
}

/** Runs inside Vite only. Never registered in the application server or a production build. */
export function europePreviewPlugin(): Plugin {
  return { name: 'europe-surface-preview', apply: 'serve', configureServer(server) {
    let service: Service | null = null
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith('/__prototype/europe/')) return next()
      if (!europePreviewAccess({ address: request.socket.remoteAddress, host: request.headers.host, origin: request.headers.origin, method: request.method })) { response.statusCode = 403; response.end(JSON.stringify({ error: 'PROTOTYPE_LOOPBACK_ORIGIN_REQUIRED' })); return }
      try { service ??= createEuropePreviewService() }
      catch { response.statusCode = 503; response.end(JSON.stringify({ error: 'PROTOTYPE_MASK_UNAVAILABLE' })); return }
      void handleEuropePreview(request, response, service)
    })
  } }
}
