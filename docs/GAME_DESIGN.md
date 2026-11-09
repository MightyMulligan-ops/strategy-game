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
- Combat may begin when a movement order encounters hostile forces, subject to diplomacy and combat rules. The interface should also support an explicit attack command.
- Defense lines are separate geographic objects. Hostile units cannot pass an enemy defense line without attacking it; peace may permit passage. Exact geometry, placement, and UI details need further reference verification.

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

Desired game configuration includes:
- Public/private/password-protected access.
- Teams.
- Match duration and turn duration.
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

When a task depends on one of these, ask for a decision or implement only the unambiguous portion behind a clearly marked configuration boundary.
