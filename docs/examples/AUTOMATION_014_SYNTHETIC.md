# Automation 014 synthetic walkthrough

**SYNTHETIC FIXTURES ONLY.** These identifiers, owner receipts, independent findings, CI/migration markers and outcomes are fabricated offline test data. They are not live owner approvals, code reviews, PostgreSQL execution or evidence about a real PR.

The executable scenario is the test named `demonstrates synthetic review→finding→proposal→new-head invalidation→revalidation→advisory READY with transfer history` in `scripts/tests/pr-orchestration.test.ts`. It reuses the Automation 012 acceptance fixture and Automation 009 structured-review template rather than a parallel collector/schema.

| Stage | Fixture evidence | Deterministic result |
|---|---|---|
| Evidence and manual independent-review receipts | Synthetic issue 32 / PR 33; head `aaaa…` (40 a characters); base `cccc…`; CI 100/1, jobs 201/202; green facts; matching independent READY review and empty verified history | READY, advisory only; E/F and repair NOT_GRANTED |
| Independent confirmed finding | Stable `SYNTHETIC-DEFECT-001`, HIGH, blocking, exact-source `docs/CI.md` reference, reviewer correction/verification data | CHANGES_REQUESTED; one bounded attempt-1 proposal, ownerApprovalSource NOT_GRANTED; no execution |
| Owner-controlled repair boundary | An actual owner would need to separately authorize the named finding, paths, HEAD/base, attempt and delivery under CODEX_REPAIR_PROMPT.md | The example starts no repair; a supplied valid synthetic receipt can be recorded but grants no programmatic execution |
| Simulated repair and transfer | Append attempt 1 to retained history, including old/new SHA and source; append transfer reference; proposed new source `bbbb…`, run 101, jobs 301/302 | Old source-bound evidence returns UNKNOWN; it is not carried over to the new HEAD |
| Fresh evidence and review | Refresh source, checkout, run/job references, independent review and owner observations; preserve prior history as an exact prefix | READY advisory recommendation; one retained repair/transfer; no new repair proposal or E/F grant |

The complete test suite also exercises failed/UNKNOWN evidence, identity/attempt drift, contradictory reports, rename/protected scope, injection/credentials, revoked/expired/missing grants, 5/2 exhaustion and missing/rewritten histories. A real owner must corroborate receipts, retain actual history and request the real independent review; this walkthrough grants nothing.
