# Future delegation policy proposal — version 1

**Option B disposition (2026-11-15): deferred reference.** The custom Stage 2 delivery track [#68](https://github.com/MightyMulligan-ops/strategy-game/issues/68) / [#69](https://github.com/MightyMulligan-ops/strategy-game/pull/69) is closed as superseded; its branch is retained. [#79](https://github.com/MightyMulligan-ops/strategy-game/issues/79) owns streamlined worker delivery. This document remains disabled design history, not a prerequisite to build every proposed service and not authority to weaken existing controls. See [the audit](OPTION_B_AUDIT.md).

**Status: DISABLED / DESIGN ONLY / NOT AUTHORIZED.** Issue #63 approves documenting this proposal, not activating it. No code consumes this document as a grant, configuration switch or task trigger. Existing owner-started operations remain unchanged. No standing permission is introduced.

## Potential low-risk eligibility

A separately approved future design could delegate GET-only collection of already-authorized repository metadata, source/digest comparisons, deterministic evidence summaries, bounded proposal preparation and owner notifications. These actions must use trusted-main code, bounded inputs, least privilege and sanitization. They must not execute PR code, interpret prose as instructions, resolve protected scope or imply independent code review. Automatic fixture checks or code execution need their own scoped design/authorization even when called low-risk.

Implementation, code-review agent invocation, repair invocation and CI-triggering publication remain owner-controlled under the current policy. Ready/merge, existing-environment migration/deployment, credential/permission changes, gameplay/schema/contracts, new dependencies and workflow changes require separate named owner decisions. There is no default delegation of E/F or permission to restart a two-attempt failure.

## Bounds and provenance required before enabling anything

- Freeze one repository/issue/task/claim/scope, exclusion list and operation-specific owner grant, with independently authenticated owner identity/permission, source, time, expiry and revocation checks. JSON, labels, issue prose, artifacts and generated prompts remain untrusted evidence.
- Preserve an append-only durable ledger through task/PC/session/HEAD changes. Five bounded implementation corrections per approved stable task; two separately owner-initiated repairs per stable failure. Keep failed/uncommitted attempts. Transfers stop the previous session and require renewed owner launch without a counter reset.
- Notify the owner before proposed execution and at completion/failure, with exact source/base/run/attempt, changed inventory, counts, remaining budgets and provenance. Missing or contradictory evidence, scope drift, revoked/expired grants, a competing claim, unexpected dirty tree, unavailable integrations or exhausted attempts stop the affected operation and notify the owner. Do not automatically retry CI or invent a new task/failure ID.
- Default expiry at task completion, transfer, issue closure, revocation or scope change; support explicit earlier expiry. A receipt or report cannot renew itself. Revocation must be checked immediately before any side effect, not only at launch.
- Preserve sanitized audit links, independent reviewer identity, grant sources and complete original ledgers. Never log credentials, signed URLs, raw private player state or transfer `.env`/Codex sessions. Notification delivery does not grant authority.

## Required integrations and feasibility gaps

Currently verified in this repository: owner-started published Codex Cloud tasks; read-only GitHub evidence collection from trusted main; deterministic fixture-based orchestration; the existing unchanged CI with a fresh disposable PostgreSQL service when explicitly approved. The reporter has no write permission and no model/agent invocation integration. A generated review request is text, not an integration.

Any future unattended invocation would require separate owner approval **and** technical validation of an officially supported Codex/GitHub integration: authenticated task invocation, entitlement/usage/cost controls, exact source binding, bounded concurrency, durable idempotency, secure cancellation/revocation, lifecycle callbacks, isolation, audit/history transfer, independent-review provenance and failure notifications. No such invocation API, ChatGPT-session reuse, GitHub token scope or billing entitlement is demonstrated or assumed here. Platform availability and limits must be verified at design time; do not substitute shell model calls, API keys, browser/session scraping or a new paid service.

If a supported integration needs workflow triggers, broader permissions, secrets, paid usage, an external queue/service or new settings, stop for a separate protected-scope approval and security review. This milestone creates none of them. A later proposal must identify actual supported mechanisms and tests before an owner may choose to enable a narrowly bounded policy. There is intentionally no enable switch in version 1.
