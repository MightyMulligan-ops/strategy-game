/** Geographic surface checks. Never derive these masks from rendered imagery. */
export type SurfacePoint = Readonly<{ x: number; y: number }>;
export type SurfacePolygon = Readonly<{
  outer: readonly SurfacePoint[];
  holes?: readonly (readonly SurfacePoint[])[];
}>;
export type SurfaceMap = Readonly<{
  schemaVersion: 1 | 2;
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
type Bounds = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
type Edge = Readonly<{ a: SurfacePoint; b: SurfacePoint; index: number; bounds: Bounds }>;
type EdgeTree = Readonly<{ bounds: Bounds; items: readonly Edge[] }> | Readonly<{ bounds: Bounds; left: EdgeTree; right: EdgeTree }>;
type RingData = Readonly<{ edges: Edge[]; bounds: Bounds; tree: EdgeTree }>;
const ringCache = new WeakMap<Ring, RingData>();
const overlaps = (a: Bounds, b: Bounds) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
function edgeTree(items: readonly Edge[]): EdgeTree {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) { minX = Math.min(minX, item.bounds.minX); minY = Math.min(minY, item.bounds.minY); maxX = Math.max(maxX, item.bounds.maxX); maxY = Math.max(maxY, item.bounds.maxY); }
  const bounds = { minX, minY, maxX, maxY };
  if (items.length <= 8) return { bounds, items };
  const xAxis = maxX - minX >= maxY - minY;
  const sorted = [...items].sort((a, b) => (xAxis ? a.bounds.minX + a.bounds.maxX - b.bounds.minX - b.bounds.maxX : a.bounds.minY + a.bounds.maxY - b.bounds.minY - b.bounds.maxY) || a.index - b.index);
  const middle = Math.floor(sorted.length / 2);
  return { bounds, left: edgeTree(sorted.slice(0, middle)), right: edgeTree(sorted.slice(middle)) };
}
function someEdge(tree: EdgeTree, bounds: Bounds, predicate: (edge: Edge) => boolean): boolean {
  if (!overlaps(tree.bounds, bounds)) return false;
  return 'items' in tree ? tree.items.some(e => overlaps(e.bounds, bounds) && predicate(e)) : someEdge(tree.left, bounds, predicate) || someEdge(tree.right, bounds, predicate);
}
function ringData(ring: Ring): RingData {
  const cached = ringCache.get(ring);
  if (cached) return cached;
  const items = ring.map((a, index) => { const b = ring[(index + 1) % ring.length]!; return { a, b, index, bounds: { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) } }; });
  const tree = edgeTree(items), result = { edges: items, bounds: tree.bounds, tree };
  ringCache.set(ring, result);
  return result;
}
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
  return ringData(ring).edges;
}
const cross = (a: SurfacePoint, b: SurfacePoint, p: SurfacePoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function onSegment(p: SurfacePoint, a: SurfacePoint, b: SurfacePoint) {
  // Coordinates are bounded integers at the boundary; intersections are doubles internally.
  const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs((b.x - a.x) * (p.y - a.y)), Math.abs((b.y - a.y) * (p.x - a.x)));
  return Math.abs(cross(a, b, p)) <= tolerance && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}
function inRing(p: SurfacePoint, ring: Ring): "INSIDE" | "OUTSIDE" | "BOUNDARY" {
  const data = ringData(ring);
  if (p.x < data.bounds.minX || p.x > data.bounds.maxX || p.y < data.bounds.minY || p.y > data.bounds.maxY) return 'OUTSIDE';
  let inside = false;
  for (const { a, b } of data.edges) {
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
    const current = segments[i]!;
    if (someEdge(ringData(ring).tree, current.bounds, other => other.index > i && other.index !== i + 1 && !(i === 0 && other.index === segments.length - 1) && contactParameters(current.a, current.b, other.a, other.b).length > 0)) return fail();
  }
  return Object.freeze(ring);
}
function ringsTouch(a: Ring, b: Ring) {
  const first = ringData(a), second = ringData(b);
  if (!overlaps(first.bounds, second.bounds)) return false;
  const [smaller, larger] = first.edges.length <= second.edges.length ? [first, second] : [second, first];
  return smaller.edges.some(x => someEdge(larger.tree, x.bounds, y => contactParameters(x.a, x.b, y.a, y.b).length > 0));
}
/** Schema 2 admits isolated point contacts, never shared edges or overlapping interiors. */
function boundaryEnters(a: PreparedPolygon, b: PreparedPolygon): boolean {
  return [a.outer, ...a.holes].some(ring => edges(ring).some(edge => {
    const breaks = [0, 1];
    for (const other of [b.outer, ...b.holes]) {
      if (someEdge(ringData(other).tree, edge.bounds, candidate => {
        const contacts = contactParameters(edge.a, edge.b, candidate.a, candidate.b);
        if (contacts.length === 2 && contacts[0] !== contacts[1]) return true;
        breaks.push(...contacts);
        return false;
      })) return true;
    }
    const ordered = [...new Set(breaks)].sort((x, y) => x - y);
    const inside = (t: number) => inPolygon({ x: edge.a.x + (edge.b.x - edge.a.x) * t, y: edge.a.y + (edge.b.y - edge.a.y) * t }, b) === "INSIDE";
    return ordered.some((t, i) => inside(t) || (i + 1 < ordered.length && inside((t + ordered[i + 1]!) / 2)));
  }));
}
function readPolygons(v: unknown, width: number, height: number, allowPointContacts: boolean): readonly PreparedPolygon[] {
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
  // Shared national seams must be dissolved. Schema 2 preserves isolated physical
  // point contacts, but those points remain impassable coast in route validation.
  for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
    const a = polygons[i]!, b = polygons[j]!;
    if (!overlaps(ringData(a.outer).bounds, ringData(b.outer).bounds)) continue;
    if (inPolygon(a.outer[0]!, b) === "INSIDE" || inPolygon(b.outer[0]!, a) === "INSIDE") return fail();
    if ([a.outer, ...a.holes].some((x) => [b.outer, ...b.holes].some((y) => ringsTouch(x, y))) &&
        (!allowPointContacts || boundaryEnters(a, b) || boundaryEnters(b, a))) return fail();
  }
  return Object.freeze(polygons);
}

/** Prepare once from a trusted, version-pinned server mask. No save/turn mutation. */
export function prepareSurfaceNavigation(input: unknown) {
  if (!record(input)) return fail();
  keys(input, ["schemaVersion", "maskId", "bounds", "land", "inlandWater"]);
  if ((input.schemaVersion !== 1 && input.schemaVersion !== 2) || typeof input.maskId !== "string" || input.maskId.trim() !== input.maskId || input.maskId.length < 1 || input.maskId.length > 128 || !record(input.bounds)) return fail();
  keys(input.bounds, ["width", "height"]);
  const width = input.bounds.width, height = input.bounds.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || (width as number) <= 0 || (height as number) <= 0 || (width as number) > 1_000_000 || (height as number) > 1_000_000) return fail();
  const land = readPolygons(input.land, width as number, height as number, input.schemaVersion === 2);
  const water = readPolygons(input.inlandWater, width as number, height as number, input.schemaVersion === 2);
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
