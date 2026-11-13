# Copyable owner approval — unfilled, NOT GRANTED

The owner must deliberately fill and publish this record in the named issue or
active owner chat. Copying it, applying a label or filling JSON grants nothing.

Repository: MightyMulligan-ops/strategy-game
Issue: <one positive issue number and URL>
Frozen approved specification: <issue revision/time, acceptance criteria and exclusions;
retain a sanitized snapshot/digest so later edits cannot expand this approval>
Approval source / owner / time: <permalink or identifiable active-chat message>
Task/claim: <one owner-started task; branch and existing PR if resuming>

I explicitly authorize **B/C + D + P together for this issue only**:

- B/C: implement the frozen approved scope, author only its expressly approved
  additive SQL if applicable, run database-free verification, and use at most
  five bounded in-task correction passes with append-only history.
- D: run unchanged hosted CI using newly provisioned disposable PostgreSQL only,
  including committed test migrations there and verified container cleanup.
- P: create/resume one issue feature branch, push its reviewed task-scope commits,
  and create/update exactly one draft PR targeting main. Check the current head,
  scope, claims and approval before every CI-triggering update. No automatic CI retries.

Publication mode: <TASK_SCOPE, or COMMIT_SPECIFIC with exact 40-character SHA>.
Expiry: <owner-selected UTC time or this task's completion/transfer/closure>.
Revocation: owner revocation is immediate; ambiguous sources, scope changes,
competing claims or changed commit-specific identity stop the affected operation.

E (ready/merge) and F (existing-environment migration/deployment): **NOT GRANTED**.
No existing database access or credentials, task-side migrations/PostgreSQL/Docker,
new dependencies, CI/settings/permission changes, major architecture/gameplay
expansion, deployment or automatic merge. Such work needs its own explicit approval.
The local VS Code fallback and separate two-owner-initiated-attempt repair policy
remain unchanged. This approval covers no future issue and starts no task.
