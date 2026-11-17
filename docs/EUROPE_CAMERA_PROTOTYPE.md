# Europe camera prototype

## Scope and architecture

Owner-started on 2026-11-17, based on main
`905ee35dc67e271fb64b613f0be83257b7c169fb`. This slice is a standalone,
development-only display fixture. It does not read or write match state, call
authentication/game APIs, generate worlds, send movement orders, implement
defense-line effects or alter server contracts. Repeating-turn work in #105 and
the unmerged `feat/europe-surface-navigation` foundation remain separate.

The existing React/Vite client owns the HUD. Canvas2D draws raster tiles and SVG
draws independent national outlines; HTML city markers remain fixed-size. This
fixture tests display-camera behavior without replacing the production map
renderer or committing to a Canvas renderer migration. The target production
renderer remains PixiJS. The pure camera module can be consumed by that renderer.

## Run without a backend

In a checkout of `feat/europe-camera-prototype` with the normal frozen workspace
dependencies installed, run only:

```powershell
pnpm --filter @strategy-game/web dev
```

Open `http://127.0.0.1:5173/?prototype=europe-map` (use Vite's printed port if it
differs). This command starts only Vite. Do not use the root preparation/server
commands to inspect this fixture. The query entry is explicitly gated by
`import.meta.env.DEV`; standard production builds remove its code, geography and
overview image. Ordinary development URLs still render the existing application.

Drag to pan; scroll to zoom around the cursor; use +/−, Europe overview and
Spain maximum-zoom controls. Focus the map for arrow-key pan and +/−. Tab moves
normally into the city selector and controls. Ctrl+wheel remains browser zoom.
The selector provides keyboard access to every city, including offscreen and
overlapping markers. Mouse/trackpad scrolling is the tested desktop interaction;
touch pinch and actual screen-reader speech are not accepted by these checks.

## Continuous camera contract

Normalized Web Mercator coordinates describe display positions only. They are
not the integer coordinate system in existing match snapshots. Runtime Europe
integration needs its own version-pinned projection/conversion contract; never
submit normalized display coordinates directly as game movement orders.

- Theatre framing: 25W–60E, 25N–72N, including Europe and parts of North Africa
  and the Middle East. Pan constrains the camera center to those extents; nearby
  context may remain visible outside them.
- Minimum scale fits the complete theatre with a small margin.
- Maximum scale is `viewportCssWidth / ((12.9 / 360) * 1.08)`, using mainland
  Spain's approximate 9.5W–3.4E width. Spain therefore occupies about 92.6% of the
  map width at the cap. North/south cropping is intentional at wide aspect ratios:
  this is a width-based cap, not a requirement to fit all Spain vertically.
- Cap and marker size use CSS pixels, independently of device-pixel ratio.
  Resize preserves the relative zoom level and clamps the camera again.
- Zoom computes the world position under the cursor and adjusts the camera
  center to retain that anchor, subject to theatre bounds. Buttons and wheel
  ease continuously through the same camera; no regional-view switch occurs.
- City points never move in geographic space. Marker targets remain 44 CSS
  pixels, labels retain their font size and overlapping labels are omitted.
  The city selector retains every proposed objective. Future defense-line handles
  should follow the same separation, but there is no line editor in this slice.
- Reduced-motion preference removes easing. Camera controls never resolve orders.

## Imagery, cache and provenance

The camera prototype uses NASA Blue Marble Next Generation historical imagery,
not a live feed. It currently streams the nominal 500m GIBS layer; the previously
approved ESA 10m Lyon sample remains an archived imagery-quality reference. The
full ESA 10m regional tile set has **not** been prepared or shipped. A Spain-wide
camera cap does not require street/building resolution or an increase in zoom
when higher-resolution source imagery is later connected.

- [NASA source and nominal resolution](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/).
- [GIBS access documentation](https://nasa-gibs.github.io/gibs-api-docs/access-basics/).
- [Verified EPSG:3857 capabilities](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml).
- Tile template:
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`.
  Verified JPEG tiles are 256×256 pixels, public CORS, no credential or paid key.
- [Bundled July 2004 overview source](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg).
  Its native preview is 5400×2700 (approximately 8km at the equator), not 500m.
  Crop/reproject 25W–60E / 25N–72N into an 1800×1600 Mercator display with nearest
  resampling and JPEG quality 85. The 401,912-byte output is an offline/loading
  fallback, not additional native detail. No terrain colors imply combat effects.

Only visible tiles are requested. The selected source level uses CSS scale and
DPR capped at 2, with a source level cap of 8. If coverage would exceed 64 tiles,
use a coarser source level. Decode into a 64-entry LRU cache (about 16MiB of RGBA
tile pixels, excluding canvas, overview, networking and other browser memory).
Cached ancestors provide temporary detail while finer children load; otherwise
the bundled overview remains visible. Obsolete requests are aborted. Eviction
and teardown close decoded bitmaps; late responses are released. Each request
has a 15-second timeout. Failed keys have bounded bookkeeping and require the
explicit Retry imagery action rather than an automatic retry loop. Public service
availability and production hosting/caching remain separate operational work.

National outlines and city coordinates derive from Natural Earth, whose vector
data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/).
Downloaded on 2026-11-17:

| Dataset | Source commit |
| --- | --- |
| [1:50m national outlines](https://github.com/nvkelso/natural-earth-vector/blob/9380cca83db5f9aef52d5e762765100745f84b27/geojson/ne_50m_admin_0_countries.geojson) | `9380cca83db5f9aef52d5e762765100745f84b27` |
| [Populated places](https://github.com/nvkelso/natural-earth-vector/blob/789c9904087846cc3361302857aa2e76b0ae71ff/geojson/ne_10m_populated_places_simple.geojson) | `789c9904087846cc3361302857aa2e76b0ae71ff` |

The fixture retains 56 national/context outline entries, removes remote polygons
outside surrounding-theatre context and rounds source coordinates to five decimal
places. These are cartographic outlines, not a validated surface-navigation mask,
survey boundaries or new political claims. No artificial country sectors exist.
The proposed roster has 138 cities across 47 country/seat entries; first entry is
the designated capital/seat. Portugal has Lisbon and Porto. Spain has Madrid,
Barcelona, Valencia, Seville and Bilbao. English aliases map to source place names;
Niksic uses the explicit approximate point 18.9445E / 42.7731N. City count is a
prototype design proposal rather than an automated area formula or balance rule.

Original Global Crown emblem and approved gold/navy/charcoal/silver palette are
retained. Web text uses system UI / Georgia. Figma uses documented Noto Sans /
Source Serif 4 substitutes and existing local city/button components.

## Figma

[Current Spain-wide maximum view](https://www.figma.com/design/f46G90QDpLvSNBMWSVQ89L?node-id=32-1905)
replaces the Lyon closeup on the current board. Lyon is preserved on the archive
page, explicitly beyond the gameplay camera cap. The maximum view has editable
country vectors, city component instances, text, HUD and controls; the terrain
and original wordmark are the only raster content. The four-page current /
components / specification / archive organization is preserved. Static Figma
controls illustrate the target; the browser fixture implements the camera.

## Verification and delivery state

With lockfile-pinned temporary dependencies and no package/lockfile changes:

- TypeScript 6.0.3 shared-types build and full web `tsc -b`: passed.
- Standard web Vite 8.3.6 production build with the existing config/plugin: passed.
  Its output contains no Europe prototype chunk, geography or overview asset.
- Full web ESLint 10.14.0 run: passed.
- Vitest 4.1.12: all 222 web tests in nine files passed, including 11 camera/cache
  cases. Camera checks cover responsive width caps, cursor anchor, projection
  round trips, bounds, tile budgets and approved rosters. Cache checks cover LRU,
  abort/late-release/disposal, bounded failures and explicit retry.
- Headless installed Chrome with static Vite-generated assets, no application
  backend/database: checked 1920×1080, 1366×768, 2560×1440 and 390×844. Spain spans
  approximately 92.6% of the viewport width, markers remain 44px, no page horizontal
  overflow, city selection works, Tab leaves the map for the selector, and no page
  errors occurred. Native wheel zoom around Madrid drifted less than 0.3 CSS px
  after settling. A separate DPR 2 / reduced-motion browser check reached the same 100% cap,
  rendered a 3840px bitmap at 1920 CSS pixels, and made zero auth/game API requests.
  Unit tests also exercise DPR >2 clamping.
- Forced imagery 503s: bundled terrain remained visible; error status appeared;
  settled requests did not retry automatically and explicit retry sent requests.
- Managed shell loopback was unavailable. Chrome local assets were delivered by
  Playwright route fulfillment; real NASA tile responses were fetched and passed
  through the same browser fetch/decode/cache path. This is a browser fixture
  check, not an end-to-end hosted service or screen-reader acceptance claim.

Implementation correction history: **3/5** bounded passes: (1) fixed overview
anchor clamping and adaptive tile coverage after two camera tests failed; (2)
replaced constructor parameter properties to meet erasableSyntaxOnly; (3)
initialized React state/refs independently to satisfy the existing ref lint rule.
Old shared-types build output in temporary tooling was rebuilt from this base;
tooling/import/setup failures were not source fixes. Existing task histories remain
unchanged. Author review is not independent review.

This is a feature-branch candidate, unmerged. No PR/hosted CI, merge, deployment,
existing database, migration, backend startup, gameplay change or new dependency
was used. Next: accept the desktop camera feel, prepare the regional imagery
delivery layer, then build world-coordinate defense drafts and wire a separately
validated Europe surface mask into a new server-owned runtime profile.
