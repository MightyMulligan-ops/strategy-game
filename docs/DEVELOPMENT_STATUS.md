# Development status

This is a short, evidence-based handoff, not a replacement for the authoritative rules or roadmap. The baseline below is checked against `main` at `3834fd6` (Assignment 006 squash merge). New work in a feature branch remains unmerged even when its tests pass.

| Area | State | Evidence / limitations |
|---|---|---|
| TypeScript monorepo and app foundations | Merged | React/Vite, Fastify, package boundaries, checks; no playable game |
| Turn contracts and lifecycle (002) | Merged | Simultaneous drafts, revisions, Ready/deadline closure; no scheduler |
| Deterministic resolution foundation (003) | Merged | Empty turns and movement-queue planning; no gameplay execution |
| PostgreSQL persistence (004A) | Merged | Committed migrations, transactional repositories, live integration tests |
| Accounts and sessions (004B.1) | Merged | Discord/Google adapters, sessions, account UI; real consent/deployment verification remains separate |
| Windows startup automation (005) | Merged | Dependency preparation and preflight; shared packages require restart |
| GitHub Actions CI (006 / Issue #1) | Merged | Application and PostgreSQL checks; owner configures branch protection |
| Local issue-to-draft-PR workflow (007 / Issue #2) | In progress, unmerged | `issue/2-codex-workflow`; metadata automation becomes live only after owner merge |
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

After this tooling handoff, select a focused Phase 0B issue for match membership authorization and authenticated command handling, then durable acknowledgement/retry behavior and offline scheduling/recovery. Resolve the documented design questions before affected gameplay work. See [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) and [CODEX_WORKFLOW.md](CODEX_WORKFLOW.md).
