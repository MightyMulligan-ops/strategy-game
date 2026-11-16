# Sovereign — OpenAI-hosted Agents API adapter (draft, OFFLINE ONLY)

**Status:** integration candidate, **NOT a live launcher**, not independently security-reviewed, not approved for paid activation. This change is a dependent draft on PR #80; PR #78 remains hard-disabled. No merge, deployment, existing/production DB access, credentials, paid session, or GitHub Actions dispatch.

## Verified API capabilities

OpenAI Agents API uses `POST /v1/agents/sessions` with `OpenAI-Beta: agents=v1`, an application API key with `api.agents.read`, `api.agents.write` and `api.responses.write`, and `environment.type: openai_hosted`. The application key stays outside the sandbox. The hosted Linux environment accepts Files API inputs, supports `network.access: disabled`, runs setup commands and publishes immutable files from `/workspace/outputs` as downloadable artifacts after a completed turn. Model and hosted-container usage are separately billable.

References (reviewed 2026-11-15):
- https://developers.openai.com/api/docs/guides/agents-api/quickstart
- https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted
- https://developers.openai.com/api/docs/guides/agents-api/environments/security
- https://developers.openai.com/api/docs/guides/agents-api/environments/files
- https://developers.openai.com/api/docs/guides/agents-api/sessions/events

## Candidate code

`scripts/codex-hosted-agents.ts` contains a **pure** request builder and offline outcome/artifact checks. It never loads an API key, opens a session, uploads an archive, fetches artifacts, or performs paid inference. The request has no environment secrets, no GitHub write credentials, no MCPs, and explicitly disables sandbox network access. It accepts only a source archive uploaded by a trusted controller, tied to a frozen scope and exact source SHA. Its static setup checks the archive digest before extraction. **The digest is not an archive safety audit:** a separate trusted packager must first reject traversal, symlinks, hardlinks, unsafe modes, Git hooks/config, ignored secrets and undeclared content, and verify the archive against the Git tree.

The builder requires authenticated, separately collected proof of current owner grant, one-run durable reservation, project/key binding, exclusive project routing, model+container price provenance, reviewed sandbox policy, and **a verified bound on whole-session cost and cancellation**. These are boolean interfaces for a future trusted controller, not authentication. There is no implementation that can currently supply those proofs. An agent or issue body must never be allowed to set them.

The agent is instructed to work only on approved source paths and produce `proposal.patch`, `manifest.json`, `summary.txt`. Those instructions do not enforce scope. Only a trusted exporter/download service and the existing offline replay/isolated validator can establish scope and patch integrity. The artifact inventory checker requires a complete paginated listing of exactly those three files for the completed root turn; downloaded bytes are capped before parsing. A completed turn is **not** validation, and an idle event or disconnected stream is **not** completion.

## Critical budget design difference

The current PR #80 `BoundedResponsesGate` can reserve each individual Responses API call **before** sending it. Agents API sessions own their internal model turns, so that gateway cannot observe/reserve every model request inside a hosted session. The existing `RunController` can reserve an entire run, but **a reservation alone cannot physically stop provider-side session charges**.

Before any paid Agents session, independently verify and implement:
1. Authoritative dedicated-project current usage, model and hosted-container prices, possible tools/subagent usage, and key/project exclusivity.
2. A conservative enforceable maximum exposure for the entire session, including setup, idle time, all model turns, subagents, retries, streaming disconnects and delayed cancellation. If the provider does not expose a reliable cost cap or trusted termination boundary, **deny paid launch**; do not pretend that a timer or the $45 project hard limit is an absolute spending guarantee.
3. Durable claim **before** session creation, immutable session identity and recovery after ambiguous create/disconnect, no automatic paid retries, explicit session deletion/termination, and conservative accounting of unknown outcomes.
4. Fresh owner-grant/revocation checks; prevent follow-up input after revocation. Already-started provider work may continue and must remain reserved.

## Remaining lifecycle

- **Trusted packager:** fetch exact pinned Git tree; audit all paths/modes/links, create offline dependency/toolchain bundle and upload with a project-scoped application key. Ensure archive extraction cannot escape the sandbox or trigger code before trust checks.
- **Trusted launcher/controller:** integrate with GitHub owner-grant collector and durable ledger; prove provider cost bound; call Agents API with reviewed request; persist session/turn IDs and stream/recover state. No untrusted model text in privileged control decisions.
- **Trusted exporter:** list all artifacts (all pages), download bounded bytes, reconcile exact completed turn, then pass proposal bytes into existing replay. Reject missing, extra or ambiguous artifacts.
- **Independent validator:** run offline build/typecheck/lint/DB-free tests in a **separate** fresh environment without publisher/model credentials; inspect full tree and sign exact tested result with independently enrolled Ed25519 key.
- **Publisher:** use existing signed exact-tree draft-only publisher, with fresh grant/source checks and one-shot publication claim. No untrusted code in publisher process.
- **Review:** adversarial archive tests, session failure/revocation/disconnect/cancellation and billing tests, provider SDK compatibility, actual sandbox confinement evidence and independent security sign-off. Then and only then consider a tiny bounded paid pilot before Issue #76.

## Verification scope

The new Vitest suite covers request construction, missing evidence, issue/scope/source drift, untrusted issue instructions, root-vs-subagent completion, failed/cancelled/idle/disconnected outcomes, complete same-turn artifact inventories and byte caps. Tests are **synthetic**. They do not exercise the real Agents API, actual hosted sandbox isolation, provider billing, secure packaging, SDK compatibility, CI or signing. Hosted CI on the exact new commit must be checked separately.


## New offline lifecycle and source packaging (2026-11-15)

- `scripts/codex-hosted-packager.py` reads only blobs in a pinned Git commit, rejecting symlinks/gitlinks, unsafe paths, oversized blobs and obvious embedded secrets. It creates a deterministic gzip/tar archive with non-executable regular entries, no Git metadata, and bounded size. It **does not** install offline dependencies, authenticate the Git source or prove sandbox isolation. It is not safe to feed arbitrary unaudited archives to the session builder.
- `scripts/codex-hosted-journal.ts` implements a durable-store interface and one-way `reserved -> creating -> running -> completed` state machine. Once session creation may have been sent, an ambiguous outcome blocks replay. The implementation requires a real durable store, externally authenticated provider observations and separate owner-grant/budget admission before use. No live store is configured.
- New tests cover concurrent duplicate claims, ambiguous creation/disconnect, crash-stop behavior, unsafe Git objects, tracked/untracked separation, deterministic archive bytes and mode normalization. **Authored tests are not execution evidence** until exact-head CI passes.

### Exact-head CI handling

The repository's existing `.github/workflows/ci.yml` runs for pull requests targeting `main` only. PR #81 is a dependent draft targeting PR #80's branch, so its initial commits do not trigger CI. A temporary draft-only retarget to `main` may be used to obtain exact-head CI, then restore the dependent base; do not alter or bypass the CI workflow. This still does not establish independent security review.

### Additional implementation blockers

The hosted packager deliberately excludes dependency installation and cannot ensure offline Node tooling is present. The trusted runtime needs a reviewed, immutable offline toolchain bundle or a provider-managed prebuilt template that preserves network-disabled execution. The journal cannot physically stop provider-side model usage, and no proven hard per-session spend ceiling has been established. The actual API client, artifact pagination/download, isolated validator/signing and publisher orchestration remain unconnected.


## Hosted orchestration seam (additional candidate)

`scripts/codex-hosted-orchestrator.ts` connects the offline request builder, durable session journal, root-turn event handling, bounded artifact inventory and existing proposal-metadata checks through a **dependency-injected provider interface**. It marks session creation irrevocable before calling the provider, refuses duplicate attempts, treats disconnected streams as ambiguous, and requires server-side deletion confirmation before returning a proposal. Synthetic tests cover success, missing admission evidence, failure, stream disconnect, extra artifacts and uncertain deletion.

**This interface is not a live provider adapter.** A reviewed OpenAI Agents SDK/HTTP implementation, authenticated provider IDs and events, bounded streaming downloads, session termination/recovery, complete Git replay, fresh independent isolated tests, trusted signer, authenticated publisher and proven full-session cost limit remain necessary. Returned bytes are explicitly `UntrustedHostedProposal`; no code is executed or published by this module. An implementation must never accept the test's synthetic booleans as authorization.


## Owner-approved simplified pilot (2026-11-16)

The owner subsequently authorized removing the **custom** per-session and $45 reserve-as-hard-stop requirements for **one manual pilot**. The existing OpenAI Platform project limit remains configured, but may lag and is not a guaranteed ceiling. The strict spending proof described above remains background for the original high-assurance design, **not an active prerequisite for the simplified pilot**. The pilot instead uses one owner-triggered run, a 15-minute GitHub Actions agent job, no automatic retries, network-disabled coding environment, no API or GitHub write credentials in generated code, separate validation and draft-only publication.

A security review identified that a secret-free GitHub job alone is **not sufficient** isolation for malicious generated tests. The pilot now runs generated code only in a networkless Docker container with dropped capabilities, no secrets, a read-only root filesystem, and an isolated copy of the repository. The trusted validation receipt is created and uploaded by the host **outside that container**; the publisher receives only that successful validation job's artifact. This reduces risk but does not constitute a formal independent security certification. No production database, auto-merge or deployment is permitted.

The first DB integration failure in earlier PR #81 CI was attributable to unordered nested participant rows in a 40-player idempotence comparison. The isolated ordering fix was tested separately and merged in PR #85; it does not alter game behavior. PR #80 control-plane groundwork was also merged after green CI. The revised PR #81 requires a new exact-head CI run before its workflow is considered for merge.
