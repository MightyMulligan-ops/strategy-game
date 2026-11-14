# Automation 015 Codex smoke-test troubleshooting

## Failure observed
Manual workflow run 43619343743 installed Codex CLI and the Responses API proxy package, but the official action skipped its **Check Responses API proxy status**, **Start Responses API proxy**, and **Wait for Responses API proxy** steps. It then failed reading `/home/runner/.codex/43619343743.json` (ENOENT), before `codex exec`.

The official action guards proxy startup with `inputs['openai-api-key'] != ''`; a blank input explains the skipped steps. The most likely cause is a missing/unavailable GitHub Actions secret, but the logs alone cannot prove why it was blank.

## Operator checks
1. In GitHub, open **Settings → Secrets and variables → Actions** for `MightyMulligan-ops/strategy-game`.
2. Confirm an Actions **repository secret** named exactly `OPENAI_API_KEY` exists. If it does not, create it with a valid OpenAI project API key. Do **not** paste the key in an issue, PR, chat, or workflow log.
3. If the secret is managed at the organization level, verify this repository is permitted to use it. Environment-scoped secrets require an appropriately configured job environment.
4. Merge the fail-fast preflight PR and manually rerun the workflow on `main` only after the secret is available. The preflight checks only a boolean expression; it does not send the secret to a shell step.
5. If proxy startup is still skipped, review the new run's preflight result and inspect the official action's version and logs. If the proxy starts but Codex returns a 401/403, investigate key validity, API project access, and billing separately.

## Security
Do not weaken `permission-profile: ':read-only'`, `safety-strategy: drop-sudo`, the manual dispatch gate, or repository permissions to resolve a missing secret. Do not print, hash, or expose the secret to debug it.
