import { z } from 'zod'

export const EUROPE_FIXTURE_ID = 'europe-defense-preview-v1'
export const EUROPE_MASK_ID = 'europe-ne10m-surface-v2'
export const EUROPE_PROFILE_ID = 'europe-mercator-fixed-v2'
const mercator = (lat: number) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2
export const EUROPE_PROFILE = Object.freeze({
  id: EUROPE_PROFILE_ID, unitsPerWorld: 4_000_000,
  originX: (-25 + 180) / 360, originY: mercator(72),
  width: Math.round(85 / 360 * 4_000_000), height: Math.round((mercator(25) - mercator(72)) * 4_000_000),
})
export type EuropeMapPoint = Readonly<{ x: number; y: number }>
export function europeWorldToMap(point: EuropeMapPoint): EuropeMapPoint {
  return { x: Math.round((point.x - EUROPE_PROFILE.originX) * EUROPE_PROFILE.unitsPerWorld),
    y: Math.round((point.y - EUROPE_PROFILE.originY) * EUROPE_PROFILE.unitsPerWorld) }
}
export function europeMapToWorld(point: EuropeMapPoint): EuropeMapPoint {
  return { x: point.x / EUROPE_PROFILE.unitsPerWorld + EUROPE_PROFILE.originX,
    y: point.y / EUROPE_PROFILE.unitsPerWorld + EUROPE_PROFILE.originY }
}
export const EuropeMapPointSchema = z.strictObject({ x: z.number().int().min(-1_000_000).max(1_000_000), y: z.number().int().min(-1_000_000).max(1_000_000) }).readonly()
const profile = { schemaVersion: z.literal(1), fixtureId: z.literal(EUROPE_FIXTURE_ID),
  profileId: z.literal(EUROPE_PROFILE_ID), maskId: z.literal(EUROPE_MASK_ID) }
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const EuropePreviewCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...profile, kind: z.literal('DEFENSE'), revision, points: z.array(EuropeMapPointSchema).min(2).max(32) }),
  z.strictObject({ ...profile, kind: z.literal('ROUTE'), revision, formationId: z.enum(['iberian-division', 'atlantic-fleet']), waypoints: z.array(EuropeMapPointSchema).min(1).max(32) }),
])
export type EuropePreviewCommand = z.infer<typeof EuropePreviewCommandSchema>
export const EuropePreviewSessionSchema = z.strictObject({ ...profile, formations: z.array(z.strictObject({
  id: z.enum(['iberian-division', 'atlantic-fleet']), name: z.string().min(1), domain: z.enum(['LAND', 'NAVAL']), position: EuropeMapPointSchema,
})).length(2) })
export type EuropePreviewSession = z.infer<typeof EuropePreviewSessionSchema>
export const EuropePreviewResultSchema = z.strictObject({ ...profile, kind: z.enum(['DEFENSE', 'ROUTE']), revision,
  eligible: z.boolean(), reason: z.enum(['ELIGIBLE', 'LAND_REQUIRED', 'OCEAN_REQUIRED', 'INLAND_WATER_BLOCKED', 'BOUNDARY_CONTACT', 'OUT_OF_BOUNDS']),
  segmentIndex: z.number().int().nonnegative().max(31).nullable(),
}).refine(result => result.eligible === (result.reason === 'ELIGIBLE') && (result.eligible ? result.segmentIndex === null : result.segmentIndex !== null))
export type EuropePreviewResult = z.infer<typeof EuropePreviewResultSchema>
