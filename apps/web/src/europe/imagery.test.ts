import { describe, expect, it, vi } from 'vitest'
import { IMAGERY_TILE_BUDGET, loadImageryTileWith as loadImageryTile, regionalTileUrl, releaseImageryTile } from './imagery'
import { fitSpain, visibleTiles } from './camera'

const image = () => ({ close: vi.fn() })
describe('Sentinel regional imagery delivery', () => {
  it('uses the verified true-colour KVP layer and preserves XYZ row/column order', () => {
    const url = new URL(regionalTileUrl('8/96/125')!)
    expect(url.origin).toBe('https://wmts.terrascope.be')
    expect(url.pathname).toBe('/service')
    expect(Object.fromEntries(url.searchParams)).toEqual({ SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0',
      LAYER: 'esa-worldcover-s2rgbnir-10m-2021-v2_tcc', STYLE: 'default', TILEMATRIXSET: 'EPSG:3857',
      TILEMATRIX: '8', TILECOL: '125', TILEROW: '96', FORMAT: 'image/png', TIME: '2021-01-01' })
    expect(regionalTileUrl('7/48/62')).toBeNull()
    for (const key of ['9/0/0', '8/256/0', '8/0/256', '8/-1/0', 'https://example.com']) expect(() => regionalTileUrl(key)).toThrow()
  })
  it('retains z8 detail within the bounded desktop/retina tile budget', () => {
    for (const view of [{ width: 1366, height: 643 }, { width: 1920, height: 955 }, { width: 2560, height: 1315 }]) {
      const tiles = visibleTiles(fitSpain(view), view, 2, IMAGERY_TILE_BUDGET)
      expect(tiles.length).toBeLessThanOrEqual(IMAGERY_TILE_BUDGET)
      expect(tiles.every(t => t.z === 8)).toBe(true)
    }
  })
  it('requests NASA alone at overview levels', async () => {
    const base = image(), load = vi.fn(async (url: string) => { expect(url).toContain('gibs.earthdata.nasa.gov'); return base })
    expect(await loadImageryTile('7/48/62', new AbortController().signal, load)).toEqual({ base, regional: null, degraded: false })
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]?.[0]).toContain('gibs.earthdata.nasa.gov')
  })
  it('loads independent base and regional images and releases both', async () => {
    const base = image(), regional = image()
    const load = vi.fn(async (url: string) => url.includes('terrascope') ? regional : base)
    const tile = await loadImageryTile('8/96/125', new AbortController().signal, load)
    expect(tile).toEqual({ base, regional, degraded: false })
    releaseImageryTile(tile)
    expect(base.close).toHaveBeenCalledTimes(1); expect(regional.close).toHaveBeenCalledTimes(1)
  })
  it('retains NASA when the regional service fails and marks the result for explicit retry', async () => {
    const base = image()
    const load = vi.fn(async (url: string) => { if (url.includes('terrascope')) throw new Error('503'); return base })
    expect(await loadImageryTile('8/96/125', new AbortController().signal, load)).toEqual({ base, regional: null, degraded: true })
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('retains regional imagery when NASA fails; transparent water can show the bundled overview', async () => {
    const regional = image()
    const load = async (url: string) => { if (!url.includes('terrascope')) throw new Error('offline'); return regional }
    const tile = await loadImageryTile('8/96/125', new AbortController().signal, load)
    expect(tile).toEqual({ base: null, regional, degraded: true })
    releaseImageryTile(tile); expect(regional.close).toHaveBeenCalledTimes(1)
  })
  it('fails when neither service supplies imagery', async () => {
    await expect(loadImageryTile('8/96/125', new AbortController().signal, async () => { throw new Error('offline') })).rejects.toThrow('Satellite tile unavailable')
  })
  it('does not request pre-canceled work and releases decodes that complete after abort', async () => {
    const before = new AbortController(); before.abort()
    const never = vi.fn(async () => image())
    await expect(loadImageryTile('8/96/125', before.signal, never)).rejects.toThrow()
    expect(never).not.toHaveBeenCalled()
    const during = new AbortController(), base = image(), regional = image()
    const load = async (url: string) => { during.abort(); return url.includes('terrascope') ? regional : base }
    await expect(loadImageryTile('8/96/125', during.signal, load)).rejects.toThrow()
    expect(base.close).toHaveBeenCalledTimes(1); expect(regional.close).toHaveBeenCalledTimes(1)
  })
})
