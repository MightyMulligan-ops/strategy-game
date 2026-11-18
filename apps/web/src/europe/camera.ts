export type Point = { x: number; y: number }
export type Viewport = { width: number; height: number }
export type Camera = { center: Point; scale: number }
export const THEATRE = { west: -25, east: 60, south: 25, north: 72 }
export const SPAIN = { west: -9.5, east: 3.4, south: 35.8, north: 43.8 }

// Normalized Web Mercator is a display coordinate system, never a match position.
export function project(lon: number, lat: number): Point {
  const phi = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180
  return { x: (lon + 180) / 360, y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 }
}
const nw = project(THEATRE.west, THEATRE.north)
const se = project(THEATRE.east, THEATRE.south)
export function limits(view: Viewport) {
  const min = Math.min(view.width / (se.x - nw.x), view.height / (se.y - nw.y)) * 0.96
  // CSS width, independent of device-pixel ratio: most of mainland Spain spans the map.
  return { min, max: Math.max(min, view.width / ((SPAIN.east - SPAIN.west) / 360 * 1.08)) }
}
export function clampCamera(camera: Camera, view: Viewport): Camera {
  const { min, max } = limits(view)
  const scale = Math.max(min, Math.min(max, camera.scale))
  const constrain = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v))
  return { scale, center: {
    x: constrain(camera.center.x, nw.x, se.x),
    y: constrain(camera.center.y, nw.y, se.y),
  } }
}
export function fitTheatre(view: Viewport): Camera {
  return { center: { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 }, scale: limits(view).min }
}
export function fitSpain(view: Viewport): Camera {
  return clampCamera({ center: project((SPAIN.west + SPAIN.east) / 2, 40), scale: limits(view).max }, view)
}
export function toScreen(point: Point, camera: Camera, view: Viewport): Point {
  return { x: (point.x - camera.center.x) * camera.scale + view.width / 2,
    y: (point.y - camera.center.y) * camera.scale + view.height / 2 }
}
export function toWorld(point: Point, camera: Camera, view: Viewport): Point {
  return { x: (point.x - view.width / 2) / camera.scale + camera.center.x,
    y: (point.y - view.height / 2) / camera.scale + camera.center.y }
}
export function zoomAt(camera: Camera, view: Viewport, anchor: Point, factor: number): Camera {
  const world = toWorld(anchor, camera, view)
  const { min, max } = limits(view)
  const scale = Math.max(min, Math.min(max, camera.scale * factor))
  return clampCamera({ scale, center: {
    x: world.x - (anchor.x - view.width / 2) / scale,
    y: world.y - (anchor.y - view.height / 2) / scale,
  } }, view)
}
export function panBy(camera: Camera, view: Viewport, delta: Point): Camera {
  return clampCamera({ ...camera, center: { x: camera.center.x - delta.x / camera.scale,
    y: camera.center.y - delta.y / camera.scale } }, view)
}
export type Tile = { key: string; z: number; x: number; y: number }
export function visibleTiles(camera: Camera, view: Viewport, dpr = 1, budget = 64): Tile[] {
  let z = Math.max(0, Math.min(8, Math.ceil(Math.log2(camera.scale * Math.min(2, dpr) / 256))))
  let n = 2 ** z
  const a = toWorld({ x: 0, y: 0 }, camera, view)
  const b = toWorld({ x: view.width, y: view.height }, camera, view)
  // Fall back one source level on large/high-density displays rather than starving visible tiles.
  while (z > 0 && (Math.floor(b.x * n) - Math.floor(a.x * n) + 1) * (Math.floor(b.y * n) - Math.floor(a.y * n) + 1) > budget) { z--; n = 2 ** z }
  const tiles: Tile[] = []
  for (let y = Math.max(0, Math.floor(a.y * n)); y <= Math.min(n - 1, Math.floor(b.y * n)); y++) {
    for (let x = Math.max(0, Math.floor(a.x * n)); x <= Math.min(n - 1, Math.floor(b.x * n)); x++) {
      tiles.push({ key: `${z}/${y}/${x}`, z, x, y })
    }
  }
  return tiles
}
export const tileUrl = (key: string) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/${key}.jpeg`
