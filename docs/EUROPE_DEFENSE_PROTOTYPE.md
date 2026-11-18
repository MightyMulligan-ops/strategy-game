# Europe defense drafts and surface previews

## Delivery boundary and provenance

Owner-started after the regional-imagery candidate. This is a new mechanic slice
based on main `2890ca9dd8b60841812a47e15a33a70dfd72ec75`, which includes the repeating
turn work. It carries the unmerged camera/imagery source from
`c1f906577dfa714a9ba457f3452645cb13afd99e` and the unchanged pure surface validator
and its 40 regression cases from `2d7f37f0282d0526e321290b246c8329cf92cf8e`.
The new branch is `feat/europe-defense-drafts`. This does not merge either earlier
candidate into main or change an existing match's runtime, orders or positions.

The delivered loop is: edit geometry in the development map, explicitly request
a surface preview, validate it in the Vite Node process with a trusted physical
mask and server-owned fixture formations, then display a versioned result only
if it still belongs to the current draft. A successful preview is not a committed
movement order or an activated defense line.

## Run

Use the repository's normal Node/pnpm versions and frozen dependencies. Build the
existing shared-types package once, then run Vite only:

```powershell
pnpm --filter @strategy-game/shared-types build
pnpm --filter @strategy-game/web dev
```

Open `http://127.0.0.1:5173/?prototype=europe-map`, using Vite's printed port if it
chooses another. Vite serves the preview endpoints itself. No application backend,
Prisma generation, migration, database, OAuth configuration or Docker is needed.
Ordinary URLs and production builds retain the normal application. The sample
formations and geometry are public fixtures, with no player/account information.

## Editing and interaction

- The initial three-point line is an uncommitted land-defense draft in Spain.
  Choose Add points and click the background to extend it. A background drag
  pans rather than accidentally adding a vertex; the drag threshold is 4 CSS px.
- Drag a numbered control point, or select it in the point selector. Handles have
  44px screen targets. Arrow keys nudge one screen pixel; Shift+arrow nudges ten.
  Delete/Backspace removes a focused point. Buttons provide the same nudge actions.
- Center point returns the camera to the selected vertex. Pan/zoom/centering and
  selection never rewrite the geometry or its revision.
- Remove point, Clear line and Undo edit work in memory. An entire pointer drag
  is one undo checkpoint; sub-quantization movement is accumulated rather than
  creating an empty checkpoint. Geometry edits increment a local revision and
  invalidate prior results. Geometry and history are bounded at 32 and 20 entries
  respectively. These are prototype work limits, not combat balance rules.
- Check defense surface validates the entire polyline as LAND. Its feedback is
  visible in the planning drawer and announced politely; accepted geometry turns
  green, rejected geometry red, and edited/unvalidated geometry gold.
- Choose Route and click waypoints for the selected sample formation. Selecting
  a formation centers it and clears the previous formation's preview. The server
  prepends its stored origin and derives LAND/NAVAL from its immutable fixture.
  L marks the Iberian division near Madrid; N marks the fleet in the Atlantic.
- The drawer scrolls, can collapse on narrow layouts, and preserves normal Tab
  navigation. Wheel input over the drawer scrolls it. Zoom is suspended during
  a handle drag; browser Ctrl+wheel remains available. The Spain-wide cap is kept.
- Drafts are session-local. Reload discards them. The prototype does not claim
  ownership, force assignments, active/inactive line effects, persistence,
  movement range/leadership checks, order acceptance or combat interception.

## Versioned coordinates and response acceptance

The fixture/profile/mask IDs are `europe-defense-preview-v1`,
`europe-mercator-fixed-v1`, and `europe-ne50m-surface-v1`. Geometry stores integer
map points, with one million units per normalized Mercator world width, offset
from the theatre's northwest corner (25W,72N). Bounds are 236111 by 221521.
Quantization is about 40m at the equator and varies with latitude; it does not
improve coastline accuracy or define an authoritative distance/range unit.
Theatre extent remains 25W–60E / 25N–72N.

The pure coordinate/schema module lives in
`packages/shared-types/src/europe-preview.ts`. It is deliberately imported by
source path only by the development fixture and its Node preview adapter. It is
not re-exported through the normal shared-types entry: Zod schema construction
there retained prototype constants in the production bundle during verification.
This isolation keeps both prototype assets and protocol out of normal web output,
without changing manifests, dependency declarations or lockfiles. A production
Europe runtime needs a separately reviewed public contract and distance policy.

Client requests contain a fixed identity, local revision, kind and geometry.
ROUTE accepts a fixture formation ID and waypoints, never a domain, origin, map,
mask upload, owner, timestamp, turn or live match ID. Strict schemas reject extra
fields, malformed values, incompatible versions and excessive waypoint counts.

Responses echo the identity, revision and kind and contain eligibility, reason
and first failing segment index. The client validates their shape/consistency and
matches revision/kind. Every edit, formation change, later check and unmount
cancels/invalidates earlier work using a generation counter. A late success or
late error cannot validate newer geometry even if transport ignores cancellation.
There is no automatic request retry. Failures leave the geometry unvalidated.

## Server boundary

`apps/web/dev/europe-preview.ts` is a Vite `apply: 'serve'` plugin. Its middleware
owns only `/__prototype/europe/session` (GET) and `/__prototype/europe/validate`
(POST). It is not registered in `apps/server` or a production preview server.

Before preparing the mask or accepting geometry, it requires a loopback remote
address and a localhost/127.0.0.1 Host. POST additionally requires an exact matching
HTTP Origin and JSON content type. Body size is bounded at 16KiB. Responses are
no-store JSON; there are no CORS credentials, session cookies or database reads.
Foreign Origin/Host/address, malformed bodies and unsupported methods fail closed.
The trusted mask is prepared lazily once per Vite process, taking about two seconds
on this host; this is not a 40-player capacity or latency guarantee.

The validator is exported only from the engine's server entry. It validates all
endpoints, boundary contacts and intervening intervals for each segment. It never
samples periodically, so a route cannot jump a narrow barrier between samples.
LAND stays on physical land. NAVAL stays in ocean. Exact boundary contact is
rejected for both; explicit inland-water polygons are blocked for both until
inland navigation/ports/embarkation policies exist. Border control, diplomacy,
leadership, range, turn closure and combat remain independent checks.

## Physical mask and accuracy

The trusted asset is separate from satellite pixels, imagery clipping and national
outlines. It uses Natural Earth's public-domain **1:50,000,000 physical land and
lake datasets**. National borders are never treated as navigation seams.

Pinned sources, input SHA-256 hashes, output hash and preprocessing metadata are in
`apps/web/dev/fixtures/europe-surface-manifest.json`. The mask's SHA-256 is
`82e3763c12caa1dfc002daba35aa378a3acb207a239434a5d30cdc8b44dd7cd9`, pinned by a
regression test. Sources and rights:

- [Physical land](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/693f11422f4e08d2da4566b854dda53eb7c39fb3/geojson/ne_50m_land.geojson)
- [Physical lakes](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ace5fed0eaf3c6c03c951e75b439ba8fffbc218e/geojson/ne_50m_lakes.geojson)
- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/)

Offline asset preparation used temporary Shapely 2.1.2 tooling, with no application
Python dependency: clip source geometry to the theatre; project to the offset
Mercator profile; dissolve physical components; topology-preserving simplify by
10 map units; quantize to integer grid 1; dissolve/clip again; remove closing and
collinear duplicates. The asset has 194 land components, 79 inland-water
components and 12,236 vertices. Both Shapely topology validation and the independent
engine input checks passed.

One 90-map-unit-squared sliver at fixed bounds [217051,6667,217071,6680] touched a
larger component at one point after quantization. It was explicitly omitted from
this coarse prototype and recorded in the manifest. It lies near the far northeast
of the theatre, outside the sample formation scenarios. Tiny islands, shorelines,
lakes, river mouths and narrow straits require geographic accuracy review before
this mask can govern real orders. Some physical water areas/rivers are absent
from this cartographic source. Satellite source resolution and coordinate
precision do not establish navigability accuracy. This asset is not accepted for
production naval chokepoints or live order validation.

## Verification

- Shared-types and engine source builds and complete test typechecks passed.
- Full web typecheck, lint and the standard production build passed. The resulting
  app bundle has none of the prototype fixture/mask IDs, preview URL prefix,
  defense control labels or regional provider code. No prototype assets are emitted.
- Final targeted tests: **857 passed in 35 files** across web, game-engine and
  shared-types. This is not a full-workspace or database-suite acceptance claim. Focused coverage includes reducer
  immutability/undo/history/bounds, camera round trips, stale responses, React
  add/nudge/delete/undo controls, stable geometry under camera changes, real
  land/ocean crossings, Lake Ladoga, country-border passage, tampered client
  domains/origins/masks, body/Origin checks and the pinned mask bytes.
- A real local Vite/HTTP smoke check loaded the fixture session, served the editor
  module, rejected land into ocean and navy into land, and rejected a foreign
  Origin with 403. This used no application backend or database.
- Figma has a new editable [defense-draft view](https://www.figma.com/design/f46G90QDpLvSNBMWSVQ89L?node-id=41-1928): independent line vector, existing handle/button component instances, editable drawer text and terrain-only raster. The overview and maximum-zoom examples remain on the current board.
- Native browser pointer/scroll, touch, sticky-feedback layout and screen-reader
  acceptance remain unverified in this restricted environment. The earlier browser
  access restriction was respected; HTTP/jsdom/Figma checks are not substituted
  for a fresh browser rendering pass. Manual checks below remain required.

New defense/surface-preview correction history: **4/5**, separate from prior
camera **5/5**, prior surface foundation **1/5**, and repeating-turn histories.
Pass 1 resolved the explicit tiny quantized sliver and a const lint issue; pass 2
retained literal protocol identities; pass 3 isolated the prototype contract to
remove it from the production bundle; pass 4 polished drag checkpoint/no-op
handling, formation/point centering and visible drawer feedback after interaction
review. An initial broad test command also discovered temporary pristine archive
copies under .cache, which lacked installed workspace links; moving that reference
copy outside the repository restored the intended suite selection without changing
or excluding any application test. Author review is not independent review.

## Manual acceptance and live integration

1. At 1920×1080, use Spain maximum zoom, then add/drag/nudge/remove/undo points.
   Pan and zoom repeatedly, center the selected point, and verify geometry stays
   stable and all targets/focus indicators remain usable. Try a canceled pointer
   drag and sub-pixel movement; one Undo should restore the entire gesture.
2. At 1366×768 and a narrow layout, expand/collapse and scroll the planning drawer.
   Check feedback visibility and camera controls; Tab must leave the map normally.
3. Preview land movement to the Atlantic and naval movement to Madrid; both must
   reject. Check an entirely ocean route, international land passage and inland
   water. Change geometry while a check is pending and verify no stale success.
4. Verify normal application/account/turn URLs and production output retain their
   existing behavior, and that the prototype never creates or changes a match.

Live activation needs a new creation-pinned Europe runtime, independently reviewed
surface accuracy and physical distance/range conversion, authoritative unit-domain
policy, and checks at acceptance, freeze and execution. Actual defense lines also
need owner/territory permissions, eligibility/manning, activation/cost/timing,
diplomatic passage and attack/interception/combat rules. These documented open
questions are not silently decided by a drawing or a surface preview. Old cohorts
must keep their original semantics. No PR/hosted CI, merge, database, migration,
server deployment, manifest/dependency or security-setting change was performed.
