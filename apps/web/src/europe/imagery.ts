import { tileUrl } from './camera'

// Covers large desktop/retina views without dropping below the ESA service's z8 minimum.
export const IMAGERY_TILE_BUDGET = 96
export const IMAGERY_CREDIT = '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium · NASA Blue Marble · Natural Earth'
export const IMAGERY_LICENSE_URL = 'https://esa-worldcover.org/en/data-access'

function parseKey(key: string) {
  const match = /^([0-8])\/(\d+)\/(\d+)$/.exec(key)
  if (!match) throw new Error('Invalid imagery tile key')
  const z = Number(match[1]), y = Number(match[2]), x = Number(match[3])
  if (x >= 2 ** z || y >= 2 ** z) throw new Error('Imagery tile outside matrix')
  return { z, y, x }
}

export function regionalTileUrl(key: string): string | null {
  const { z, y, x } = parseKey(key)
  if (z < 8) return null
  // Use the working KVP endpoint; the advertised REST template rejects missing WMTS parameters.
  const parameters = new URLSearchParams({
    SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0',
    LAYER: 'esa-worldcover-s2rgbnir-10m-2021-v2_tcc', STYLE: 'default',
    TILEMATRIXSET: 'EPSG:3857', TILEMATRIX: String(z), TILECOL: String(x), TILEROW: String(y),
    FORMAT: 'image/png', TIME: '2021-01-01',
  })
  return `https://wmts.terrascope.be/service?${parameters}`
}

export type ImageryTile<T> = { base: T | null; regional: T | null; degraded: boolean }
export type ReleasableImage = { close(): void }

async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal, credentials: 'omit' })
  if (!response.ok) throw new Error('Satellite tile unavailable')
  return createImageBitmap(await response.blob())
}

export function loadImageryTile(key: string, signal: AbortSignal): Promise<ImageryTile<ImageBitmap>> {
  return loadImageryTileWith(key, signal, fetchBitmap)
}

export async function loadImageryTileWith<T extends ReleasableImage>(
  key: string, signal: AbortSignal,
  loadImage: (url: string, signal: AbortSignal) => Promise<T>,
): Promise<ImageryTile<T>> {
  signal.throwIfAborted()
  const regionalUrl = regionalTileUrl(key)
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)])
  const [base, regional] = await Promise.all([
    loadImage(tileUrl(key), requestSignal).catch(() => null),
    regionalUrl ? loadImage(regionalUrl, requestSignal).catch(() => null) : Promise.resolve(null),
  ])
  // A decoder may complete after cancellation. Never cache or leak that result.
  if (requestSignal.aborted) {
    base?.close(); regional?.close()
    requestSignal.throwIfAborted()
  }
  if (!base && !regional) throw new Error('Satellite tile unavailable')
  return { base, regional, degraded: !base || Boolean(regionalUrl && !regional) }
}

export function releaseImageryTile<T extends ReleasableImage>(tile: ImageryTile<T>) {
  tile.base?.close(); tile.regional?.close()
}
