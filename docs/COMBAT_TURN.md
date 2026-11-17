# Combat 1B Stage B — frozen integration contract (Issue #101)

This owner-started task begins at cefad2e50b175a957cbc168a432e19815ce1a3dc.
Issue body + newline SHA256:33368d0c5c0b7ac8d2bc048e677dd93ae67f748e99671167838785c1a570064a.
The active owner request covers implementation, additive offline SQL authorship,
subscription checks, one PR, unchanged hosted fresh disposable PostgreSQL CI and
self/coordinator review and merge after required checks. Independent review was
explicitly waived. This is not standing permission for other issues or deployment.

## Contract frozen before implementation

New creation pin: ruleset combat-turn/1, simulation combat-turn-v1,
movementTieBreakPolicy chronological-speed-v1. Snapshot8 combat_initial, frozen4
combat_turn, result3 combat_turn, next snapshot9 combat_resolved. Historical
versions and the repaired Stage A engine remain unchanged. The server chooses the
pin only for newly created matches; no existing match is repinned or backfilled.
All raw snapshots, seeds, relationships and battle audits are server-private.

Phases: planning/revision/Ready → immutable closure/freeze → chronological movement
and encounter gathering → complete Stage A battles → survivor/capture placement →
one atomic result/snapshot/state advance. Stop at resolved Turn1, no Turn2 record.
The existing Match-first lock, due-worker, frozen seed and restart boundaries apply.
RESOLVING is transient inside the transaction, never a committable partial result.
Work/placement failures leave CLOSED and the identical frozen input for recovery.

Initial armies retain the six original unit IDs, membership and permanent spawn
provenance, with explicit HP. The production first cohort explicitly selects a
free-for-all relationship policy at creation: materialize every ordered pair as
hostile, then validate/freeze the complete matrix. This is a named cohort choice,
not a fallback when alliance data is missing. Trusted callers can instead supply
an explicit complete ally/hostile equivalence matrix; incomplete/asymmetric or
non-transitive input is rejected. There is no diplomacy negotiation/UI in Stage B.

Trusted setup supplies Infantry7HP/4ATK/6DEF; Lieutenant1HP/1ATK/1DEF (the established
prototype HP and approved new minimum stats). These are explicit provisional cohort
values, not engine defaults or hidden higher-rank/specialization balance. Only the
initial Infantry/Lieutenant roster is created. Lieutenant primary bonus is0/0;
explicit specialization table entries are supplied, never inferred. All subsequent
HP/leadership and exact BigInt scaling use the repaired merged Stage A engine.

## Provisional chronological geometry

Each formation starts its route at execution time0; speed is1 world unit per
simulation-time unit. Waypoints concatenate without pauses. Total range remains
250, independent of turn wall-clock duration. Finished/no-order routes are stationary.
Within intervals bounded by route segment ends, relative positions are linear;
solve the closed radius20 contact quadratic analytically using pinned ECMAScript
Number operations. No player-by-player move precedence, ambient time or epsilon.
Exact-equal event times are processed as one simultaneous batch, canonical pair IDs
break enumeration ties. Store rounded milliworld coordinates (nearest, half-up).
This new analytic policy is separate from legacy exact swept sequential geometry.
It is deterministic for equivalent input on the supported JS toolchain, not a
claim of arbitrary-precision physical time or continuity across a version change.

At each earliest hostile contact, stop involved formations and retain their actual
contact positions. Simultaneous connected contacts form one encounter. An existing
encounter remains a fixed gathering site during the movement phase; arrivals that
actually reach its radius20 can join even when allied to an existing participant.
An army stopped in an encounter can never join another or resume its route. A new
arrival reaching multiple already-distinct encounters at exactly the same instant
joins the earliest-created encounter, then canonical ID; it cannot bridge/merge
previously blocked armies. This explicit tie convention avoids assigning one army
to two battles. Later battles are resolved only after chronological participation
is frozen, so casualties never retroactively unblock movement or reinforcements.
No connected graph built from sequential full routes substitutes for arrival facts.

A formation's stance is stationary only when its velocity at first involvement is
zero; otherwise moving, including a moving target. Stationary city owners defend;
other stationary pairs and hostile movers use Stage A pair-relative alternation.
The encounter center is the stationary defender's center when present, otherwise
the mean contact centers rounded to milliworlds. A city/POI is involved if that
center is within its radius20 gathering area; closest squared distance then city ID
break ties. The archive is immutable; city ownership is a separate next-state list.
Only encounter capture is included; mere non-hostile transit is not a capture order.

## Placement and privacy

Victorious recipient formations occupy the city center. Other allied survivors
use the nearest valid point on a1-world-unit integer lattice, minimizing squared
Euclidean distance to that center, ties by x then y. Valid means in the closed map
rectangle, strictly outside radius20 of the city and other-owner formations;
separate formations of the same owner may co-locate without merging. Search uses
ordered lattice candidates, with a technical work ceiling; no candidate/limit is a
recoverable execution failure, not invented successful placement. Off-city survivors
stop at the encounter center. Mutual destruction preserves city ownership and
removes destroyed formations from active state, retaining identities in the audit.
No territory-geometry or resource-node ownership rewrite, player elimination,
supply/economy/recruitment change, Europe map/HUD redesign or deployment is included.

A strict own-only aftermath DTO exposes only own formations, own casualty/survivor
IDs/HP, stopped positions, own outcome and location ownership resulting from own
participation (recipient as own/ally/opponent/unchanged, no opponent identity). No rounds,
full audits, opponent IDs/rosters/orders/HP, seed, global ordering/time or action
counts. Existing membership/session checks and private headers precede projection.
Destroyed own armies are absent from active map but visible in own loss inspection.

## Cohort and verification limits

The generated first cohort still starts one Lieutenant and five Infantry per
capital, not a scenario editor or recruitment/split feature. The chronology engine
supports multiple formations of one owner; pure topology fixtures exercise that
case without repinning production matches. The generated region capitals are
further apart than a stationary assault can reach in250 units; reachable Turn1
mutual interception is verified through persistence, while city assault/capture,
allied placement and map-edge cases use explicit synthetic geometry. Hosted SQL
forged-capture and malformed aftermath cases verify atomic rejection. This does
not claim a live city capture was played through an existing database or a Turn2.

Pending allied relocations vacate their old contact positions for placement; use
canonical formation order and reserve each assigned final position. Any final
hostile overlap caused by placement is an execution failure, never a completed
invalid state. The minimal inspector labels opposing recipients accurately and
shows own survivor HP; all opponent IDs/HP and raw audit/timing remain private.

## Stage C acceptance map and frozen scope — Issue #103

Stage B is merged as249b6e4aa0d5a14ec7fd54ba95c118fc692f8b73 through PR102.
Its exact-head CI44162233401 attempt1 passed2172 application tests and283 SQL
integration tests across17 files, zero SQL skips, migrations and disposable cleanup.
These are completed historical results, not Stage C execution claims.

Before Stage C edits, the actual remaining scope is frozen to eight paths:
apps/web/src/MovementResolution.tsx, apps/web/src/CombatAftermath.tsx,
apps/web/src/CombatAftermath.test.tsx, apps/web/src/WorldView.tsx,
apps/web/src/WorldView.test.tsx, README.md, docs/COMBAT_TURN.md,
and docs/DEVELOPMENT_STATUS.md. No transport, server, engine or SQL changes.

| Stage C criterion | Already shipped evidence | Remaining gap |
|---|---|---|
| Own-only result and survivor HP | combat-turn-view.ts explicit allowlists; combat-turn-storage.test.ts; combat-aftermath.test.ts; real-session combat-turn.integration.test.ts | Accessible grouped results, human labels, combined losses, all own surviving formations and destroyed participants |
| Waiting, no-contact, historical, error states | Strict aftermath DTO and legacy MovementResolution.test.tsx | Separate combat loading/waiting/not-started/unsupported/error/no-own-battle wording |
| Capture without private opponents | Own/ally/opponent/unchanged enum and hostile-recipient regression | Human labels and archive-versus-current ownership explanation |
| Stale private-data boundaries | Abort/clear on refresh/reconnect; Stage B basic reconnect assertion | Delayed-response acceptance for refresh, unmount, match/cohort changes and authorization loss |
| Restart/replay and historical cohorts | combat-turn-storage.test.ts, combat-turn.integration.test.ts, existing movement-resolution/prototype suites | Reuse unchanged; do not reimplement |
| Duplicate/concurrent resolution and rollback | Six-stage fake transaction injection; hosted concurrent execution, four write-stage failures and forged complete bundles | Reuse unchanged |

Association boundary, reported before implementation: lostUnitIds are combined for
all ownFormationIds in one battle; no per-destroyed-formation unit membership or
final position is transported. Show these as explicitly combined battle losses,
list participating own formations, and use survivor membership/positions from
formations for individual survivor inspection. Never parse IDs to guess membership,
assign a combined loss to one formation, or label the encounter center as a
destroyed formation's final position. No new exposure is needed. Native details/
summary disclosures provide keyboard inspection; Escape closes and returns focus.
The initial map stays archived, with original colors/owners; capture descriptions
come only from authorized own aftermath. No claim of a current ownership map.

### Parent #89 A/B/C criterion evidence map

A is merged through PR99 (reviewed head986adcbde74b9133bf5728a5d2f9854e1659a34f,
merge cefad2e50b175a957cbc168a432e19815ce1a3dc). Exact-head CI44151801998
passed2123 application and262 SQL cases. B is merged through PR102, evidenced
above. C remains candidate/unmerged until its exact-head checks and merge are
observed. This table maps each staged criterion and the required scenario groups;
passing synthetic tests is not balance playtesting or capacity certification.

| Parent criterion | Concrete evidence |
|---|---|
| A: new pure typed version/audit; old prototype preserved | multi-force-combat.ts; MULTI_FORCE_COMBAT.md; combat.test.ts historical replay/strict-entry-point guard |
| A: own grouping, frozen relations, stationary DEF and mover pair roles | multi-force-combat.test.ts: same-player grouping, allied contribution, three hostile movers, stationary owner versus already-stationary enemies, defender destruction with continuing mover alternation |
| A: exact 3+ scheduling, one action per round actor, persistent target/overflow/RNG | tests for uneven rosters/round-start deaths, incoming/overflow rotation, elimination without queue resets, odd allied contributions, independent exact-integer damage oracle; reviewed repair1 retained |
| A: simultaneous casualties, wounded ordinary units first/leaders last, leader changes and final strength/ties | wounded target and leader-last cases; dying round-start bonuses; own-only rank/specialization bonuses; surviving modified strength, post-leader-death strength, seeded highest ties, mutual destruction |
| A: explicit numeric policies/invalid input/resource failure | minimum-one/LCG/equivalence policy in MULTI_FORCE_COMBAT.md; strict policy/rank/seed/provenance tests; resource exhaustion returns no audit; bounded deterministic matrix, unit ceiling and40-player scenario |
| A: deterministic identities/spawn/replay with no live integration in A | input permutation/immutable audit tests; per-encounter RNG; no UI/storage in Stage A changes; old prototype source preserved |
| B: creation pin and isolated immutable historical meanings | combat-turn/1 contracts; combat-turn-storage.test.ts corruption/replay guards; historical movement/prototype suites; SQL admission-body equivalence test |
| B: chronological reachable contacts/first block/stance/placement | combat-turn.test.ts: mutual relative contact, vacated path, first interception and no resumption, allied actual arrival versus blocked force, same-owner formations, three hostile movers, defender death, capture/allied nearest placement, map edges and exhausted placement |
| B: complete explicit alliance/stat policy integration | canonical complete validated matrices and explicit setup frozen in snapshot/input; missing/asymmetric/non-transitive policy rejection; engine equivalence and leadership scenarios |
| B: atomic complete aftermath/replay/recovery | combat-turn-storage.test.ts: semantic CLOSED/RESOLVED replay, detached restart, separate next-snapshot check, duplicate no-op, six injected rollback boundaries; hosted combat-turn.integration.test.ts: real duplicate/concurrent, restart, four write-stage rollbacks, malformed complete bundles, immutability |
| B: no-contact2/4/40 and no Turn2, immutable geography/capture | same hosted suite executes2/4/40 no-contact initialization/freeze/resolve/restart and reachable mutual contact; pure synthetic city capture/adjacent placement and unchanged world archive; no real stationary city-assault claim |
| B: additive SQL exercised only disposable hosted CI | migration202611170001_combat_turn applied in CI44162233401;283 tests/17 files/no skips and service/network cleanup, no existing database accessed |
| C: own outcome/casualty/survivor/position/ownership inspection | Stage B own allowlist projection plus signed HTTP/schema privacy suites; Stage C CombatAftermath.test.tsx presentation, combined-loss limitation, survivor HP/final positions, destroyed participants and authorized recipient categories |
| C: authentication/membership/filtering and stale boundaries | reused server combat-aftermath.test.ts and real-session SQL suite; new delayed fetch/body, refresh/reconnect/auth-loss/match/cohort/unmount UI cases; strict rejection of extra root/battle/unit fields and mismatched match |
| C: reuse recovery/no-contact/historical checks; no animation/scheduler/dependency | existing B suites unchanged; full database-free and fresh-hosted suite counts will be recorded per final head; scope limited to eight UI/product-doc paths |

The required scenario list is covered by the corresponding A/B rows: stationary
assault/owner-defender; two/three hostile movers; allied and same-player arrivals;
whole-round actors/uneven sizes; wounded targeting/leadership; strength/ties/mutual
destruction; earliest interception/blocked reinforcements; city/edge/failure placement;
permutations/independent encounter RNG/restart/external-clock isolation; completed
bounded inputs and atomic technical failure. Evidence for executable mechanics is
separate from the remaining human gameplay playtest, especially balance/readability.
No Turn2, Europe map, production rollout or deployment is implied by parent closure.

External-clock isolation is supported by the pure engine's reviewed absence of
clock inputs/ambient clock reads and durable frozen seeds, plus replay/independent
encounter tests; no additional live-clock experiment is claimed here. Stage C's
synthetic DOM acceptance checks native disclosure structure and Escape focus return;
human browser usability and gameplay/balance playtesting remain separate.
