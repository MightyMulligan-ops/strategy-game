# Europe imagery and surface-navigation prototype

## Approved direction and delivery boundary

The owner approved continuing the Europe prototype with 10m regional imagery,
division-scale geographic positioning and land/naval surface restrictions on
2026-11-17. Countries retain their source national borders. Portugal has Lisbon
and Porto; Spain has Madrid, Barcelona, Valencia, Seville and Bilbao. No artificial
country subdivisions, building-level positioning or sub-meter imagery are needed.

This first implementation slice delivers a pure engine surface-route validator,
its regression tests and an actual 10m imagery design sample. It does not activate
a new match cohort, introduce naval units to existing formation contracts, alter
old movement execution, add a production API, or implement the zoom camera or
defense-line editor. Combat integration #101 remains separate.

- [10m regional planning design](https://www.figma.com/design/f46G90QDpLvSNBMWSVQ89L?node-id=24-6679)
- [Continental satellite overview](https://www.figma.com/design/f46G90QDpLvSNBMWSVQ89L?node-id=18-5493)

## Surface-route validator

`prepareSurfaceNavigation` is exported from the server-only game-engine package.
It accepts a trusted map with numeric `schemaVersion: 1`, a nonempty `maskId`,
integer map-space bounds, dissolved land polygons and explicit inland-water
polygons. Polygon holes are supported. The mask is copied and frozen before use.
It is prepared once per immutable map/mask version, not on every player command.

The returned object exposes `classifyPoint` and `validateRoute`. A route contains
its authoritative start followed by every proposed waypoint. Its domain must be
derived by the server from the authoritative formation; a client-selected domain,
client-supplied origin or client-supplied mask grants no movement authority.

| Domain | Permitted surface | Unsupported exceptions |
| --- | --- | --- |
| `LAND` | Land interior throughout the complete route | Embarkation, amphibious movement and bridges |
| `NAVAL` | Ocean interior throughout the complete route | Inland-water navigation and port transitions |

Explicit inland-water polygons block both supported domains until navigability
rules are defined. Small rivers are not automatically barriers: only water areas
explicitly represented in the validated mask are restricted. There is no invented
river-width threshold, ship-depth rule, unit range, cost or defense modifier.
Unclassified inland navigability fails closed rather than being inferred from
the satellite image. This is an initial validator policy, not a completed naval
ruleset.

The validator checks each endpoint, every geometric boundary contact and every
open interval between contacts. It does not periodically sample a route, so a
long segment cannot skip a narrow water or land barrier. Tangency and travel on
the exact coastline are rejected for both domains. Unknown domains, malformed
maps and malformed routes throw `SurfaceNavigationInputError`. Validly shaped
out-of-bounds routes return an explicit rejection. Results include the first
invalid `segmentIndex` and the `maskId`, and never mutate positions or orders.

Mask coordinates and route inputs are safe integers bounded to magnitude
1,000,000; bounds are positive integers no larger than 1,000,000. This is a
numerical representation guard, not a distance/range rule. The scenario must
explicitly define projection, fixed-point scale, world units and precision before
runtime integration. Fractional intersection parameters are internal only.

Rings must be nondegenerate, simple and implicitly closed, without a repeated
closing point or duplicate vertices. Holes must be strictly inside their outer
ring and disjoint. Polygons within each surface layer must be disjoint and must
not touch: dissolve landmass/coastline masks offline. Passing touching national
polygons is rejected rather than misclassifying national borders as coastlines.
Keep country ownership/borders independent of these surface masks. Land and
inland-water layers may overlap; the explicit water layer takes precedence.
Validate mask provenance, completeness, topology and coastline resolution during
asset preparation. A valid polygon representation alone does not prove that a
coastline dataset is accurate enough for gameplay.

## 10m imagery sample and provenance

The prototype uses the ESA WorldCover annual Sentinel-2 RGBNIR composite for 2021,
not the categorical land-cover map and not a commercial EOX mosaic. The source
contains an annual cloud-masked median and has nominal 10m sampling. Its native
geographic pixel spacing is 0.00008333333333333333 degrees.

- [Official data, attribution and access](https://esa-worldcover.org/en/data-access)
- [Direct source COG: N45E004](https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021/N45/ESA_WorldCover_10m_2021_v200_N45E004_S2RGBNIR.tif)
- Source tile bounds: longitude 4–5E, latitude 45–46N; 12,000 × 12,000 pixels and four bands.
- Sample bounds: longitude 4.600–4.995E, latitude 45.700–45.880N, around Lyon.
- Processing: range-read only the required COG window; select RGB bands 0–2;
  clip source reflectance values to 0–3000, normalize, and apply exponent 0.8;
  resample to a Mercator display with bilinear interpolation; encode a
  2200 × 1440 JPEG at quality 92. Output dimensions do not increase source resolution.
- Attribution: **© ESA WorldCover project 2021 / Contains modified Copernicus
  Sentinel data (2021), processed by ESA WorldCover consortium.** Retain source
  links and the publisher's CC BY 4.0 attribution notice with distributed imagery.

The source COG is approximately 588MB; only a regional sample was decoded through
HTTP range reads. The Figma sample is 1,633,316 bytes. The entire continental 10m
dataset was not downloaded or bundled in this code change. Terrain, imagery,
movement masks and authoritative gameplay state remain separate data products.
Satellite colors do not confer cover, impassability or combat bonuses.

Production should retain lightweight overview imagery and load visible regional
tiles by zoom, with bounded texture caching. Do not stretch one continent-wide
image indefinitely or download the whole mosaic to each browser. Review service
terms, attribution, caching and hosting before production use; public WMS/WMTS
availability is not a service-level guarantee. Direct public COG storage worked
for this sample; the linked Terrascope WMS/WMTS endpoints returned errors during
preparation. No paid imagery, subscription or new credential was used.

## Integration sequence

1. Author and independently validate a version-pinned Europe surface mask using
   coastline and explicit lake/water polygons, separate from national outlines.
   Determine its fixed-point scale and minimum navigable detail.
2. Introduce a new opt-in map/runtime profile and authoritative unit-domain
   policy. Never silently widen the existing infantry-only formation contract or
   apply new restrictions to old snapshots and replays.
3. Use the same mask version at order acceptance, freeze/revalidation and turn
   execution. Prepend the stored formation origin and validate every queued
   segment. Preserve leadership, range, diplomacy and combat checks separately.
4. Provide a public-safe route preview/error projection. The real server remains
   authoritative; no client mask, pixels, timestamps or zoom state decide legality.
5. Implement the camera and route/defense-line draft UI. Keep exact world
   coordinates invariant under pan/zoom and keep marker/handle sizes in screen
   pixels. A defense line remains a separate geographic object; its eligibility
   and combat effects are not implemented by this surface helper.

## Verification and limitations

Pinned TypeScript 6.0.3 compiled the shared-types dependency and complete
game-engine source. The engine test typecheck passed. Vitest 4.1.12 passed all
367 engine tests across 13 files, including 40 surface-navigation cases. Coverage
includes full-route crossings, narrow barriers, holes, inland water, coastlines,
tangent contact, malformed/overlapping masks, invalid domains, multiple waypoints,
immutable inputs/results and absence of camera/image state in legality checks.

The normal frozen workspace install was attempted and failed because the shell
could not reach the registry/temporary loopback relay in this managed environment.
Targeted checks used the same lockfile-pinned dependencies retrieved into temporary
tooling; no package manifest, production dependency or committed lockfile changed.
Full workspace build/lint/database suites and hosted CI were not run. No existing
database, migration, PostgreSQL, Docker, application backend or deployment was used.

Correction history: 1/5 bounded implementation correction passes used. The first
test typecheck exposed a malformed-route parameterization that spread array rows;
wrapping each row in an object corrected both the types and actual test inputs.
Final engine build, test typecheck and all engine tests passed. Initial passing
runtime-only tests did not substitute for that correction. Self-review is not
independent review. No existing task's correction history was reset.
