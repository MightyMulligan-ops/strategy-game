# City recruitment task — owner approved

Tracking: https://github.com/MightyMulligan-ops/strategy-game/issues/110

## Owner-approved delivery
The owner approved this task in the active Sovereign conversation after reviewing the city economy/recruitment/garrison bundle. This authorizes implementation, additive migration source, tests/docs, one feature branch and draft PR, and unchanged hosted CI with fresh disposable PostgreSQL migrations/tests/cleanup. Independent external review was explicitly waived. Feature merge, existing database access, home-game migrations, deployment, new credentials/permissions and automatic paid retries remain excluded.

Use the existing OpenAI Platform setup with **gpt-6.2-astra**, high reasoning, standard tier, subagents disabled, one paid session and the conservative **$50 estimated soft task limit**. A soft estimate can stop early or overshoot actual billing through delayed accounting; it is not a guaranteed ceiling. Keep this task's five-pass correction history separate from all earlier histories.

## Approved behavior
- Replace synthetic camps with actual city points for recruitment, ownership, army entry and dispatch.
- Host-configurable starting funds: default 2,000 credits/player.
- Validated versioned balance snapshot frozen per match: Infantry 100; Lieutenant 200; normal city income 200/turn; capital 400/turn replacing normal income; five recruited units/city/turn including leaders; no credit upkeep.
- Future proposed rank prices (Captain500/Colonel1000/General2000) do not expand this initial Infantry/Lieutenant implementation.
- Queue only at owned cities; deduct cost upfront; all initial types take one turn.
- Preserve chronological movement/combat/capture; settle recruitment/refunds next; then pay income to each city's final owner and open fresh planning.
- New recruits become available in that new planning phase; they do not fight in the turn they were recruited.
- Any capture cancels pre-existing recruitment and refunds the original player in full, even if that player later recaptures the city that turn.
- Manual cancellation while Unready/open refunds fully. Ready locks edits; clearing Ready permits edits before closure.
- One combined own garrison per city. Own arrivals/recruits consolidate; never transfer allied ownership.
- Duplicate leader ranks are allowed in city garrisons, but confer no extra attacks/bonuses. Highest eligible rank commands; players select among equal ranks, with stable unit-ID fallback when the selection becomes invalid.
- All garrison leaders remain vulnerable to combat casualties. Preserve removal of remaining leaders when no Infantry survive, and test compatibility with single-leader encounters.
- Dispatch selected troops/leaders into field armies obeying existing movement and one-leader-per-rank limits. No new leaderless radius or supply effects.
- Preserve unit identities, wounds and permanent recruitment-source provenance.
- Begin with two players, each owning one designated capital, and a small explicit set of land-validated real European cities; other scenario cities are neutral. Select/document exact cities and surface/coordinate evidence before freezing implementation. Do not silently snap coastal/water-invalid cities or activate every display city.

## Interface
Keep the latest Sovereign navy/gold map-focused UI and automatic refresh. Deliver city selection/recruitment panel, quantity and total-cost preview, treasury, own recruitment queue with city/type/quantity/amount paid/arrival turn, garrison/leader selection and map-based field-army dispatch. Keep coordinates secondary. Turn reports must explain recruitment completion, cancellation, refunds and income. Do not expose other players' private queues/funds.

## Implementation and acceptance
Use a separate creation-pinned runtime; historical matches/cohorts retain old behavior. Server validates intent, ownership, limits, safe numeric ranges, funds, phase, Ready state and revisions. Persist durable accounting/queues and atomically settle combat/capture/recruitment/refunds/income/next turn.

Prove no double charge, recruitment, refund or income under duplicate requests, concurrency, rollback and restart. Cover capture/recapture, empty/existing garrisons, duplicate leaders, arrival consolidation, dispatch composition, HP/provenance, privacy and stale responses. Include meaningful engine/API/UI/DB tests, frozen install, Prisma generation, build/typecheck/lint/full tests and diff checks. Apply migration source only in fresh disposable CI databases; verify cleanup. Document a real two-player isolated acceptance runbook and distinguish mocks from observed browser/database evidence.

Stage checkpoints: contracts/city scenario; economy/immutable configuration; recruitment/settlement; garrisons/dispatch; UI; full verification and draft handoff. Resolve technical choices within approved behavior; do not invent new gameplay rules. Missing evidence is a limitation, not permission to skip checks or broaden authority.

## Launch prerequisites and actual state
- Runner PR #109 was merged as 48a4e478a694a43907b6fc47a5e881aa2165dbce after exact-head CI44449618170 attempt1 passed 2433 application and326 PostgreSQL tests plus isolated validation.
- The latest UI source is 2f1b73c4e464f93cf873a1f260c62181c5658cff on ui/map-command-interface; it must be integrated through exact-head CI before freezing the feature source.
- PR #96 overlaps launch protocols but has a useful owner-local signing/start CLI. Adapt/preserve that functionality for the merged #109 protocol through separately verified preparation; do not merge the conflicting protocol wholesale.
- The protected ledger was inspected and contained active:null, runs:[]; recheck before launch. The old issue95 manifest is expired and unrelated.
- Fresh exact source, issue digest, explicit path allowlist and owner signature are required. No signed feature manifest or paid session exists yet.
- Windows execution disconnected during preparation. The local checkout has an unresolved documentation merge in docs/DEVELOPMENT_STATUS.md while merging origin/main into runner/manual-astra62. Preserve both sides when restoring; do not reset/delete the checkout.
- Connected GitHub tools remain available, but the execution environment and local signing/dispatch are currently unavailable. Approval is recorded; it is not a cryptographic signature or evidence of provider execution.

Deliver one draft PR for the feature and a complete head/base/CI/file inventory/limits/correction-history handoff. No feature merge or deployment.