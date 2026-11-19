# Owner-local paid task launch

This reconciles PR96's owner-local signing/dispatch functionality with the merged
PR109 manual-cost-v1 runner. Do not merge PR96's incompatible v2 protocol.

Only run the merged helper from a clean checkout of current main, on the owner's
configured machine. Use the existing enrolled Ed25519 signing key; do not upload,
paste or commit it. This helper never needs or reads an OpenAI API key. The paid
runner uses its existing isolated GitHub environment secret. GitHub CLI must be
signed in as the existing repository owner; no new permissions/key are provisioned.

The frozen task JSON contains exactly:
- sourceSha: current merged main SHA
- issue, title, issueDigest: the exact open issue and SHA256 of canonical {title,body}
- scopeText: that exact issue body
- allowedPaths: explicit supported city-feature-v1 paths, no wildcards

Issue110's final file list and exact source must be frozen after source inspection.
Do not use the expired Issue95 request or substitute another branch. Task approval
has already been given in chat; this local operation supplies its cryptographic
signature and one-use dispatch, not another gameplay approval.

In normal owner PowerShell, from the merged checkout, use the installed pinned
pnpm/toolchain setup and these commands (replace only the two existing file paths):

```powershell
node --experimental-transform-types scripts/overnight-manual.ts prepare .cache/city-task.json "PATH-TO-EXISTING-OWNER-KEY.pem" .cache/city-prepared.json --soft-limit-50
node --experimental-transform-types scripts/overnight-manual.ts start .cache/city-prepared.json --soft-limit-50
```

Prepare performs only authenticated read checks and writes a new local signed
request without overwriting files. It verifies owner identity, current main,
merged helper bytes, enrolled public key against the independently pinned variable,
empty active ledger, exact issue/body/source/profile and matching private key.
The owner selects the start time by running prepare/start; it creates a six-hour
validity period and five-hour operational watchdog, not a fixed nightly slot.

Start revalidates identity/main/issue/signature/ledger/config SHA, records a local
attempt marker before mutation, disables the activation flags while publishing
exact signed bytes, verifies publication and authority again, then enables manual
execution and dispatches the trusted main workflow once. It leaves scheduled paid
execution disabled. Only activation flags and the owner-signed config are changed;
no billing setting, enrollment, permission or secret is modified.

If any response is lost, do not rerun start or remove its attempted marker. Inspect
Actions and the protected ledger first; unknown work retains its claim. A dispatch
acknowledgement is not evidence that a paid session started or completed. Confirm
the actual run/session identity, cleanup receipt, validation and resulting draft PR.
The conservative $50 cost guard can stop early or overshoot the actual bill; it
is not a guaranteed ceiling. This helper never launches a replacement session.

The current Windows workspace disconnected during a documentation merge. Restore
that connection and preserve both DEVELOPMENT_STATUS.md histories before using
the checkout. Do not reset/delete the working copy to clear the conflict. A fresh
reviewed checkout is an alternative if the existing one must remain untouched.

Verification: synthetic owner/key/config/ledger/dispatch and failure-injection tests
run in CI without provider calls. No live signing or paid launch is claimed.
