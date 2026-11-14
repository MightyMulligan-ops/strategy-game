# Sovereign autonomous Codex pipeline — control-plane candidate

**DRAFT / IN REVIEW / LIVE LAUNCH BLOCKED.** Issue #79 covers infrastructure; Issue #76 is the intended first gameplay pilot. The current owner request authorizes implementation, tests, commits, draft PRs and a paid pilot only when security and the $45 cutoff are satisfied. Merge, deployment, production/existing databases and security bypass remain prohibited. PR #78 stays disabled.

## Implemented components

| File | Responsibility | Boundary |
| --- | --- | --- |
| `scripts/codex-automation-policy.ts` | Frozen scope and offline proposal checks | Does not authenticate its inputs |
| `scripts/codex-run-control.ts` | One active run, permanent duplicate protection, whole-run and per-request budget reservations, one-shot publication claim | Requires a durable trusted store and fresh verified runtime evidence |
| `scripts/codex-github-control.ts` | Fixed-origin GitHub HTTPS adapter; durable ledger in a dedicated Git ref; live owner/comment/issue/main admission | Token stays in trusted controller; no worker access; no automatic bootstrap |
| `scripts/codex-responses-gateway.ts` | Fixed-origin provider transport, exact input-token counting, bounded output, no inference retries, Unix socket forwarding | Not itself a sandbox; must be outside the worker and never log raw prompts/errors |
| `scripts/codex-proposal-replay.py` | Credential-free patch reconstruction and exact Git tree SHA | Supplied scope must be independently authenticated; does not execute tests |
| `scripts/codex-proposal-publisher.ts` | Ed25519 receipt verification and exact-tree Git object/draft-PR publication | Executes no proposal code; signer key must belong to a trusted isolated validator |
| `scripts/codex-runtime-preflight.ts` | Reviewed-binary digest and isolated network-namespace probe | Failure has no insecure fallback; a passing probe alone is not a sandbox audit |

These are working, tested component implementations, **not a completed live runner**. The worker/bridge/exporter/isolated test/signing lifecycle, trusted runtime verifier, credential provisioning, authoritative price/billing intake and reviewed launch entrypoint are still unwired. No new paid workflow or running service has been activated. The transport tests use synthetic keys and fixtures; no real GitHub/OpenAI API transaction is implied.

## Execution model to finish and verify

A trusted controller authenticates a frozen issue-specific owner grant, current source and source-bound scope. It checks supported isolation and independently reviewed toolchain integrity before loading credentials. It explicitly initializes a durable monthly ledger from conservative, authoritative billing evidence. It atomically claims the run and reserves its **entire** worst-case allowance. The worker receives only a copied source tree, trusted task prompt and a model-only socket bridge inside its isolated filesystem/PID/network namespace. No API key, GitHub credential, host process tree or deployment/database access enters that namespace.

Every model request rechecks the current grant and source, verifies fresh runtime evidence and a current worst-case price card, counts the complete input, pins the model/service tier/output bound, and durably reserves the request before forwarding it. Only local function/custom tools and namespaces composed of those tools are admitted; provider-hosted tools, external media and server-side continuation IDs are rejected. Inference is never retried automatically. Full reservations remain charged to the controller budget after success, cancellation, timeout, lost replies or process failure. This intentionally favors stopping early over utilization.

After the controller has terminated the entire worker namespace and bridge, a separate trusted exporter must inventory worker changes without running worker-controlled Git/config/hooks, reject unapproved paths/modes/links, and produce bounded proposal bytes. A fresh credential-free validator reconstructs the exact source tree and runs required database-free checks in a different isolated environment without model or publisher access. Only its trusted supervisor may sign the receipt after verifying successful checks and the exact tested tree. The publisher verifies that receipt against an operator-enrolled Ed25519 public key, rechecks live owner/source authority, claims publication durably, reconstructs the GitHub tree and requires the returned tree SHA to match the receipt. It creates one dedicated issue branch and one **draft** PR. Ambiguous publication responses stop for operator reconciliation, not a second PR attempt.

## Durable ledger and crash behavior

The ledger lives only in the dedicated `sovereign-control-ledger-v1` Git ref at `.sovereign/control-ledger.json`. It is never merged, used as application code or mounted in a worker. Bootstrap is explicit and refuses an existing or inaccessible ref; missing state is not zero spend. Monthly baselines and safety margins are mandatory. Unknown months and full ledgers stop rather than silently reset history. A positive safety margin and all prior run allowances count toward the $45 cutoff, including finished or stopped runs.

Updates create unique child commits and use non-forced ref updates. Each commit includes a random nonce: without this, identical simultaneous mutations could produce the same commit and both callers could incorrectly consider themselves the winner. Divergent concurrent children cannot both fast-forward the ref. Conflicts may repeat metadata reconciliation only; inference is outside that loop. Uncertain writes fail closed. The same scope or run ID is never automatically relaunched; stale claims require a separately reviewed recovery procedure. No live ledger was bootstrapped during this task.

## Authentication and revocation

The GitHub collector fetches authoritative issue, comment, owner permission and main-ref data on every check. It requires the known owner account ID/login/type and admin permission, an open non-PR issue whose full body matches the frozen acceptance digest, unchanged source/base SHA, and an exact unedited grant comment attached to that issue. Editing/deleting the comment, changing the issue/source, losing permission or passing expiry blocks the next protected call. No label or `authenticated: true` field from a worker is authority. In-flight calls can still complete and remain fully reserved; remote revocation cannot retract completed inference.

The trusted operator may persist the existing active Work authorization as one narrowly bounded grant; an agent-authored record cannot independently expand that authorization. Grant operations are exactly `implement`, `test`, `paid`, `publish-draft`, `existing-ci`. Grant, runtime, price and signer enrollment must be supplied through the reviewed controller, never accepted from the worker. No live grant comment was minted in this increment.

## Money, prices and key binding

The observed Sovereign project limit is $45 with **Limit enforced**, at approximately $0.11 spending on 2026-11-14. The provider explicitly warns that enforcement can lag and final usage can exceed that number. The organization remains at $50, unenforced. These observations do not establish a strict ceiling or identify the project of the existing GitHub secret.

The controller uses integer micro-USD, reserves a full run allowance plus baseline and positive safety margin **strictly below $45**, and never refunds uncertain costs. Each request uses an independently verified, at-most-one-day price card with the worst applicable uncached/long-context rates, current model identity and output cap. Token counting covers the complete input, instructions, tools and formatting; output reservation includes non-visible reasoning tokens. Provider-side tools are excluded from this candidate. Token-count endpoint billing semantics, model/CLI compatibility and real usage reconciliation still need live verification. No production rate card is included and no dollar guarantee is claimed from fixture arithmetic.

Before live use, prove all spending in the dedicated project is exclusively routed through this ledger/gateway, no other key/session can bypass it, the controller's key belongs to that project, initial billing evidence is authoritative/conservative and the chosen model/rates are correct. A browser's rounded spend display, key name or `OpenAI-Project` header alone is insufficient proof. Runtime evidence must be refreshed within 30 seconds. No credential value was read or copied by this task.

## Artifact and confidentiality restrictions

Replay runs in a pristine disposable checkout **before** dependency installation, with trusted artifact parents and no credentials. It bounds file reads, rejects final-component symlinks/multi-link files and ignored-source dirt, and returns the complete reconstructed tree SHA. This checks the validator checkout, not hidden original-worker output; the independent exporter remains necessary. Simple secret-pattern filters are not exhaustive confidentiality controls. Never upload raw agent logs, final reports, environment files or provider error bodies. The Unix gateway exposes only POST `/v1/responses`, rejects other routes/encodings, bounds input/output and emits a constant error message. Its parent directory must be owned/private and only the socket may be mounted in a worker.

## Current environment and release gate

The Work host's Bubblewrap probe fails with `namespace-isolation-unavailable` (network namespace setup denied). Unix socket listening also returns EPERM. Docker and Podman are absent. OPENAI_API_KEY, GITHUB_TOKEN and GH_TOKEN were checked for **presence only** and are absent in this task shell. No credential file, browser session or repository secret was extracted. Do not drop isolation, expose a key to the worker, reuse the old smoke action, add a privileged runner or merge code as a workaround.

A compatible isolated executor and secure controller credential/key enrollment are necessary external prerequisites. A reviewed real worker/exporter/validator lifecycle must then be wired and tested there, including cancellation/descendants, network/filesystem/credential isolation, malicious outputs, grant revocation and actual bounded provider calls. The signed publisher is not permission to bypass that missing runtime. New code needs independent exact-head security review; author tests are not certification. Until these checks succeed, PR78 and paid execution remain disabled.

## Verification

Local Node 24.22.1 / Vitest 4.0.0 / Vite 7.1.12: six relevant suites, **49 passed, one skipped** out of 50. The skip is the real Unix-socket integration fixture because this host denies listening; it must execute without skips on a compatible runner before activation. The Python wrapper executes all 18 replay fixtures. Targeted TypeScript 6.0.3 checking passed with the repository's strict flags, including noUncheckedIndexedAccess and exactOptionalPropertyTypes. No dependencies, workflows, permissions, gameplay or database files changed.

Modules use TypeScript parameter properties: execute compiled reviewed JavaScript, or Node 24's `--experimental-transform-types` for diagnostics. Strip-only mode is insufficient; an initial diagnostic attempt demonstrated that limitation. The actual namespace diagnostic then returned unavailable, exit0 for the structured preflight result. Neither that exit code nor green hosted application CI means isolation is available. Hosted CI and independent review on the new published source are separate evidence.

Official references: [input token counting](https://developers.openai.com/api/docs/guides/token-counting) and [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create). These describe API fields, not this pipeline's security certification.
