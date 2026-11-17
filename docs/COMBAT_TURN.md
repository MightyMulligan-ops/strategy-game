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
