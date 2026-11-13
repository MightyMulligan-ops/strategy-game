# Sovereign cloud completion — sovereign-cloud-handoff-v1

This is a **historical** worked handoff for completed Issue #51, collected at
`2026-11-13T05:06:19.189Z` for Automation 011. **No authority carries forward** to
Issue #53, another issue, task, publication or repair. It is documentation, not a
live acceptance decision. The existing read-only collector supplied the appendix;
no reporter/workflow/permissions were changed, and no workflow was dispatched.

## Identity and approved scope

- Repository: MightyMulligan-ops/strategy-game; [Issue #51](https://github.com/MightyMulligan-ops/strategy-game/issues/51).
- Branch: `issue/51-movement-drafts`; [PR #52](https://github.com/MightyMulligan-ops/strategy-game/pull/52).
- Observed state at collection: **merged**, not draft. Merge commit:
  `f2b8fc2f72438c8594c174bb51390c7b352f65d8`. The earlier Gate D report observed a draft;
  that historical draft status must not override the current merged field.
- Expected/observed source head: `07a72a27edb121c57aac5ed601b125ef83cc782c`;
  expected/observed PR base: `cb088ec5e8f2c103f026760b19de7023152a7cfa`.
- Approval source: the historical owner's active-chat Issue #51 implementation,
  narrowly scoped corrective pass, and **Corrective Commit Publication & Gate D**
  messages. Those separate grants are described in the committed
  [status record](https://github.com/MightyMulligan-ops/strategy-game/blob/07a72a27edb121c57aac5ed601b125ef83cc782c/docs/DEVELOPMENT_STATUS.md).
  The private chat source cannot be independently reauthenticated from this sample;
  source permission verification beyond that preserved history remains UNKNOWN.
- Publication mode was COMMIT_SPECIFIC at the exact source head above. The approval
  ended with that task; no current operations are granted. E/F: **NOT_GRANTED by
  this report**. Subsequent owner merge is an observed separate GitHub action.
- Approved implementation: creation-pinned Turn 1 movement drafts, <=250 cumulative
  distance, unchanged starting formation/world positions, revision/history storage,
  own-only session/CSRF API and accessible planned routes. Frozen acceptance criteria
  are in Issue #51. A frozen-spec digest was not retained in the earlier handoff:
  UNKNOWN, not reconstructed as supposed past approval evidence.

## Change inventory and impact

The appendix lists all **43/43** files. Protected categories include authoritative
contracts/runtime/gameplay policy, participant/session API, SQL migration and agent
status documentation; compare each with the Issue #51 owner scope and preserved
approval sources above. This sample is not a new independent complete diff review.
No dependencies, Prisma models, world generator, CI workflows or repository settings
changed. One additive migration, `202611130002_movement_drafts`, added version-scoped
SQL guards; no existing match backfill, runtime upgrade, movement execution or schema
model rewrite. Existing-environment migration/deployment remains unverified and
requires separate authorization. Prior applied checksums must never be repaired by
this report.

## Task-side database-free verification

Historical corrective task checks used AUTH_ENABLED=false and RUN_DATABASE_TESTS=0.
Pinned pnpm 12.18.0 frozen installation, Prisma Client 7.10.1 generation, full build,
TypeScript, lint and git diff --check all exited 0. `pnpm test` reported **1205 passed,
0 failed, 191 skipped**, across 44 passed/11 skipped files. The six new SQL regression
cases were authored/compiled and deliberately skipped locally. These counts are the
preserved task record, not new test execution by the documentation task.

## Hosted CI evidence

- Workflow 414147274 / `.github/workflows/ci.yml`; event `pull_request`; same source
  repository and branch as above; explicit association with PR #52. API provenance
  was checked by the existing collector and head/base/run/attempt rechecked.
- [Run #76](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43367835657),
  ID 43367835657, latest attempt **1**, completed/success, exact source head above.
- Application job **131696343544**: **1205 passed / 0 failed / 191 skipped / 0 pending /
  0 todo**. Installation/build/TypeScript/lint passed.
- PostgreSQL job **131696343230**: **191 passed / 0 failed / 0 skipped / 0 pending /
  0 todo**, 11 files. Actual file totals: **159 historical + 32 movement/regression**
  (30 persistence, 2 live HTTP; original 26 + six regression cases). Count trust:
  **UNTRUSTED_RUNNER_REPORT**, linked to each job in the appendix, not PR prose.
- All eight migrations applied to newly provisioned PostgreSQL 17, including revised
  `202611130002_movement_drafts`. The CI report guard confirmed all 191 tests executed
  with no skips. Initializations for 2/4/10/40 players, immutable world/snapshot/Turn,
  revisions/concurrency, rollback, authorization and historical isolation passed.
- Cleanup evidence: the job's successful **Stop containers** step and log entries
  for container removal and job-network removal. No existing database was used.
- The earlier task inspected logs for migration/cleanup evidence; collector counts
  alone do not establish those facts. It also verified the standard PR merge checkout
  `450aad606c919ff7f30ba4a18f6f972a239e30c6` had the same source tree as the approved
  head. Container/runner hosting lifecycle beyond recorded cleanup is GitHub-managed.
- Warnings: existing pg overlapping-query deprecation, disposable initdb local trust,
  and pnpm pixi.js skill approval notice. No retry, existing-DB migration or deployment.

## Correction and transfer history

Initial implementation used **5/5** bounded passes. Initial run #75 failed 25 new cases
in fixture initialization (`NEW.stateVersion` on MatchWorld); that failure remains in
history. After the exhausted budget, the owner separately approved **one** narrow
corrective pass, then exact-SHA publication/Gate D. Run #76 passed; it was not an
automatic retry. No additional review repair was initiated by this report. The
separate two-human-attempt-per-failure review policy stays unchanged, and no transfer
or new SHA resets either history. Any future failure needs applicable owner authority.

## Acceptance and owner decisions

PR #52 is now merged by its owner; green CI itself did not authorize that merge.
Production/existing-environment migration, deployment and a future milestone were
not authorized or verified. Scope snapshot/independent review limitations above
remain visible. This sample performs no repair, merge, deployment or new task.

## Existing read-only evidence appendix

# PR review summary: #52

[Pull request](https://github.com/MightyMulligan-ops/strategy-game/pull/52) · head `07a72a27edb121c57aac5ed601b125ef83cc782c`
Base: `cb088ec5e8f2c103f026760b19de7023152a7cfa` · state: **merged**

Metadata and CI evidence only. Green CI does not establish semantic correctness or authorize protected changes.

Issue relationship: not validated; inspect manually.

## Changed files (43/43 fetched)
Path inventory complete.

| Path | Change | + / - |
|---|---|---|
| `README.md` | modified | 1 / 1 |
| `apps/server/src/app.ts` | modified | 4 / 0 |
| `apps/server/src/index.ts` | modified | 4 / 4 |
| `apps/server/src/turns/movement-routes.ts` | added | 52 / 0 |
| `apps/server/tests/lobby-fixture.ts` | modified | 3 / 2 |
| `apps/server/tests/movement-draft.test.ts` | added | 97 / 0 |
| `apps/server/tests/movement-drafts.integration.test.ts` | added | 88 / 0 |
| `apps/web/src/App.css` | modified | 8 / 0 |
| `apps/web/src/MovementQueue.test.tsx` | added | 164 / 0 |
| `apps/web/src/MovementQueue.tsx` | added | 121 / 0 |
| `apps/web/src/WorldView.test.tsx` | modified | 3 / 1 |
| `apps/web/src/WorldView.tsx` | modified | 18 / 4 |
| `apps/web/src/movement-api.ts` | added | 50 / 0 |
| `database/README.md` | modified | 4 / 0 |
| `database/prisma/migrations/202611130002_movement_drafts/migration.sql` | added | 422 / 0 |
| `database/src/formation-read-repository.ts` | modified | 1 / 1 |
| `database/src/index.ts` | modified | 1 / 0 |
| `database/src/lobby-repository.ts` | modified | 8 / 6 |
| `database/src/movement-draft-repository.ts` | added | 118 / 0 |
| `database/src/movement-draft-storage.ts` | added | 44 / 0 |
| `database/src/turn-read-repository.ts` | modified | 1 / 1 |
| `database/src/turn-storage.ts` | modified | 18 / 8 |
| `database/tests/army-creation.test.ts` | modified | 4 / 4 |
| `database/tests/lobby-start.test.ts` | modified | 4 / 3 |
| `database/tests/movement-draft-fixture.ts` | added | 27 / 0 |
| `database/tests/movement-draft-migration.test.ts` | added | 19 / 0 |
| `database/tests/movement-draft-repository.test.ts` | added | 122 / 0 |
| `database/tests/movement-drafts.integration.test.ts` | added | 185 / 0 |
| `database/tests/turn-storage.test.ts` | modified | 3 / 2 |
| `docs/DEVELOPMENT_ROADMAP.md` | modified | 4 / 0 |
| `docs/DEVELOPMENT_STATUS.md` | modified | 148 / 2 |
| `docs/GAME_DESIGN.md` | modified | 4 / 0 |
| `docs/INITIAL_ARMIES.md` | modified | 4 / 0 |
| `docs/MOVEMENT_DRAFTS.md` | added | 59 / 0 |
| `docs/TECHNICAL_ARCHITECTURE.md` | modified | 4 / 0 |
| `docs/TURN_SYSTEM.md` | modified | 4 / 0 |
| `packages/game-engine/src/index.ts` | modified | 1 / 0 |
| `packages/game-engine/src/movement-drafts.ts` | added | 70 / 0 |
| `packages/game-engine/src/resolution.ts` | modified | 2 / 2 |
| `packages/game-engine/tests/movement-drafts.test.ts` | added | 113 / 0 |
| `packages/shared-types/src/index.ts` | modified | 4 / 0 |
| `packages/shared-types/src/movement-drafts.ts` | added | 64 / 0 |
| `packages/shared-types/src/server.ts` | modified | 22 / 0 |

## Protected changes

- Authorization/server boundary: compare with explicit owner-approved scope; escalate if not covered.
- Database schema/migrations: compare with explicit owner-approved scope; escalate if not covered.
- Gameplay/architecture contracts: compare with explicit owner-approved scope; escalate if not covered.

## CI evidence for this head

[CI run](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43367835657) · attempt 1 · conclusion: **success**

- [Application checks](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43367835657/job/131696343544): **success**.
  CI log reports 1205 passed, 0 failed, 191 skipped, 0 pending, 0 todo (1396 total). This is untrusted runner-reported evidence, not an independent execution audit.
- [PostgreSQL integration tests](https://github.com/MightyMulligan-ops/strategy-game/actions/runs/43367835657/job/131696343230): **success**.
  CI log reports 191 passed, 0 failed, 0 skipped, 0 pending, 0 todo (191 total). This is untrusted runner-reported evidence, not an independent execution audit.

## Evidence limitations

- CI association recovered through a unique commit-to-PR lookup; exact repository, workflow, current head and source branch verified.

## Human-started handoff

Use [.github/CODEX_REVIEW_PROMPT.md](https://github.com/MightyMulligan-ops/strategy-game/blob/main/.github/CODEX_REVIEW_PROMPT.md) for PR #52. Verify its current head before work. No summary or CI failure starts Codex or authorizes a repair, commit, merge or deployment.
