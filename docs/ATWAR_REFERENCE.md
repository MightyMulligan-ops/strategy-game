# atWar Reference Notes and Research Audit

**Purpose:** Track reference observations that inform broad gameplay requirements. This is not a specification to copy proprietary implementation details. The project must use original code, assets, maps, branding, and wording.

**Research status:** Partial. The official FAQ index and selected articles have been reviewed in earlier research, but the full FAQ has not been exhaustively audited. Treat every item below according to its confidence label.

## 1. Reference sources

- Official FAQ index: https://atwar-game.com/faq.php
- Official game homepage: https://atwar-game.com/
- Official feature description: https://atwar-game.com/features.php

Earlier research also located community-maintained atWar data/reference material. Community material is useful for cross-checking but is not authoritative and may be incomplete or outdated.

## 2. Observed reference mechanics

The following points were reported from selected official FAQ/feature pages during project research. Re-verify the exact wording, current behavior, and applicability before treating detailed values as implementation requirements.

### Map and match

- Browser-based strategy game with simultaneous turns.
- Free geographic troop movement rather than movement only between adjacent territories.
- Custom maps/scenarios and a map editor are part of the broader feature set.
- Public descriptions have shown inconsistent player-capacity claims: one official page described up to 20 players while another feature description described up to 40. Do not assume either is a guaranteed current limit. This project uses 40 as a target to validate through testing.

### Economy and recruitment

Selected FAQ research reported:
- Cities generate income.
- City income depends on location/ownership and can grow over time.
- Population influences income and recruitment/reinforcements.
- Capital control is relevant to city purchase/recruitment rules.
- Naval units are recruited only at ports.
- Unit upkeep is charged over time.
- Reinforcements may occur at the start and periodically (one selected FAQ result described every four turns).

Selected reported income progression values included:
- A city on a player's own territory starts at 50% income, increases by 25% weekly until 100%, then by 2% until 150%.
- A city on foreign territory starts at 10% and increases by 5% weekly up to 50%.

These values are reference observations, not yet adopted project rules. Confirm the exact rules, timing, exceptions, and whether the pages remain current before implementation.

### Movement and visibility

Selected FAQ research reported:
- Units have movement ranges and visibility/view ranges.
- Group movement may use a group-level range calculation; exact behavior needs re-verification.
- Stealth and detection exist.
- Allied visibility is part of the broader visibility model.

### Diplomacy and combat

Selected FAQ research reported:
- Diplomacy includes states such as peace, war, and alliance.
- Diplomacy affects passage and hostile interaction.
- Combat resolution is described in official FAQ material.
- Battle reports/playback and strategies/upgrades are part of the broader feature set.

### Defense lines

Selected reference material reported:
- Hostile units cannot pass an enemy defense line without attacking it.
- Peace may permit passage.
- Exact geometry, placement, creation interface, manning, and combat effects have not been fully verified.

## 3. Data research

A community-maintained atWar data table was found during research. It exposed fields such as city names, country, reinforcements, income, and port designation. Exact raw population values per city were not verified from that source.

The official game description has referred to population/GDP as factors in the map/economy. Do not claim access to atWar's internal population dataset.

For original project data, evaluate properly licensed or open population sources such as GHSL, WorldPop, and World Bank datasets. Document license, attribution, resolution, year, and any aggregation method. Do not assume these datasets are interchangeable.

## 4. Items requiring further audit

- Complete FAQ coverage, including every relevant unit, strategy, economy, combat, movement, visibility, and diplomacy article.
- Current maximum player count and match/turn timing options.
- Exact movement and mixed-stack range formulas.
- Exact combat formula, casualty ordering, rounding, randomization, and tie-breaking.
- Exact city income progression and timing.
- Exact population-to-income and population-to-reinforcement formulas.
- Capital ownership and city purchase/recruitment restrictions.
- Upkeep calculation and payment schedule.
- Reinforcement timing and exceptions.
- Defense line geometry, creation, manning, and passage behavior.
- Stealth/detection formulas and allied visibility rules.
- Strategy point generation, upgrades, rare units, and auto-production.
- Map editor capabilities and supported import/export formats.

## 5. Research discipline

For each researched mechanic:
1. Record the exact source URL and access date in a follow-up audit.
2. Distinguish official documentation from community observations.
3. Record whether the behavior was directly confirmed, inferred, or remains ambiguous.
4. Do not silently turn an observation into a project rule.
5. The project owner approves which reference mechanics become our own rules.
