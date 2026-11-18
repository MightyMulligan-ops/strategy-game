/** Geographic surface checks. Never derive these masks from rendered imagery. */
export type SurfacePoint = Readonly<{ x: number; y: number }>;
export type SurfacePolygon = Readonly<{
  outer: readonly SurfacePoint[];
  holes?: readonly (readonly SurfacePoint[])[];
}>;
export type SurfaceMap = Readonly<{
  schemaVersion: 1;
  maskId: string;
  bounds: Readonly<{ width: number; height: number }>;
  land: readonly SurfacePolygon[];
  inlandWater: readonly SurfacePolygon[];
}>;
export type MovementDomain = "LAND" | "NAVAL";
export type SurfaceKind = "LAND" | "OCEAN" | "INLAND_WATER" | "BOUNDARY" | "OUT_OF_BOUNDS";
export type SurfaceRouteResult = Readonly<{
  eligible: boolean;
  reason: "ELIGIBLE" | "LAND_REQUIRED" | "OCEAN_REQUIRED" | "INLAND_WATER_BLOCKED" | "BOUNDARY_CONTACT" | "OUT_OF_BOUNDS";
  segmentIndex: number | null;
  maskId: string;
}>;

export class SurfaceNavigationInputError extends Error {
  readonly code = "invalid_surface_navigation_input";
  constructor() { super("Invalid geographic surface map or route"); }
}

type Ring = readonly SurfacePoint[];
type Edge = Readonly<{ a: SurfacePoint; b: SurfacePoint }>;
type PreparedPolygon = Readonly<{ outer: Ring; holes: readonly Ring[] }>;
const fail = (): never => { throw new SurfaceNavigationInputError(); };
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function keys(v: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(v).some((k) => !allowed.includes(k))) fail();
}
function point(v: unknown): SurfacePoint {
  if (!record(v)) return fail();
  keys(v, ["x", "y"]);
  if (!Number.isSafeInteger(v.x) || !Number.isSafeInteger(v.y) || Math.abs(v.x as number) > 1_000_000 || Math.abs(v.y as number) > 1_000_000) return fail();
  return Object.freeze({ x: v.x as number, y: v.y as number });
}
function edges(ring: Ring): Edge[] {
  return ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length]! }));
}
const cross = (a: SurfacePoint, b: SurfacePoint, p: SurfacePoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function onSegment(p: SurfacePoint, a: SurfacePoint, b: SurfacePoint) {
  // Coordinates are bounded integers at the boundary; intersections are doubles internally.
  const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs((b.x - a.x) * (p.y - a.y)), Math.abs((b.y - a.y) * (p.x - a.x)));
  return Math.abs(cross(a, b, p)) <= tolerance && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}
function inRing(p: SurfacePoint, ring: Ring): "INSIDE" | "OUTSIDE" | "BOUNDARY" {
  let inside = false;
  for (const { a, b } of edges(ring)) {
    if (onSegment(p, a, b)) return "BOUNDARY";
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? "INSIDE" : "OUTSIDE";
}
function inPolygon(p: SurfacePoint, poly: PreparedPolygon) {
  const outer = inRing(p, poly.outer);
  if (outer !== "INSIDE") return outer;
  for (const hole of poly.holes) {
    const value = inRing(p, hole);
    if (value === "BOUNDARY") return value;
    if (value === "INSIDE") return "OUTSIDE";
  }
  return "INSIDE";
}
function unionContains(p: SurfacePoint, polys: readonly PreparedPolygon[]) {
  let boundary = false;
  for (const poly of polys) {
    const value = inPolygon(p, poly);
    if (value === "INSIDE") return value;
    boundary ||= value === "BOUNDARY";
  }
  return boundary ? "BOUNDARY" : "OUTSIDE";
}

/** All contacts, including tangent and collinear contacts; not periodic sampling. */
function contactParameters(a: SurfacePoint, b: SurfacePoint, c: SurfacePoint, d: SurfacePoint): number[] {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.min(a.x, b.x) > Math.max(c.x, d.x) || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.min(a.y, b.y) > Math.max(c.y, d.y)) return [];
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (denominator !== 0) {
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t] : [];
  }
  if (cross(a, b, c) !== 0) return [];
  const length = rx * rx + ry * ry;
  if (length === 0) return onSegment(a, c, d) ? [0] : [];
  const t1 = ((c.x - a.x) * rx + (c.y - a.y) * ry) / length;
  const t2 = ((d.x - a.x) * rx + (d.y - a.y) * ry) / length;
  const start = Math.max(0, Math.min(t1, t2)), end = Math.min(1, Math.max(t1, t2));
  return start <= end ? [start, end] : [];
}
function readRing(v: unknown, width: number, height: number): Ring {
  if (!Array.isArray(v) || v.length < 3) return fail();
  const ring = v.map(point);
  if (ring.some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height)) return fail();
  if (new Set(ring.map((p) => `${p.x},${p.y}`)).size !== ring.length) return fail();
  const segments = edges(ring);
  const area = segments.reduce((sum, { a, b }) => sum + a.x * b.y - a.y * b.x, 0);
  if (!Number.isSafeInteger(area) || area === 0) return fail();
  for (let i = 0; i < segments.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, c = ring[(i + 2) % ring.length]!;
    if (onSegment(c, a, b) || onSegment(a, b, c)) return fail();
    for (let j = i + 1; j < segments.length; j++) {
      if (j === i + 1 || (i === 0 && j === segments.length - 1)) continue;
      if (contactParameters(segments[i]!.a, segments[i]!.b, segments[j]!.a, segments[j]!.b).length) return fail();
    }
  }
  return Object.freeze(ring);
}
function ringsTouch(a: Ring, b: Ring) {
  return edges(a).some((x) => edges(b).some((y) => contactParameters(x.a, x.b, y.a, y.b).length > 0));
}
function readPolygons(v: unknown, width: number, height: number): readonly PreparedPolygon[] {
  if (!Array.isArray(v)) return fail();
  const polygons = v.map((poly: unknown) => {
    if (!record(poly)) return fail();
    keys(poly, ["outer", "holes"]);
    const outer = readRing(poly.outer, width, height);
    if (poly.holes !== undefined && !Array.isArray(poly.holes)) return fail();
    const holes = (poly.holes as unknown[] | undefined ?? []).map((h) => readRing(h, width, height));
    for (let i = 0; i < holes.length; i++) {
      if (holes[i]!.some((p) => inRing(p, outer) !== "INSIDE") || ringsTouch(outer, holes[i]!)) return fail();
      for (let j = i + 1; j < holes.length; j++) {
        if (ringsTouch(holes[i]!, holes[j]!) || inRing(holes[i]![0]!, holes[j]!) !== "OUTSIDE" || inRing(holes[j]![0]!, holes[i]!) !== "OUTSIDE") return fail();
      }
    }
    return Object.freeze({ outer, holes: Object.freeze(holes) });
  });
  // Author masks as dissolved surface areas, never touching national polygons.
  // This rejects ambiguous internal seams rather than treating a country border as a coast.
  for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
    const a = polygons[i]!, b = polygons[j]!;
    if ([a.outer, ...a.holes].some((x) => [b.outer, ...b.holes].some((y) => ringsTouch(x, y))) ||
        inPolygon(a.outer[0]!, b) === "INSIDE" || inPolygon(b.outer[0]!, a) === "INSIDE") return fail();
  }
  return Object.freeze(polygons);
}

/** Prepare once from a trusted, version-pinned server mask. No save/turn mutation. */
export function prepareSurfaceNavigation(input: unknown) {
  if (!record(input)) return fail();
  keys(input, ["schemaVersion", "maskId", "bounds", "land", "inlandWater"]);
  if (input.schemaVersion !== 1 || typeof input.maskId !== "string" || input.maskId.trim() !== input.maskId || input.maskId.length < 1 || input.maskId.length > 128 || !record(input.bounds)) return fail();
  keys(input.bounds, ["width", "height"]);
  const width = input.bounds.width, height = input.bounds.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || (width as number) <= 0 || (height as number) <= 0 || (width as number) > 1_000_000 || (height as number) > 1_000_000) return fail();
  const land = readPolygons(input.land, width as number, height as number);
  const water = readPolygons(input.inlandWater, width as number, height as number);
  const maskId = input.maskId;
  const allEdges = [...land, ...water].flatMap((p) => [p.outer, ...p.holes].flatMap(edges));
  function classify(p: SurfacePoint): SurfaceKind {
    if (p.x < 0 || p.y < 0 || p.x > (width as number) || p.y > (height as number)) return "OUT_OF_BOUNDS";
    const lake = unionContains(p, water);
    if (lake === "BOUNDARY") return "BOUNDARY";
    if (lake === "INSIDE") return "INLAND_WATER";
    const ground = unionContains(p, land);
    return ground === "BOUNDARY" ? "BOUNDARY" : ground === "INSIDE" ? "LAND" : "OCEAN";
  }
  const reasonFor = (surface: SurfaceKind, domain: MovementDomain): SurfaceRouteResult["reason"] =>
    surface === "OUT_OF_BOUNDS" ? "OUT_OF_BOUNDS" : surface === "BOUNDARY" ? "BOUNDARY_CONTACT"
      : surface === "INLAND_WATER" ? "INLAND_WATER_BLOCKED" : domain === "LAND"
        ? surface === "LAND" ? "ELIGIBLE" : "LAND_REQUIRED" : surface === "OCEAN" ? "ELIGIBLE" : "OCEAN_REQUIRED";
  return Object.freeze({
    maskId,
    classifyPoint: (value: unknown): SurfaceKind => classify(point(value)),
    validateRoute(domain: MovementDomain, value: unknown): SurfaceRouteResult {
      if (domain !== "LAND" && domain !== "NAVAL") return fail();
      if (!Array.isArray(value) || value.length < 2) return fail();
      const route = value.map(point);
      const result = (reason: SurfaceRouteResult["reason"], segmentIndex: number | null): SurfaceRouteResult => Object.freeze({ eligible: reason === "ELIGIBLE", reason, segmentIndex, maskId });
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i]!, b = route[i + 1]!;
        // Check endpoints first, then every boundary contact and every open interval.
        for (const p of [a, b]) { const reason = reasonFor(classify(p), domain); if (reason !== "ELIGIBLE") return result(reason, i); }
        const breaks = [...new Set([0, 1, ...allEdges.flatMap((e) => contactParameters(a, b, e.a, e.b))])].sort((x, y) => x - y);
        const at = (t: number): SurfacePoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        for (let j = 0; j < breaks.length; j++) {
          const reason = reasonFor(classify(at(breaks[j]!)), domain);
          if (reason !== "ELIGIBLE") return result(reason, i);
          if (j + 1 < breaks.length) {
            const middle = reasonFor(classify(at((breaks[j]! + breaks[j + 1]!) / 2)), domain);
            if (middle !== "ELIGIBLE") return result(middle, i);
          }
        }
      }
      return result("ELIGIBLE", null);
    }
  });
}
