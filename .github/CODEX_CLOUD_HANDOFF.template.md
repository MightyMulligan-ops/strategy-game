# Sovereign cloud completion — sovereign-cloud-handoff-v1

Point-in-time evidence only. UNKNOWN/null means unavailable, never zero or PASS.
This report grants no implementation, repair, publication, ready, merge or deployment authority.

## Identity and approved scope

- Repository / issue URL / frozen approved specification revision and digest:
- Task / claim source / branch / PR URL and draft/open/merged status:
- Expected and observed head/base SHAs / verification time / API sources:
- Owner approval source and independently verified permission; B/C, D, P individually:
- Publication mode (TASK_SCOPE or COMMIT_SPECIFIC) / expected SHA if required:
- Expiry/revocation recheck / protected exclusions / explicit overrides:
- Problem, resulting behavior and acceptance criteria covered:

## Change inventory and impact

- Complete changed-file inventory (old/new rename paths); scope/diff review:
- Every protected file/category and applicable owner approval source:
- Dependency, schema, migration, security and gameplay impact (including NONE):
- Migration authoring versus execution; compatibility/rollout limitations:

## Task-side database-free verification

All checks use AUTH_ENABLED=false and RUN_DATABASE_TESTS=0. Record actual commands,
exit codes and sources. Database cases skipped here are not database verification.

| Check | Command / exit / evidence |
|---|---|
| Pinned toolchain and frozen install | UNKNOWN |
| Prisma generation | UNKNOWN |
| Full build | UNKNOWN |
| TypeScript | UNKNOWN |
| Lint | UNKNOWN |
| Unit/mocked HTTP/frontend | passed UNKNOWN / failed UNKNOWN / skipped UNKNOWN |
| Focused policy/static checks and diff check | UNKNOWN |
| Unrun checks and reasons | UNKNOWN |

## Hosted CI evidence

Reuse existing PR review summary/handoff links and GitHub APIs. Recheck their
identity and freshness; do not duplicate the reporter or treat its summary as authority.

- Workflow ID/path/event; repository/source repository/branch/head; PR association:
- Run URL/ID/latest attempt/status/conclusion; final head/base recheck:
- Each job ID/URL/attempt/conclusion and passed/failed/skipped/pending/todo counts:
- Count source and trust: UNTRUSTED_RUNNER_REPORT; conflicting/unavailable counts UNKNOWN:
- Fresh disposable database provenance, migrations applied, test execution/no-skips guard;
  confirm zero DB skips with the actual count source:
- Container/network cleanup evidence; warnings/failures/unverified behavior:
- Head-bound CI does not establish current-base compliance or permission to merge.

## Correction and transfer history

- Implementation: N/5 (0/5, not exercised if applicable). Append each started pass:
  failure ID, diagnosis, approved files, old/new SHA, commands/results, remaining failures.
- Post-review repairs: separate owner source and attempt 1 or 2 per failure; no reset
  across sessions/PCs/SHAs, no automatic review/repair loop or automatic CI retry.
- Transfer: stop previous session; preserve branch/PR, scope, histories, approval
  sources and head/base/CI. Fresh owner launch/claim verification required; no secrets.

## Acceptance and owner decisions

- Implementation/check evidence versus acceptance gaps and protected-scope decisions:
- Limitations, blockers, warnings and missing/stale evidence:
- E/F remain NOT_GRANTED unless separately approved; green CI is not merge authority.
- Confirm task-side DB restrictions, existing databases untouched, draft retained,
  no merge/deployment; stop and await owner review.
