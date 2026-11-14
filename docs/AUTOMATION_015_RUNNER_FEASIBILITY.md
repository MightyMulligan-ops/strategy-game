# Automation 015 Stage 2 — persistent runner feasibility

Status: **SUPPORTED IN PRINCIPLE, NOT ENABLED**. This document does not authorize API spending or agent execution.

## Verified path

OpenAI publishes `openai/codex-action@v1`, a supported GitHub Actions integration that executes `codex exec` with configurable sandbox/permission profile and a Responses API proxy. The documented default authentication method requires an **OpenAI API key** stored as a GitHub Actions secret. The action's execution incurs API usage subject to separate API billing; a ChatGPT subscription alone does not establish API credits or permission to incur charges. See:
- https://learn.chatgpt.com/docs/github-action
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://github.com/openai/codex-action

GitHub Actions provides the durable job coordinator, not a permanently running AI process. A job is bounded and can be resumed by new workflow runs using durable external state. The repository currently has `ci.yml`, `issue-status.yml` and `pr-review.yml`. No Codex runner or configured API credential was verified.

## Proposed safe deployment topology

1. Trusted owner explicitly launches a workflow with a fixed issue/task ID, source commit, allowed paths, expiry and operation budget. No free-form PR/issue text becomes a privileged instruction.
2. Trusted-main workflow checks the independently authenticated owner grant, revocation, stable task claim, signed audit checkpoint and budgets. If any evidence is unavailable, **stop**.
3. Read-only `contents: read` job checks out an exact immutable commit, sets up dependencies **before** any model credentials become accessible, and invokes `openai/codex-action` with least privilege. Do not give the Codex job GitHub write credentials.
4. Capture a sanitized patch artifact. A separate privileged publisher job verifies patch paths, base SHA, signed checkpoint and current revocation again before creating a PR. No agent-provided commands execute in the privileged publisher.
5. Run ordinary CI and independent review. Repair is bounded to the stable failure ID; every start is durably recorded before execution. Never auto-merge until the owner-authorized criteria are verified.
6. Save an owner-visible outcome and immutable external checkpoint. Uncertain append or missing notification must not cause an automatic duplicate attempt.

## Activation gates

- An owner-provisioned API key and **explicit API cost ceiling** or separately verified no-additional-cost auth.
- Confirmed repository Actions permissions and ability to restrict secrets to a trusted job.
- Trusted audit storage, independent checkpoint anchor and secret-key custody. The PostgreSQL adapter is code only; its schema has not been deployed.
- An authenticated owner-grant verifier, revocation mechanism, task claim and publisher identity.
- Tests of fork/PR prompt injection, concurrency, budget exhaustion, credential isolation, revocation and network failures.
- A bounded dry run with **no secrets** followed by a separately approved cost-limited sandbox run.

## Current decision

Do not activate a workflow or configure a billable model key yet. Continue developing testable coordinator/ledger components without broadening GitHub permissions. This is the most direct supported technical path, but it is not free or operational by default.
