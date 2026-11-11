# Procedural territory world foundation (005B.1 / Issue #20)

Parent [Issue #19](https://github.com/MightyMulligan-ops/strategy-game/issues/19) remains the complete 005B milestone. The owner approved these review phases:

1. **005B.1:** world specification, pure deterministic generator, contracts and tests (this change).
2. **005B.2:** additive persistence, atomic start initialization, participant-only API and minimal read-only map.
3. **005B.3:** explicitly invoked legacy initialization and acceptance hardening.

Phase 1 is merged in PR #21 (`e3e4a22`). The approved phase-2 integration is described in [INITIAL_WORLD.md](INITIAL_WORLD.md); the generator/output contract remain unchanged. Its public-safe geometry primitives are now shared separately from authoritative schemas. Phase 3 still requires separate authorization. Existing RUNNING lobbies remain valid without worlds; nothing initializes them on read.

## Boundaries and invocation

`packages/game-engine/src/world-generation.ts` exports `generateWorld(input)` through the existing server-only engine barrel. Its validated contracts live in `packages/shared-types/src/world.ts`, exported **only** by `@strategy-game/shared-types/server`. They are authoritative data, not a client DTO. No new dependency or package is needed. Existing strict `GameSnapshot` and `empty-turn-v1` resolution contracts remain unchanged; this world must not be fed to the empty-turn resolver or silently appended to its snapshot.

```ts
import { generateWorld } from "@strategy-game/game-engine";

const result = generateWorld({
  schemaVersion: 1,
  generatorVersion: "territory-grid-v1",
  seed: 42,
  players: ["match-local-player-a", "match-local-player-b"],
  settings: { regionSide: 5 }
});
// result.ok: true -> result.world; false -> result.error.code
```

The generator performs no I/O. Phase 005B.2 calls it from authoritative start orchestration using server-selected seeds and match-local IDs; accepting inputs here is not authentication or authorization. The world API uses a separate permitted projection and active-participant authorization; it never broadcasts this object or its seed. Adjacency is geometric metadata, **not** a movement rule. Geographic unit positions and ownership stay separate concepts.

## Contract and limits

All objects reject unknown fields, including unsupported gameplay data. Validated records, polygons and arrays are copied and frozen without mutating caller-owned input. Required fields are explicit; missing settings/seed/version do not receive ambient defaults.

| Field | Version-1 rule |
|---|---|
| `schemaVersion` | Numeric literal 1; independent of the generator algorithm version |
| `generatorVersion` | Exactly `territory-grid-v1`; no fallback for another version |
| `seed` | Unsigned 32-bit integer 0–4,294,967,295, JSON number; no string/fraction/coercion |
| `players` | 2–40 distinct nonempty, trimmed match-local player ID strings, max 128 characters; input order has no significance |
| `settings.regionSide` | Exactly 3, 5 or 7 territories along each side of a map region |
| Terrain | `PLAINS`, `FOREST`, `HILLS`; descriptive only, with no movement/combat/economy modifiers |
| Geometry | Axis-aligned four-vertex rectangles, integer map-space coordinates; no duplicated closing vertex |
| World bounds | Width ≤4,900, height ≤4,200; at most 2,058 territories and 4,025 undirected links |

Let `P` be roster size, `C` the smallest positive integer with `C² ≥ P`, `R = ceil(P/C)`, and `S = regionSide`. The board has `C*S` columns and `R*S` rows, bounding width `100*C*S` and height `100*R*S`. Territory count is `C*R*S²`. The remaining `C*R-P` map regions have no assigned player; their territories remain neutral. A region is a layout/allocation concept, not a country or territory ownership record.

| Players | Regions (columns × rows) | Territories at S=3 / 5 / 7 |
|---|---|---|
| 2 | 2 × 1 | 18 / 50 / 98 |
| 4 | 2 × 2 | 36 / 100 / 196 |
| 10 | 4 × 3 | 108 / 300 / 588 |
| 40 | 7 × 6 | 378 / 1,050 / 2,058 |

The shape stays roughly square (2:1 for two players). It is not a natural-continent or realistic-world generator. Arbitrary territory counts, water/coastlines, irregular polygons, eras, countries, custom scenarios and map editing are future designs rather than permissive version-1 fields.

## Exact reproducibility algorithm

1. Validate input and copy/sort player IDs using code-unit ordering (`a < b`), never locale-dependent ordering. Seed the local uint32 stream directly from the explicit seed, including zero.
2. Each draw advances `state = (imul(state, 1664525) + 1013904223) >>> 0`. To sample a span, reject values ≥`floor(2^32/span)*span`, then use `state % span`. This is a reproducible LCG, not cryptographic randomness.
3. Consume `S-1` draws of span 41 for local x offsets, followed by `S-1` for y, each minus 20. Region boundary offset is zero. Repeat these local offsets across all regions. Grid line `i` is `100*i + offset[i % S]`. Consecutive lines stay 60–140 map units apart, and neighboring cells share the exact same endpoints.
4. Consume `S²` draws of span 3, row-major, indexing `[PLAINS, FOREST, HILLS]`. Force the center cell to PLAINS after those draws. Repeat this terrain motif in every region; no extra draw occurs for the override.
5. Enumerate region slots row-major. Fisher–Yates shuffle from the last slot down to index 1, consuming one accepted span `index+1` sample at each step. Assign sorted players to the first P shuffled slots. Thus incoming roster order cannot choose positions; unused slots are also shuffled.
6. Emit territories row-major, with IDs `t-row-column`, polygon vertices top-left, top-right, bottom-right, bottom-left. Coordinates increase right/down, so this order is visually clockwise. Centers use `floor((min+max)/2)` and lie strictly inside each cell. Emit right/down side-sharing edges once, normalize each pair by code-unit ID order and sort links by `(a,b)`. Diagonal corner contact creates no link.
7. Assign each player the center cell of their region. Emit starts/cities/nodes in sorted-player order; IDs `city-index` and `supply-index` are world-scoped, not globally unique. Emit one ownership record per territory in row-major order, with only capitals owned. Validate the complete output before returning it.

All generation arithmetic is bounded integer arithmetic; no trigonometry, wall clock, `Math.random`, environment, network, database or file access affects it. For the same seed, roster, settings and algorithm version, serialized output (including IDs and array order) is identical. Fixed SHA-256 output fingerprints for 2/4/10/40 players pin this behavior in tests on local Windows and CI Linux. Hashes are test compatibility fixtures, not authentication or signatures.

Changes to geometry, PRNG/draw order, terrain probabilities, allocation, IDs, starting fixtures or output ordering require a **new generator version** and retained old replay behavior when replay/persistence becomes supported. Contract shape changes also need explicit schema-version review. No historical world is regenerated here because none is persisted in this phase.

## Starting-state definitions and guarantees

Geometry contains no owner or units. `startingState` separately defines:

- `starts`: exactly one `(playerId, capitalTerritoryId)` per roster player.
- `ownership`: exactly one `(territoryId, ownerPlayerId|null)` for every territory. Only each player's capital starts owned; all other territories are neutral.
- `cities`: one `CAPITAL` city per player, at the capital's map-space center. Each city references its territory and owner.
- `resourceNodes`: one `MILITARY_SUPPLIES` node per capital city at the same position, initially **zero** stockpile. This is a minimal fixture, not an approved starting-resource balance rule. No population, production, storage capacity, transfer, allocation or consumption behavior exists.
- `units`: required empty array. Nonempty armies are rejected, not silently ignored. Unit/leader composition, geographic positions and permanent original-spawn references require later approved contracts; no speculative combat stats or recruitment rules are introduced.

For every supported roster, seed and regionSide, each start has an identical capital area and PLAINS terrain, four immediate neighbors with the same terrain multiset, one owned territory, one city and one empty supply node. All territory interiors are disjoint and cover the bounds. Side-sharing adjacency is connected, undirected, duplicate-free and has no isolated territory. Capitals are distinct and separated by at least S graph edges and 100*S map units; each lies inside its region, never on the map boundary. Every other capital is reachable in the metadata graph.

These are **local starting guarantees**. Repeated motifs deliberately trade natural variation for exact initial equality and straightforward verification. Outer-edge exposure, centrality, distance to every opponent, unused neutral-region placement, player skill and eventual gameplay balance are not equalized. No strategic balance, 40-player runtime capacity or terrain passability claim follows from these tests.

Structural schemas validate bounds/rectangles/centers, complete grid adjacency, uniqueness/references and starting ownership/city/node consistency. They do not prove a supplied world came from its claimed seed or trusted code. The generator plus independent reproducibility, geometry, BFS and fairness tests establish its generation guarantees.

## Failures, verification and later work

Return values are a frozen discriminated result, never a partial world:

| Result | Meaning |
|---|---|
| `ok: true, world` | Validated, readonly generated data |
| `ok: false, error: {schemaVersion: 1, code: INVALID_INPUT}` | Invalid seed/roster/settings/schema version or unknown field |
| `... UNSUPPORTED_GENERATOR_VERSION` | An explicitly supplied string algorithm version is unsupported; no fallback |
| `... GENERATION_FAILED` | Internal generation/output-validation failure; no raw exception details exposed |

No unbounded layout-search/retry loop exists. The sampling loop only rejects the incomplete uint32 remainder; output size and all layout passes are bounded by validated settings. No seed is implicitly selected, no error is automatically retried, and no world is committed or match changed.

Local verification uses `RUN_DATABASE_TESTS=0`, frozen install, build, TypeScript, unit tests and frontend lint. Focused tests are `pnpm exec vitest run packages/game-engine/tests/world-generation.test.ts`. The suite checks 2/4/10/40 players over five boundary/representative seeds and all three settings, every roster size 2–40, golden outputs, roster permutations, different seeds, full rectangle tiling/non-overlap, BFS connectivity/distances, stable edges, fixture equality, immutability, malformed inputs and corrupted references.

No local database test, preflight, development server or migration command is appropriate for this phase. Existing development/test/sandbox databases, especially port 5435, must not be accessed. Unchanged CI may run existing integration tests only against its newly provisioned disposable PostgreSQL. There is no new SQL or database rollback: reverting this unintegrated library/docs change requires no database operation.

Phase 005B.2 adds persistence-once semantics, concurrent start/rollback, explicit public projection, participant-only API and SVG inspector. Sandbox acceptance still requires separate owner approval, and phase 005B.3 owns an explicit legacy initializer. Existing RUNNING matches without worlds are never repaired on reads or host retries.
