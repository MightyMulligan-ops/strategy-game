# AI Agent and Contributor Instructions

These instructions apply to the entire repository unless a more specific `AGENTS.md` is added in a subdirectory.

## Before making changes

1. Read `README.md` and the relevant documents in `docs/`.
2. Inspect the existing repository and current implementation before proposing or changing architecture.
3. Treat documented decisions as authoritative. Do not silently reinterpret, simplify, or replace them.
4. If a requirement is ambiguous or two documents conflict, report the exact ambiguity and ask for a decision before implementing the affected behavior.
5. Prefer the smallest coherent change that advances a milestone.

## Architecture rules

- Use TypeScript throughout the application unless a documented exception is approved.
- Maintain a pnpm monorepo with clear application/package boundaries.
- Start as a modular monolith. Do not add microservices, Kubernetes, or distributed infrastructure without a demonstrated requirement.
- Keep the game server authoritative for validation, turn resolution, combat, economy, visibility filtering, and persisted game state.
- Treat client input as untrusted intent. Validate all commands on the server.
- Do not send hidden enemy information to a client and rely on the UI to hide it; filter data before transmission.
- Modules must not directly mutate another module's private state. Use typed interfaces, commands, and domain events.
- Keep rules configurable through validated schemas and ruleset configuration. Never allow game administrators or users to upload arbitrary executable code as a rules module.
- Keep map geometry, territory ownership, and unit geographic positions as distinct concepts.

## Gameplay invariants

- Movement is geographic and range-based, not restricted to adjacent territories.
- A moving stack normally requires an eligible leader.
- A single infantry unit may move without a leader only within the configured radius of its original recruitment/spawn node. Its source node ID is permanent; entering another node's radius never resets it.
- Multiple leaderless infantry units cannot move as a group under the current rules.
- Non-infantry units require a leader to move.
- A stack may contain at most one leader of each rank: General, Colonel, Captain, Lieutenant.
- The highest-ranking leader is the primary commander. Other leaders are secondary commanders.
- Leader specialization is selected when the leader is created/recruited.
- Military Supplies are one abstract resource. They are generated and stored at source nodes, allocated to a departing stack, carried by that stack, and consumed over time. Supplies are not transferred directly between city stockpiles.
- In the initial supply model, supply affects attack and defense only—not movement, visibility, HP, or unit identity.
- Resolve all outcomes server-side.

See `docs/GAME_DESIGN.md` for the full current rule baseline and explicit open questions.

## Implementation workflow

- For owner-approved issue work in the local VS Code Codex session, follow `.github/CODEX_ISSUE_PROMPT.md` and `docs/CODEX_WORKFLOW.md`. Existing explicit owner authorization in the session takes precedence over label conventions; do not ask for it again.
- Update `docs/DEVELOPMENT_STATUS.md` with evidence and the actual issue/PR state. Unmerged work is in review, not a completed milestone.
- GitHub metadata workflows must never invoke Codex, require an OpenAI API key, execute PR code with write permissions, merge, or deploy.

- Work in focused issues or tasks; avoid giant all-at-once implementation prompts.
- Prefer a vertical slice that crosses UI, API, game logic, persistence, and tests over disconnected placeholder systems.
- Add or update unit, integration, and deterministic simulation tests as appropriate.
- Run relevant tests, type checks, and linting before declaring work complete.
- Do not claim tests passed unless they were actually run and their results are known.
- Keep functions small and domain-oriented; avoid premature abstraction.
- Do not introduce dependencies without explaining why they are needed.
- Keep secrets, credentials, and local environment files out of version control. Provide an `.env.example` with placeholders when configuration is introduced.
- Update relevant documentation when rules, interfaces, architecture, or setup steps change.

## Completion report

At the end of a task, summarize:
1. What changed and why.
2. Files created or modified.
3. Tests and commands actually run, with results.
4. Remaining limitations, assumptions, and follow-up work.
5. Any decisions needed from the project owner.

Use plain language in explanations. The project owner is technically capable but is not a professional software engineer; explain unfamiliar tradeoffs without unnecessary jargon.
