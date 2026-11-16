# Game Design — Core Rules Baseline

**Status:** Working design baseline for implementation planning.  
**Scope:** Core playable game loop and currently agreed rules.  
**Important:** Values explicitly marked as examples or open questions are not final balance decisions.

## 1. Game overview

A browser-based 2D multiplayer grand strategy game inspired by atWar's broad gameplay loop, implemented independently with original code, assets, maps, and presentation.

### Target experience

- Simultaneous-turn multiplayer with configurable turn duration.
- Target capacity of up to 40 players; actual capacity must be validated through load and simulation testing.
- Public, private, and password-protected games.
- Teams, configurable match duration, starting funds, starting countries, join cutoff, and victory conditions.
- Multiple eras and world, regional, national, and custom map scales.
- Countries, cities, capitals, territories, ports, and geographically positioned units.
- Core loop: select a country, earn income, recruit, organize forces, move, fight, negotiate, and achieve victory.

### Core feature baseline

The first playable game should cover the actual strategy-game loop rather than begin as a generic map demo. The intended baseline includes country selection, city-based income and recruitment, unit categories, movement, combat, diplomacy, upgrades/strategies, fog of war, stealth/detection, auto-production, battle reports/playback, coalitions, and victory conditions. Some advanced items may follow the first vertical slice.

Leadership-dependent movement and the basic Military Supplies system are core differentiators and belong in the first playable implementation—not indefinitely deferred features.

### Turn submission and advancement — approved rules

- Players submit orders simultaneously; the server alone resolves their outcomes deterministically.
- Turn advancement is **hybrid**: close at the server-controlled deadline or immediately when every active player is Ready, whichever occurs first.
- Turn duration is configured at match creation and remains fixed for that match.
- Players may create, revise, reorder, or cancel orders while the turn is open. Submitting an order changes the player's draft, not authoritative positions, resources, or combat state.
- Ready can be set or cleared before closure. **An accepted order replacement or cancellation clears that player's Ready status** (owner clarification for Assignment 002). Once the final active player marks Ready, closure is immediate; a later unready command cannot reopen that turn.
- A player with no submitted orders performs no new actions. This does not freeze positions or exempt existing units/passive states from future approved rules. No previous-turn orders are automatically copied forward by the current contracts.
- The server decides acceptance using its own turn state and time, not a client clock or send timestamp.
- Matches must progress while all players are offline. Connection status is not Ready status and does not determine whether a player is active.
- Acknowledged submissions must eventually be durable. Assignment 002 defines and tests in-memory contracts only; it does not provide a production acknowledgement, database, scheduler, or gameplay resolver.
- Explicit attack orders remain a separate intent from movement orders.

The exact states, boundary convention, revision protocol, and unimplemented edge cases are specified in `TECHNICAL_ARCHITECTURE.md`, section 8. Operational lifecycle ordering does not decide the gameplay phase order for movement, supply, economy, or combat.

### Player accounts (Assignment 004B.1)

Players sign in with Discord or Google; there is no email/password authentication. Each account has one stable internal player ID independent of its provider. An authenticated player may explicitly link the other provider. Matching email addresses never merge accounts, and linking cannot transfer an identity belonging to another account.

The owner-approved initial username policy is 3–24 ASCII letters, digits, or underscores, starting with a letter, unique without regard to case. Players choose it after first sign-in; existing identities may initially have no username. Renaming, unlinking, recovery, and merging separately created accounts need later decisions. Authentication does not imply match membership, permissions, or access to hidden information. Match creation/joining remains unimplemented. See `AUTHENTICATION.md` for the implemented account boundary; gameplay rules below are unchanged.

## 2. World, territories, and positions

Keep these concepts separate:

- **Territory:** ownership, borders, control, and strategic administration.
- **City / supply node:** income, recruitment, supply generation and storage, population, port status, and other node attributes.
- **Unit position:** geographic coordinates or map-space position, independent of territory adjacency.
- **Defense line:** a separate geographic object with its own geometry, owner, status, and assigned forces.

Units move freely through geographic space within their permitted range. Movement is not limited to adjacent territories. Terrain, roads, and infrastructure may modify movement later.

Territories remain important for ownership, income, recruitment, borders, supply nodes, and strategic control.

## 3. Movement and army organization

### 3.1 General movement

- Movement is based on geographic distance and each unit's permitted range.
- The server validates every movement order.
- A stack's movement capability must be calculated from its composition and applicable rules; the exact mixed-stack range calculation remains to be confirmed.
- Players may move groups and split formations.
- Combat may begin when a movement order encounters hostile forces, subject to diplomacy and combat rules. Explicit attack orders are distinct from movement orders. Attack targeting and the interaction between explicit attacks and movement-triggered encounters remain unspecified; the contracts do not execute either behavior.
- Defense lines are separate geographic objects. Hostile units cannot pass an enemy defense line without attacking it; peace may permit passage. Exact geometry, placement, and UI details need further reference verification.

### Player-relative movement queues — approved rules

- Each player has a movement queue numbered **Move 1, Move 2, Move 3**, and so on. All eligible Move 1 orders have priority over eligible Move 2 orders, independently of submission timestamps.
- Equal move numbers across players use **seeded randomized sequential precedence** as a provisional, replaceable policy. This is not a permanent combat/collision formula or permission to execute movement before other unapproved phases.
- The current contract derives move numbers from the relative positions of `move` entries in each player's existing ordered draft. Attacks do not consume movement numbers. Stable `orderId` values identify orders even after reordering; cancellation compacts the surviving movement numbers.
- Reordering uses the existing complete-draft revision operation. Reordering, editing, and cancellation clear Ready. The final queue and revision are captured at turn closure and cannot subsequently change.
- The future UI must show dotted movement paths with cancellation controls and a separate **Movement Queue** panel. No gameplay UI is implemented in Assignment 003.
- Recruitment-to-movement prerequisites must eventually use stable references and be validated. Canceling a prerequisite must warn about dependent orders and leave no executable orphan. Whether to block cancellation or also cancel dependents requires an owner decision; recruitment and dependency execution are not implemented.
- Explicit attack orders remain separate. Their final phase precedence, targeting, and interaction with movement encounters are still unresolved.

Assignment 003 only groups queues and calculates reproducible precedence; it does not establish movement eligibility, move stacks, or resolve encounters. The empty-turn resolver rejects all nonempty move/attack lists rather than reporting successful execution. See technical architecture sections 8.7–8.9 for server-only snapshots, audit results, operational phases, and the future dependency model.

### 3.2 Leadership requirement

A normal moving stack requires at least one eligible leader.

**Single-infantry exception:** one infantry unit may move independently without a leader only within a configurable radius of its original recruitment/spawn node.

- Record the original source node ID on the infantry unit.
- The source node ID is permanent and is not changed by entering another node's radius.
- Infantry cannot hop from node to node to extend its independent movement range.
- To move outside its original source-node radius, the infantry must join a leader-commanded stack.
- Multiple leaderless infantry units cannot move together under the current design.
- Leaderless units may remain stationary and defend.
- Naval, air, armor, artillery, and other non-infantry units require leaders to move.

Illustrative validation logic:

```text
ValidateMovement(stack, destination):
    if stack contains an eligible leader:
        validate normal movement range
        return permitted

    if stack contains exactly one infantry unit:
        if destination is within configured radius of that unit's original source node:
            return permitted

    return denied
```

This is a rules summary, not production code. Edge cases such as a mixed stack containing infantry and non-infantry units without a leader must be explicitly tested and rejected unless a later rule says otherwise.

### 3.3 Leaders and ranks

Ranks, highest to lowest:

1. General
2. Colonel
3. Captain
4. Lieutenant

A stack may contain at most one leader of each rank (maximum four leaders). The highest-ranking leader is the primary commander; all other leaders are secondary commanders.

If a leader is removed or destroyed, the next-highest remaining leader automatically becomes primary. If no leader remains, non-infantry units cannot move; the single-infantry exception still applies only to an individual infantry unit within its original source-node radius.

Leaders do not consume Military Supplies.

### 3.4 Commander bonuses

The primary commander provides a generic rank-based passive bonus to eligible combat units:

| Primary rank | Attack | Defense |
|---|---:|---:|
| General | +2 | +2 |
| Colonel | +1 | +1 |
| Captain | +0 | +1 |
| Lieutenant | +0 | +0 |

Secondary leaders provide specialization bonuses instead of their rank-based primary bonus.

Specialization is selected when the leader is created/recruited. Current proposed choices:

- Armor
- Infantry
- Artillery
- Naval
- Aviation
- Logistics
- Reconnaissance

Specialization bonuses are simple numeric modifiers and apply only to matching unit types. Example: an Armor specialist may provide +1 attack to tanks.

The primary commander's specialization is inactive while that leader is primary; the primary leader supplies the generic rank bonus. Secondary leader specializations can apply to matching units. This means a General's specialization is inactive whenever that General is primary under the current rank list. This behavior is recorded as the current agreed model but should be revisited as a balance/design question before final balancing.

Recommended stacking rule: primary rank bonus plus applicable secondary specialization bonuses. Duplicate leader ranks are disallowed, preventing same-rank duplicate stacking.

### 3.5 Splitting formations

Multiple leaders allow a formation to split into independently moving stacks if each resulting stack contains an eligible leader.

Example: a stack containing one General, one Lieutenant, and 98 tanks may split into:
- Stack A: General + 50 tanks
- Stack B: Lieutenant + 48 tanks

A stack without an eligible leader cannot move non-infantry units.

## 4. Military Supplies

### 4.1 Resource model

The supply model has been simplified to one abstract resource: **Military Supplies**.

Each city or designated supply node has:
- Population
- Base supply generation per turn
- Supply storage capacity
- Current stockpile
- Optional modifiers (for example, industrial city, oil field, or military depot)

Population influences baseline supply generation; special node types may modify it. Exact formulas and balance values are not yet finalized.

### 4.2 Stockpiles and allocation

- Military Supplies are generated and stored at their source node.
- Supplies remain at that node until dispatched.
- Supplies cannot be transferred directly from one city stockpile to another.
- When a stack departs, the player allocates supplies from the source node into the stack's carried inventory.
- The allocation control is a slider. It permits zero through the available stockpile, subject to any validated UI constraints.
- The slider defaults to the stack's full calculated requirement.
- If only part of a formation moves, calculate the requirement for the selected units only.
- Supplies travel with the stack and are consumed over time.
- Returning to a friendly supply node permits replenishment.
- The stack carries its own supply inventory.

### 4.3 Consumption and unit requirements

Each non-leader unit type has a supply requirement. Stack requirement is the sum of each unit quantity multiplied by its per-unit requirement.

Example: if a tank requires 2 Military Supplies and a stack moves 5 tanks, the stack's requirement is 10 supplies. This is illustrative, not a finalized unit balance value.

### 4.4 Initial supply effects

The initial system deliberately stays simple:
- City/depot stockpiles and automatic replenishment at nodes.
- Supply allocation at departure.
- Stack-carried inventory and consumption.
- Supply radius/distance rules.
- Shortage states and a supply overlay.

In the initial implementation, supply affects **attack and defense only**. It does not affect movement, visibility, HP, or unit identity.

Supply condition is calculated at stack level and applied to eligible units. Current qualitative intent:

| Supply state | Intended effect |
|---|---|
| Adequate | Default stats |
| Oversupplied | Modest attack/defense bonus |
| Slightly undersupplied | Small penalty |
| Undersupplied | Stronger penalty |
| Severely undersupplied | Severe penalty |

The asymmetry is intentional: the penalty for shortage should be meaningfully greater than the benefit of extra supply. Extra supply should never be more valuable than avoiding shortages.

Exact thresholds and modifiers are open balance questions. Example values previously discussed (such as +1/+1 for oversupply and -2/-2 or -3/-3 for shortage) are examples only and must not be treated as final constants.

### 4.5 Combat stat composition

The intended structure is:

- Final Attack = Base Attack + Primary Commander Bonus + Applicable Secondary Specialization Bonuses + Supply Modifier.
- Final Defense = Base Defense + Primary Commander Bonus + Applicable Secondary Specialization Bonuses + Supply Modifier.

Illustrative example only:
- Tank base: 8 attack / 4 defense.
- General primary bonus: +2 / +2.
- Secondary Armor specialist: +1 attack to tanks.
- Adequate supply: +0 / +0.
- Result: 11 attack / 6 defense.

Shortage example using an illustrative -2/-2 modifier: 9 attack / 4 defense.

Avoid allowing players to exploit splitting to improve supply ratios. Supply carried and condition must be transferred or recalculated consistently when stacks split or merge. Exact anti-exploit rules remain to be specified and tested.

### 4.6 Later logistics extensions

Potential later additions include roads, railways, naval routes, air resupply, convoys, capacity, depots, infrastructure damage, and interdiction. These are not required for the first basic supply implementation.

## 5. Economy and recruitment

The reference gameplay baseline includes:
- Cities generate income.
- Capitals unlock income/recruitment or city-purchase rules as defined by the selected ruleset.
- Control of all cities in a country can grant bonus income.
- Population influences recruitment/reinforcements and may influence income.
- Naval units are recruited only at ports.
- Units have purchase costs and upkeep.
- Auto-production, rare units, strategies, upgrades, and strategy points are part of the broader reference feature set.

Some detailed reference formulas have been observed in atWar documentation but require a source audit before being adopted. Do not hard-code unverified values. See `ATWAR_REFERENCE.md`.

## 6. Combat

- Combat resolution is server-authoritative.
- Unit base attack/defense, primary commander rank bonus, applicable secondary specialization bonuses, and supply modifiers contribute to combat stats.
- Diplomacy determines whether hostile contact or movement through a location is permitted.
- Battle reports and playback are desired features.
- Exact damage, casualty, initiative, randomness, rounding, and tie-breaking formulas are not finalized in this baseline. Do not invent or silently finalize them.

### Combat Prototype 1A — Issue #76 (restricted server-only foundation)

[Issue #76](https://github.com/MightyMulligan-ops/strategy-game/issues/76) approves a pure, isolated two-hostile-formation prototype. Combat is fight-to-destruction: ATK and DEF both produce damage, never mitigation. Opposing damage is committed before either hit is applied within an exchange; a unit killed by that exchange still delivers its committed damage. Wounds persist throughout the encounter. Surviving units heal only after complete resolution, not between exchanges/rounds or on a stalemate/work-limit result.

The versioned `combat-prototype-1a-v1` input explicitly supplies hostility, first-round roles, mode, seed, integer Infantry HP/ATK/DEF and work limits. Mutual attackers alternate formation ATK/DEF each round; a one-sided assault keeps its designated roles. Only Infantry and at most one Infantry-specialized Lieutenant per formation are supported. The Lieutenant has 1 HP, no damage output/bonus, stays behind Infantry and is removed if no Infantry remain. Higher ranks, succession across ranks, and their bonuses remain outside this slice; the general leadership rules above are unchanged.

`two-formation-ordered-pairs-v1` is a **provisional prototype scheduling policy**, not a permanent balance decision or a multi-army algorithm. Formations and Infantry use code-unit ID ordering; leaders follow Infantry in the target roster. Each exchange pairs the next living Infantry that has not acted this round. Pairing selects actors, not individual duel targets: damage follows the enemy's first living roster entry, with overflow continuing along that roster. Unmatched Infantry may attack once without extra retaliation from enemies that already acted. Units killed in earlier exchanges lose uncommitted actions; same-exchange attacks are retained. The encounter stops once either formation has no Infantry. Different scheduling or balance requires an explicit rules/version decision before integration.

`provisional-lcg32-scaled-v1` uses a separate per-battle stream with the existing 32-bit LCG recurrence, one draw per positive-stat attack and floor scaling to 1..stat. Stat zero produces zero damage without a draw. Scaling has a small bias and is not asserted to reproduce atWar. The illustrative 7 HP / 4 ATK / 6 DEF values exist only in caller-supplied test fixtures. Technical ceilings are 2,048 units/formation, 1,000 rounds, 10,000 exchanges and stats up to 1,000,000; lower round/exchange budgets are injected. These are execution safeguards, not match balance or capacity certification.

Results and full frozen audits (including exact inputs, seed, roles, rolls, damage, casualties and surviving encounter/final HP) are server-only. Unsupported versions, mechanics, relationships and multi-army topology are rejected explicitly. This module is not exported through the package entry point or connected to movement, persistence, APIs or participant projections. Existing movement encounters remain pending; there is no live combat or Turn 2. [PR #88](https://github.com/MightyMulligan-ops/strategy-game/pull/88) is the implementation under review, not a merged gameplay milestone.

## 7. Diplomacy, visibility, and intelligence

### Initial visibility baseline

Aim to reproduce atWar-style fog of war:
- Unit view ranges.
- Stealth and detection.
- Allied visibility sharing.
- Server-side filtering of player-specific state.

Advanced intelligence disciplines—strategic, operational, SIGINT, and HUMINT—are longer-term extensions, not initial requirements.

### Diplomacy baseline

The broader game should support peace, war, alliances, coalitions/teams, and configurable passage/hostility rules. Exact diplomacy state transitions and permissions need to be specified in a dedicated rules section before implementation.

## 8. Defense lines

Defense lines are separate geographic objects, not merely territory borders. Model at minimum:
- Owner/player.
- Geometry.
- Active/inactive status.
- Assigned or associated defending forces.
- Applicable territory/node references.
- Any modifiers, if confirmed by rules research.

Reference behavior observed: hostile units cannot pass an enemy defense line without attacking it; peace can permit passage. Exact creation, geometry, manning, and combat behavior still need verification. The game should use an original implementation and interface.

## 9. Configurability and game setup

### Approved initial public lobbies (004B.2A / Issue #7)

These are documented rules and contract validation only; working lobby storage, APIs, and UI remain unimplemented. See [MATCH_LOBBIES.md](MATCH_LOBBIES.md).

- Authenticated players with registered usernames can discover/view public lobby metadata. The creator is the host and first participant.
- Capacity is 2–40 slots including the host. Creation begins `OPEN`; `DRAFT` is reserved for future use. Only `OPEN` lobbies admit new participants.
- Duplicate joins are idempotent and consume no extra slot. An existing member retry can acknowledge membership after start without admitting a new player.
- Non-host participants may leave before start. The host cannot leave before start. Only the host may start, with at least two participants. No new joining or leaving occurs after start; the roster is then fixed.
- All match settings are immutable after creation. Quick means 1–12-minute turns; Casual means 12–48-hour turns, inclusive. Other valid positive-safe integer durations remain uncategorized.
- Initial presets are 5 minutes, 15 minutes, 1 hour, 12 hours, and 24 hours. The middle two are uncategorized. Presets do not restrict other valid durations.
- Era/scenario selection is unavailable. Empty-world fixtures are internal development tools only. Lobby metadata viewing grants no game spectator access.

### Broader future configuration

Desired game configuration includes:
- Public/private/password-protected access.
- Teams.
- Match duration and turn duration (turn duration is selected at creation and fixed for that match).
- Starting funds and countries.
- Join cutoff.
- Victory conditions.
- Era and map selection.
- Ruleset options and configurable balance values.

Configuration must be validated against schemas and supported module capabilities. It must not permit arbitrary executable code uploads.

## 10. Open design decisions

Do not silently settle these during implementation:

1. Exact movement range calculation for mixed-unit stacks.
2. Whether any mixed leaderless stack containing infantry is always immobile (current safe assumption: yes).
3. Exact supply generation, storage, consumption, replenishment, and shortage thresholds.
4. Supply transfer behavior when splitting, merging, capturing, or disbanding stacks.
5. Exact combat resolution, casualties, randomness, rounding, and tie-breaking.
6. Exact city income, recruitment, upkeep, and reinforcement formulas to adopt.
7. Defense-line creation UI, geometry, manning, and modifiers.
8. Full diplomacy transitions and passage rules.
9. Exact map projection, coordinate system, and map data licensing.
10. Whether primary leader specialization should remain inactive, particularly for a General.
11. Gameplay resolution phase order, simultaneous movement/contact conflicts, and explicit attack targeting/interaction with movement encounters. Player-relative move-number priority is approved; equal-number seeded sequential precedence is provisional.
12. In-match membership changes, surrender/elimination/late joining, and what to do if no active players remain. The current lifecycle requires a nonempty fixed active roster. Initial pre-start public lobby membership is approved in MATCH_LOBBIES.md; late joining, host transfer, and cancellation remain future decisions.
13. Scheduling of the next turn, downtime catch-up, clock corrections, pauses, and durable retry/acknowledgement behavior. These must preserve hybrid closure and offline progression.
14. Product limits for turn duration and order payload size. Current numeric validation enforces safe positive integer milliseconds, not approved balance limits.
15. Dependency cancellation policy (block versus cascading cancellation), failed/blocked movement handling, and production seed generation/storage/reveal. The current ordering helper executes none of these behaviors.

When a task depends on one of these, ask for a decision or implement only the unambiguous portion behind a clearly marked configuration boundary.

## 006D.1 approved starting armies (Issue #49)

New explicitly pinned `initial-armies-v1` matches initialize one Infantry-specialized Lieutenant plus five Infantry at each existing capital. Permanent spawn provenance is its Military Supplies node. The fixed starting-foot policy is geographic Euclidean 250 map units per turn, cumulative across numbered orders. Single leaderless Infantry radius remains unapproved/non-executable. Pure contact classification requires explicit diplomacy; no collision tolerance, movement, combat or encounter results execute. Future hostile convergence is intended to block both opposing stacks at last valid positions with an unresolved encounter. Full contracts and boundaries: [INITIAL_ARMIES.md](INITIAL_ARMIES.md). Earlier world-only sections continue to describe their legacy cohorts.

## 006D.2 movement drafts (Issue #51)

A new creation-pinned runtime accepts only whole-formation private movement drafts for the unchanged initial army. Numbering follows queue order; Euclidean distance is cumulative <=250, with integer destinations in actual map bounds. Drafts remain unready, actual positions stay immutable, and deadline rejection leaves the turn OPEN. No Ready/closure/execution/encounter/combat or new radius/contact rule is included. See [MOVEMENT_DRAFTS.md](MOVEMENT_DRAFTS.md).

## 006D.3 approved Ready lock and closure (Issue #59)

For new creation-pinned `turn-closure-v1` matches only, Ready locks order edits until explicit Unready. This supersedes the historical generic implicit-Ready-reset rule above for this cohort; old runtimes retain their original rules. Final Ready or server deadline atomically closes Turn 1 and freezes every last committed queue. A bounded in-process worker and authorized mutating requests observe deadlines; GET and browser countdowns remain observational. CLOSED does not execute movement or open Turn 2. See [TURN_CLOSURE.md](TURN_CLOSURE.md).

## 006D.4 movement resolution (Issue #61)

[MOVEMENT_RESOLUTION.md](MOVEMENT_RESOLUTION.md) specifies the new movement-resolution-v1 cohort, strict initial/frozen/result/resolved contracts, exact swept contact, strict-before-contact milliworld stopping, hostile-edge encounter components, atomic Turn 1 resolution and participant-only audit/event UI. Different active owners are hostile only in this new cohort. Historical runtimes remain unchanged. No combat, Turn 2, existing-environment migration or deployment is included.
