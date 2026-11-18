import { describe, expect, it, vi } from 'vitest'
import { EUROPE_FIXTURE_ID, EUROPE_MASK_ID, EUROPE_PROFILE_ID } from '../../../../packages/shared-types/src/europe-preview.js'
import type { EuropePreviewCommand } from '../../../../packages/shared-types/src/europe-preview.js'
import { EuropePreviewClient } from './preview-client'
const command: EuropePreviewCommand = { schemaVersion: 1, fixtureId: EUROPE_FIXTURE_ID, maskId: EUROPE_MASK_ID, profileId: EUROPE_PROFILE_ID,
  kind: 'DEFENSE', revision: 1, points: [{ x: 100, y: 100 }, { x: 200, y: 200 }] }
const result = { schemaVersion: 1, fixtureId: EUROPE_FIXTURE_ID, maskId: EUROPE_MASK_ID, profileId: EUROPE_PROFILE_ID,
  kind: 'DEFENSE', revision: 1, eligible: true, reason: 'ELIGIBLE', segmentIndex: null }
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
describe('surface preview response acceptance', () => {
  it('rejects late success after editing even when fetch ignores cancellation', async () => {
    let finish: (r: Response) => void = () => {}
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    const client = new EuropePreviewClient(fetcher)
    const pending = client.validate(command)
    client.invalidate(); finish(json(result))
    expect(await pending).toEqual({ status: 'stale' })
  })
  it('accepts only the latest concurrent request and exact revision/kind', async () => {
    const resolvers: ((r: Response) => void)[] = []
    const client = new EuropePreviewClient(vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve))))
    const first = client.validate(command), second = client.validate({ ...command, revision: 2 })
    resolvers[1]!(json({ ...result, revision: 2 })); expect(await second).toMatchObject({ status: 'current' })
    resolvers[0]!(json(result)); expect(await first).toEqual({ status: 'stale' })
    const wrong = new EuropePreviewClient(vi.fn(async () => json({ ...result, revision: 99 })))
    expect(await wrong.validate(command)).toEqual({ status: 'error' })
  })
  it('fails closed for malformed, incompatible and failed responses', async () => {
    for (const value of [{}, { ...result, eligible: false }, { ...result, maskId: 'other' }, { ...result, kind: 'ROUTE' }]) {
      const client = new EuropePreviewClient(vi.fn(async () => json(value)))
      expect(await client.validate(command)).toEqual({ status: 'error' })
    }
    expect(await new EuropePreviewClient(vi.fn(async () => new Response('', { status: 503 }))).validate(command)).toEqual({ status: 'error' })
  })
})
