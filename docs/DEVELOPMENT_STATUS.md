# Development status

This is a short, evidence-based handoff, not a replacement for the rules or roadmap. Baseline: `main` at `a63dae7` (PR #31 squash merge). Feature work remains unmerged even when its tests pass.

| Area | State | Evidence / limitations |
|---|---|---|
| TypeScript monorepo and app foundations | Merged | React/Vite, Fastify, package boundaries, checks; no playable game |
| Turn contracts and lifecycle (002) | Merged | Simultaneous drafts, revisions, Ready/deadline closure; no scheduler |
| Deterministic resolution foundation (003) | Merged | Empty turns and movement-queue planning; no gameplay execution |
| PostgreSQL persistence (004A) | Merged | Committed migrations, transactional repositories, live integration tests |
| Accounts and sessions (004B.1) | Merged | Discord/Google adapters, sessions, account UI; real consent/deployment verification remains separate |
| Windows startup automation (005) | Merged | Dependency preparation and preflight; shared packages require restart |
| GitHub Actions CI (006 / Issue #1) | Merged | Application and PostgreSQL checks; owner configures branch protection |
| Local issue-to-draft-PR workflow (007 / Issue #2) | Merged | [PR #5](https://github.com/MightyMulligan-ops/strategy-game/pull/5), `963869a`; local sessions and metadata-only automation |
| Lobby contracts and documentation (004B.2A / Issue #7) | Merged | [PR #8](https://github.com/MightyMulligan-ops/strategy-game/pull/8), `b0164b7`; lifecycle, privacy, capacity, deadline-overflow contracts |
| PostgreSQL lobby persistence (004B.2B / Issue #9) | Merged | [PR #10](https://github.com/MightyMulligan-ops/strategy-game/pull/10), `df975a2`; migration is not approved for the existing development DB; 21 lobby tests / 38 repository tests |
| Authenticated lobby REST API (004B.2C / Issue #11) | Merged | [PR #12](https://github.com/MightyMulligan-ops/strategy-game/pull/12), `5cbd901`; five session-bound operations, safe envelopes and 45 live tests; existing development migration remains unapproved |
| Sovereign account/lobby UI and proxy (004B.2D / Issue #13) | Merged | [PR #14](https://github.com/MightyMulligan-ops/strategy-game/pull/14), `9a45f27`; branded account/lobby UI, original assets and same-origin proxy |
| Loopback local test sign-in (004B.2E / Issue #15) | Merged | [PR #16](https://github.com/MightyMulligan-ops/strategy-game/pull/16), `40c56a3`; explicit loopback/development gates, isolated fixtures and normal sessions/CSRF/lobby authorization |
| Lobby readiness and host start (005A / Issue #17) | Merged | [PR #18](https://github.com/MightyMulligan-ops/strategy-game/pull/18), `280b7fa`; serialized readiness/host/count checks and lifecycle-only start, Open/Started discovery; no world or turn initialization |
| Pure territory world foundation (005B.1 / Issue #20) | Merged | [PR #21](https://github.com/MightyMulligan-ops/strategy-game/pull/21), `e3e4a22`; approved generator/contracts and local balance guarantees, 67 generator tests |
| Persisted initial world and SVG map (005B.2 / Issue #22) | Merged | [PR #23](https://github.com/MightyMulligan-ops/strategy-game/pull/23), `432f37b`; immutable JSONB initial archive, atomic guarded start, participant-only projection/API and SVG inspector; legacy worldless matches remain UNINITIALIZED |
| Legacy world-unavailable messaging (005B.3A / Issue #24) | Merged | [PR #25](https://github.com/MightyMulligan-ops/strategy-game/pull/25), `a76be4b`; frontend-only explanation for legacy RUNNING matches, which remain UNINITIALIZED; no automatic or host-triggered initialization is authorized |
| Read-only map accessibility (005B.3B / Issue #26) | Merged | [PR #27](https://github.com/MightyMulligan-ops/strategy-game/pull/27), `17804c5`; focused accessibility/state regressions and static-mock Chromium checks. Existing manual acceptance limitations remain in INITIAL_WORLD.md; no deferred accessibility enhancements are included in 006A |
| Participant-authorized turn boundary (006A / Issue #28) | Merged | [PR #29](https://github.com/MightyMulligan-ops/strategy-game/pull/29), `324b11b`; strict participant-authorized read/Ready fixture API and own-player projection. Requires explicit fixture injection and NODE_ENV=test; no production wiring or durable acknowledgement |
| Pure initial-world Turn 1 foundation (006B.1 / Issue #30) | Merged | [PR #31](https://github.com/MightyMulligan-ops/strategy-game/pull/31), `a63dae7`; confirmed merged in GitHub before Automation 008. Pure server-only foundation; atomic persisted initialization and production integration remain unimplemented. See TURN_SYSTEM.md; no gameplay code or contract is changed by Automation 008 |
| Read-only PR summaries / CI diagnostics (Automation 008 / Issue #32) | In progress | `issue/32-pr-review-diagnostics`, from latest `a63dae7`; trusted-main read-only workflow, head/base/CI-attempt evidence validation, protected path/rename flags, privacy-projected diagnostics, advisory test counts and a human-started review/repair prompt. Frozen install/build/typecheck/lint and 701 unit/security tests passed (61 new); actionlint passed all three workflows. The 73 DB assertions were skipped locally; no verified disposable local DB was available and no existing DB was probed. Existing CI/status automation, gameplay/contracts, dependencies and databases unchanged. Offline synthetic draft/failure preview inspected; live report requires human merge to main. See PR_REVIEW.md |
| Match authorization, command APIs, scheduler | Planned | Next Phase 0B work; account authentication does not grant match permissions |
| Map, gameplay, leadership, Military Supplies | Planned | Rules remain in GAME_DESIGN.md; no claim of implemented gameplay |

## Update policy

1. At task start, record the issue and branch as **in progress** after verifying the approved scope and existing claim. At draft PR creation, record the real PR link and **in review / unmerged**. Record **blocked** only with the exact unresolved decision/dependency and owner action needed.
2. Update this file in every task PR when behavior, milestone progress, verification, or next steps change. Update the roadmap/rules/interfaces too when those authoritative documents are affected; status labels alone cannot change game design.
3. Record commands actually run, their results, and material limitations in the PR. Never infer test success, real OAuth verification, capacity, or completion from placeholder code, labels, or a passing unrelated check. Do not include secrets, local `.env`, OAuth URLs, or hidden player state.
4. Mark a milestone **merged** only after confirming the merge on `main`, citing the merged PR/commit. A later task can record the preceding task's confirmed merge. A feature branch may describe its own work as implemented/in review, but must not mark itself merged or automatically check roadmap items as complete before human merge.
5. Keep open design decisions explicit. Labels show coordination state; GitHub PR state and merged code are the completion evidence. A closed issue without merged implementation is not proof of delivery.
6. No workflow edits this file, creates code, starts Codex, merges, or deploys. The local human-initiated session maintains it, and a person reviews the change. Avoid percentages and invented completion dates.

## Next planned development slice

Review Automation 008's draft and security/evidence limits; its workflow becomes live only after human merge, with no autonomous repair. Gameplay follow-up remains unchanged: runtime assignment, atomic Turn 1 insertion/SQL guards and version-aware restoration need separate approval/disposable CI verification. Production 006A wiring, world-aware freezing/resolution, durable acknowledgements and offline progression remain unimplemented. Parent #19 remains open; legacy RUNNING worlds remain UNINITIALIZED with no initialization authorized. Existing databases, lobby start and gameplay remain unchanged.
