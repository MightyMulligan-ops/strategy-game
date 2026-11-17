# Combat 1B Stage A — pure multi-force engine

Issue #97 implements `multi-force-combat-1b-v1` in the server-only
`packages/game-engine/src/multi-force-combat.ts`. It has no package-barrel export,
production caller, database, movement classifier, diplomacy service, capture write
or participant DTO. Existing `combat-prototype-1a-v1`, its tests and replay meanings
are unchanged. This is local implementation for review, not a delivered runtime.

## Authority and numerical policies

The owner explicitly launched Stage A from Issue #97 and approved its gameplay
changes in the November 17 task chat. Before affected implementation, the owner
also explicitly approved retaining `provisional-lcg32-scaled-v1`, clamping modified
ATK/DEF to at least 1, rejecting incomplete/asymmetric/non-transitive alliances,
and recoverable work failure without any partial completed outcome. These are new
version policies, not retroactive changes to the prototype.

There is no global Infantry or commander balance preset. Every unit supplies
positive integer base ATK/DEF, maxHP and current HP. The provisional first-playable
Infantry cohort is 7 HP / 4 ATK / 6 DEF; it appears in fixtures, not engine defaults.
The caller supplies explicit specialization/type modifier entries (including
explicit zero values) and each unit's leadership eligibility. The engine retains
the established primary table: General +2/+2, Colonel +1/+1, Captain +0/+1,
Lieutenant +0/+0. No numeric specialization value is inferred from its name.
Negative specialization modifiers are allowed and the approved stat floor applies
after adding modifiers. Supply consumption/calculation and other modifiers are
outside this contract; do not silently pre-apply leadership twice.

Leadership remains formation-local, following the existing stack primary/secondary
rule: highest living rank is primary, its specialization is inactive; other living
leaders add matching specialization modifiers. A player's formations cooperate in
the action schedule without merging membership or sharing commanders. Bonuses
never cross player ownership, including allies. Duplicate ranks in a formation
are invalid, but separate same-player formations can have the same rank. A leader
is a normal positive-stat combat unit; losing ordinary troops never removes it.

## Validated private input

`resolveMultiForceCombat(unknown, budget?)` copies strict plain JSON-domain fields,
rejecting accessors, proxies, unexpected/missing fields, sparse arrays and invalid
numbers without invoking user getters. No executable policy callbacks are accepted.
All identities are nonempty trimmed strings of at most 128 code units. Units have
unique encounter-wide IDs, permanent originalSpawnNodeId, explicit unitType,
kind TROOP or LEADER, stats and HP. Formation IDs are unique. No existing roster is
mutated; results retain owner/formation/unit/spawn identities even for casualties.
The input is a frozen server-owned encounter snapshot, not an HTTP request schema.
A future authoritative adapter must verify real ownership, roster, stat policy,
relationships, seed and encounter eligibility before calling it.

There are 2–40 participating players, at most 80 nonempty formations and 2048 total
units. Base HP/ATK/DEF are integers 1..1,000,000; current HP is 1..maxHP. There are at
most 128 unique specialization/type entries, each with integer modifiers in
[-1,000,000,1,000,000]. Every leader must have explicit entries for every eligible
unit type in its formation, even if initially primary. Unit types/specialization
names are opaque policy keys, not executable mechanics or approved balance presets.

Every ordered pair of distinct participating players must have exactly one
`ally` or `hostile` relationship. Self/unknown/duplicate edges, missing edges,
asymmetry and non-transitive alliances are rejected. Thus alliances form complete
coalitions with uniform external hostility. At least one hostile pair is required;
all-friendly co-location is not a battle. Same-owner cooperation is intrinsic,
never a diplomacy edge. An optional city/POI ownership reference supplies its owner
(or null for unowned) and location ID. The owner need not participate.

## Round action schedule

The schedule version is `round-start-single-action-rotating-armies-v1`:

1. Canonicalize formations, unit arrays, relationships and modifier table by
   code-unit IDs/keys before computing the battle identity. Reproducibly shuffle
   player force order, formation order, and ordinary/leader unit order separately.
   Ordinary units always precede leaders within each formation's casualty roster.
2. Keep encounter-local initiative queues. Remove eliminated entries, then rotate
   the surviving force and formation queues once per round. Eliminated entries
   consume no starting slots. Snapshot living units and leadership-modified stats.
3. Interleave one actor per player, cycling until all living units have acted.
   Within a player, interleave its formations' units. Each unit has **one action
   per round**, including leaders, regardless of opponent count or army size.
   There is no per-opponent retaliation. Allied owners alternate contributions
   while both have actors; larger forces continue after smaller queues exhaust.
4. For each source player, maintain a target queue initialized from the seeded
   force order, independent of initiative. Advance it after every action and
   retain it across round boundaries, pruning eliminated players without restarting.
   Maintain the same persistent rotation for each source/target player's formation
   queue, initialized from seeded formation order and pruning destroyed formations.
   Thus a one-unit or odd-sized defender still alternates allied targets across
   rounds. Same-player formations retain separate casualty rosters. Never target allies.
5. Choose that action's ATK/DEF relative to its designated target formation, roll
   once, and commit all actions before allocating any damage. A unit killed in
   this round still contributes its full action and leadership bonus.
6. Allocate committed packets in action order using shadow HP. Begin at each
   designated target army. Finish its first living ordinary unit (including wounds
   from earlier rounds/packets) before another; leaders follow all ordinary units.
   After a unit dies, packet overflow rotates to the next hostile army in
   encounter order, including another hostile player if necessary. The
   committed role/damage never changes or rerolls on overflow. Discard only damage
   exceeding all eligible hostile HP. Commit shadow HP/casualties for the entire
   round together. No next-round actor sees a partial casualty update.
7. Continue while any hostile pair survives. There is no gameplay round cap or
   stalemate outcome. Positive damage and a living hostile target guarantee total
   encounter HP decreases in every completed combat round. A finite positive-HP
   accepted battle therefore terminates, subject to execution resource budgets.

Within an army, initially wounded ordinary units precede intact ordinary units;
ties use the seeded fixed order. Finish the selected wounded unit before advancing.
After killing a unit, rotate packet overflow to the next hostile army, skipping
exhausted armies and wrapping while damage and hostile HP remain. Overflow retains
the original action role/damage and never grants another action or roll.

The target is an army, not an individual duel. All ordering and overflow policies
above are explicit new schedule semantics, not inherited prototype exchange order.

## Pair-relative roles

For moving versus stationary: mover ATK, stationary DEF throughout. For two
stationary enemies, a participating city/POI owner uses DEF and its opponent ATK;
without an owner in that pair, alternate roles. Two hostile movers alternate from
round 1 even while a stationary defender survives. Roles are attached to unordered
formation pairs, not a global force label. Each alternating pair has an independent
seeded first-round complementary ATK/DEF assignment and flips every round using
the absolute round number. Defender death does not restart or reseed that phase.
A three-mover fixture audits all three complementary pair roles; an odd hostile
cycle is valid because one formation can use ATK against one enemy and DEF against
another. Its actual action still uses only the role for its selected target.

## Determinism and private audit

No clocks, ambient RNG, network or mutable global state enter resolution. A
server-owned uint32 seed and encounterId derive SHA256 domain-separated initial
states for force order, army order, each formation's ordinary/leader order, damage,
and ownership ties. Each alternating pair uses its own independent domain.
LCG recurrence is `(imul(state,1664525)+1013904223) >>> 0`. Fisher–Yates index
selection and damage use floor scaling; damage is `floor(raw*stat/2^32)+1`.
Damage multiplication/division uses BigInt before converting the bounded result
back to Number. Leadership can raise a stat above the base-stat ceiling, so its
intermediate product must not be rounded using Number arithmetic.
This has small scaling bias, retains the approved provisional behavior and does
not claim to reproduce atWar. Modified stats are bounded by base plus at most
three secondary modifiers and the established primary bonus. Modified stats,
strength sums and bounded shuffle-index products remain safe Number integers;
the potentially larger intermediate damage product is computed exactly as BigInt.

Only active actions consume the local damage stream. Unrelated encounters,
external call order, retries, input array permutations and execution budgets do
not change this battle's random choices. The engine does not generate or trust a
client seed. Future integration must freeze a unique authoritative encounterId
and seed before execution and retain them through restart/recovery.

The recursively frozen audit includes the canonical detached input, battle hash,
round-start effective stats/primary leaders, force/pair-role schedules, every action
and raw roll, shadow hits, excess damage, casualties, encounter/final HP, surviving
strength and tie choice. It is **server-private**: never serialize raw audits,
seeds, opponent rosters or hidden HP to clients. This slice adds no public report.

## Outcome, healing and recovery

Stop when no hostile pair remains: allied players may win together. Recalculate
leadership from surviving leaders, sum each victorious player's surviving modified
ATK+DEF across formations, and select the greatest for the optional pure ownership
recipient decision. Equal-highest ties use a separate seeded draw over canonical
player IDs. HP/headcount do not decide strength. The recipient is a player, not a
formation membership mutation. No ownership reference means no recipient decision.
If all units die, return mutual_destruction, no victorious players and no recipient;
the caller must preserve existing ownership. Do not remove a player from a match.
Survivors heal to their own maxHP only after full resolution; encounterHp preserves
wounds at the end of battle. No healing occurs during rounds or on work failure.

The separate technical budget defaults to 100,000 rounds / 1,000,000 actions and
can be lowered for injected-failure tests. Both are hard execution ceilings in
this implementation, not gameplay settings or capacity certification. Exhaustion
returns only `{ok:false,error:{code:"WORK_LIMIT",recoverable:true}}`: no audit,
partial roster, invented draw/victory, healing or ownership decision. Retry the
same frozen input with a larger budget within the ceilings; a ceiling-level failure
requires execution-capacity engineering/owner review, not a new gameplay result.
There is no serialized mid-battle checkpoint in Stage A. Future integration must
leave the turn uncommitted, retain the frozen input and safely retry/recover before
opening planning. No database rollback guarantee is claimed by this pure module.

## Verification and deferred work

The new suite covers assault, movers, stationary ownership, same-player armies,
allies, three-way hostility, defender death, simultaneous deaths, uneven sizes,
one-action budgets, wounds, leaders, succession, stat floors, ownership strength,
ties, permutation replay, immutability, malformed data and injected work failures.
A deterministic positive-stat matrix checks action conservation, no friendly fire,
HP accounting and terminal outcomes. Existing prototype/movement tests are retained.
Actual command results and correction history are in DEVELOPMENT_STATUS.md.

Movement/contact chronology, gathering blocked reinforcements, geographic placement,
persistence/atomic commit/restart wiring, ownership writes and filtered aftermath UI
remain later stages of parent Issue #89. No source from Issue #95 is changed.
