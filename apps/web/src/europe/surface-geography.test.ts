import { beforeAll, describe, expect, it } from 'vitest'
import { prepareSurfaceNavigation } from '../../../../packages/game-engine/src/surface-navigation.js'
import { europeWorldToMap } from '../../../../packages/shared-types/src/europe-preview.js'
import mask from '../../dev/fixtures/europe-surface-mask.json'
import review from '../../dev/fixtures/europe-surface-review.json'
import geography from './geography.json'
import { project } from './camera'

let surface: ReturnType<typeof prepareSurfaceNavigation>
beforeAll(() => { surface = prepareSurfaceNavigation(mask) }, 20000)
const point = (lon: number, lat: number) => europeWorldToMap(project(lon, lat))

describe('reviewed Europe geographic anchors', () => {
  it('places 137 existing city anchors on land and explicitly retains the unresolved Geneva source anchor', () => {
    expect(geography.cities).toHaveLength(review.cities.total)
    const unresolved = geography.cities.filter(city => surface.classifyPoint(point(city.lon, city.lat)) !== 'LAND')
    expect(unresolved).toEqual(review.cities.unresolved.map(({ name, country, lon, lat }) => ({ name, country, lon, lat, capital: false })))
    for (const city of review.cities.unresolved) expect(surface.classifyPoint(point(city.lon, city.lat))).toBe(city.expected)
  })
  it.each(review.points)('preserves $name as $expected', ({ lon, lat, expected }) => {
    expect(surface.classifyPoint(point(lon, lat))).toBe(expected)
  })
  it.each(review.routes)('$name', ({ domain, points, eligible }) => {
    const path = points.map(([lon, lat]) => point(lon!, lat!))
    expect(path.map(surface.classifyPoint)).toEqual(['OCEAN', 'OCEAN'])
    expect(surface.validateRoute(domain as 'NAVAL', path).eligible).toBe(eligible)
  })
})
