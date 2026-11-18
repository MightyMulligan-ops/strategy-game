import { describe, expect, it } from 'vitest'
import { fitSpain, fitTheatre, limits, panBy, project, SPAIN, THEATRE, toScreen, toWorld, visibleTiles, zoomAt } from './camera'
import geography from './geography.json'

describe('Europe display camera', () => {
  it.each([{ width: 1920, height: 920 }, { width: 1366, height: 620 }, { width: 2560, height: 1280 }, { width: 390, height: 650 }])('fits theatre and caps Spain geographic width for $width CSS pixels', view => {
    const overview = fitTheatre(view)
    for (const p of [project(THEATRE.west, THEATRE.north), project(THEATRE.east, THEATRE.south)]) {
      const s = toScreen(p, overview, view)
      expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x).toBeLessThanOrEqual(view.width)
      expect(s.y).toBeGreaterThanOrEqual(0); expect(s.y).toBeLessThanOrEqual(view.height)
    }
    const max = fitSpain(view)
    const west = toScreen(project(SPAIN.west, 40), max, view)
    const east = toScreen(project(SPAIN.east, 40), max, view)
    expect((east.x - west.x) / view.width).toBeCloseTo(1 / 1.08, 10)
    expect(zoomAt(max, view, { x: view.width / 2, y: view.height / 2 }, 100).scale).toBe(max.scale)
    expect(zoomAt(overview, view, { x: 0, y: 0 }, 0.01).scale).toBe(overview.scale)
  })
  it('preserves cursor anchor and city coordinates without mutating fixtures', () => {
    const view = { width: 1920, height: 920 }
    const start = fitTheatre(view), anchor = { x: 1040, y: 400 }
    const original = toWorld(anchor, start, view)
    const next = zoomAt(start, view, anchor, 1.5)
    expect(toWorld(anchor, next, view).x).toBeCloseTo(original.x, 12)
    expect(toWorld(anchor, next, view).y).toBeCloseTo(original.y, 12)
    const madrid = project(-3.7038, 40.4168)
    const screen = toScreen(madrid, next, view)
    expect(toWorld(screen, next, view).x).toBeCloseTo(madrid.x, 12)
    expect(toWorld(screen, next, view).y).toBeCloseTo(madrid.y, 12)
    expect(start).toEqual(fitTheatre(view))
  })
  it('bounds extreme pan at max zoom, maintaining a finite camera', () => {
    const view = { width: 1920, height: 920 }
    const moved = panBy(fitSpain(view), view, { x: 1e9, y: -1e9 })
    expect(moved.center.x).toBeGreaterThanOrEqual(project(THEATRE.west, 0).x - 1e-12)
    expect(moved.center.y).toBeLessThanOrEqual(project(0, THEATRE.south).y + 1e-12)
    expect(moved.scale).toBe(limits(view).max)
  })
  it('selects only valid bounded XYZ tile coordinates and caps density at DPR 2', () => {
    const view = { width: 2560, height: 1280 }, camera = fitSpain(view)
    const tiles = visibleTiles(camera, view, 2)
    expect(tiles).toEqual(visibleTiles(camera, view, 4))
    expect(tiles.length).toBeLessThanOrEqual(64)
    expect(new Set(tiles.map(t => t.key)).size).toBe(tiles.length)
    for (const t of tiles) { expect(t.z).toBeLessThanOrEqual(8); expect(t.x).toBeGreaterThanOrEqual(0); expect(t.y).toBeGreaterThanOrEqual(0); expect(t.x).toBeLessThan(2 ** t.z); expect(t.y).toBeLessThan(2 ** t.z) }
  })
  it('retains 138 named objectives with the approved Portugal and Spain rosters', () => {
    expect(geography.cities).toHaveLength(138)
    expect(geography.cities.filter(c => c.country === 'Portugal').map(c => c.name)).toEqual(['Lisbon', 'Porto'])
    expect(geography.cities.filter(c => c.country === 'Spain').map(c => c.name)).toEqual(['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao'])
    expect(geography.cities.filter(c => c.capital)).toHaveLength(47)
    expect(new Set(geography.cities.map(c => c.name)).size).toBe(138)
    for (const c of geography.cities) { expect(c.lon).toBeGreaterThanOrEqual(-25); expect(c.lon).toBeLessThanOrEqual(60); expect(c.lat).toBeGreaterThanOrEqual(25); expect(c.lat).toBeLessThanOrEqual(72) }
  })
})
