# Sovereign cloud controller — offline preflight (2026-11-15)

**Current disposition: safe to review as a DRAFT; NOT A PAID RUNNER.** Sovereign is intended to run without either Windows PC. The OpenAI API key was configured by the owner in GitHub environment `sovereign-controller`; its deployment branch rule is `main` only. That is user-supplied configuration evidence, **not** a credential test or security certification. No tool in this integration reads, displays or copies that secret.

## New cloud workflow
- `.github/workflows/sovereign-cloud-preflight.yml` is **manual only** (`workflow_dispatch`), uses repository-wide `contents: read`, and runs only when `github.ref == refs/heads/main`.
- The job deliberately **does not** reference `environment: sovereign-controller`, `secrets.*`, any API key, publisher token or signing key. Checkout explicitly disables persisted credentials.
- It checks trusted GitHub runner metadata (repo, actor ID, main ref, first attempt, exact source SHA), an immutable offline-only mode and a fixed issue 76. Any credential-like process environment variable causes a fail-closed diagnostic.
- It does **not** interpret workflow inputs as owner spending approval, call Agents API, upload source, publish a PR or run generated code. It is not a security boundary against malicious changes to main by a repository administrator. It is not itself a production authorization flow.

This new workflow will not be dispatchable from `main` until code is merged, and merge is not authorized. Existing CI can validate its new TypeScript test suite on the PR branch; that is **not** evidence that the manual GitHub workflow has been executed.

## Exact cloud production design (still unwired)
1. **Read-only intake** (no API key). Main-only trusted workflow retrieves frozen issue content/source and authenticates owner grant, revocation, current branch and exact scope against GitHub. Claims a run with durable single-writer CAS storage.
2. **Cost admission** (no code execution). Project billing origin, provider-side project cap, fresh model+sandbox price card, conservative worst-case maximum, inflight charges and $45 cutoff must be independently verified. A hosted Agents session can incur unbounded internal model turns if a trustworthy charge+termination bound is absent; do not start one.
3. **Credential-bearing launcher** (separate process/job). Only reviewed, immutable controller code on protected `main` enters `sovereign-controller`, reads `OPENAI_API_KEY` without ever printing it, invokes API with explicit disabled sandbox egress and no credentials exposed to the agent. Crash/disconnect require recovery, not replay.
4. **Bounded artifact intake** (no generated-code execution). Paginate all immutable artifacts from exactly one completed root turn, limit byte streaming and validate complete proposal metadata.
5. **Independent validator** runs generated code with **no model, GitHub write, or signing credentials** in a fresh sandbox. Explicitly build/typecheck/lint/DB-free tests; verify full exact Git tree, reject scope drift or unexpected code execution.
6. **Independent signer** signs only an already-tested exact-tree receipt with an operator-enrolled Ed25519 private key. Neither agent nor publisher can access that key.
7. **Trusted publisher** separately authenticates latest owner grant and source, checks the signed receipt and durable one-shot publication claim, creates a single **draft** PR using Git object APIs. Never merges or deploys.
8. Independent security reviewer validates the real runtime, revocation, billing proofs, egress isolation, all permission boundaries and crash behavior. Only then may the owner-authorized tiny pilot launch.

## Why this isn't just an API secret wiring exercise
The OpenAI Agents API hosted environment manages both agent model calls and separate sandbox charges. Our `BoundedResponsesGate` only covers individual Responses API requests, **not** the internal turns of a hosted Agents session. A controller ledger and a $45 project limit (which may be enforced with lag) are insufficient as a strict spending guarantee. This prevents live launch under the previously established operational cutoff.

Do not weaken or remove this spending gate without a fresh owner decision. If there is no reliable per-session worst-case bound, keep the hosted launcher disabled and evaluate a model-call-metered worker using the existing Responses gateway.

## Validation
- Existing verified prior head `31b38e84990859ed1d0956f81f34f170ccf06779`: CI 1,804 application + 262 DB tests passed.
- New preflight and workflow are additive and require **new exact-head** CI before they can be described as tested.
- All paths are draft-only. No cloud activation or paid inference was attempted.

CI note: GitHub's standard pull_request trigger runs on new commits while this draft PR temporarily targets main; after exact-head CI, restore its dependent base on PR #80. Never merge or activate the cloud workflow from this test.
