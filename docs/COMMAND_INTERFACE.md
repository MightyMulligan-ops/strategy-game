# Sovereign command interface refinement

Owner-started UI task, November 18, 2026. Base: 72db7fbcb1db46bc900512d95b0b84a395559a60 (ui/live-europe-map). Work branch: ui/map-command-interface. The owner's supplied atWar screenshot is a reference for information hierarchy, not copied artwork, source or branding.

## Delivered scope

- Full-height Europe command screen with original Sovereign navy/gold styling, compact turn/Ready/countdown controls and contextual Units, Orders and Reports drawers. Account controls open as a non-modal panel; Escape closes it and returns focus. The broader lobby redesign is deferred.
- Country anchors seek interior clearance rather than bounding-box centers. Text rectangles fit inside conservative interior circles, including hole/enclave boundaries. Small labels shrink with zoom or hide below 9px; France and other large names cap at 22px. Hidden labels remain identifiable through hover and keyboard country search. Collision rejection uses the fitted dimensions. Country outlines and physical navigation remain distinct.
- Own army markers are selectable buttons showing unit counts. Dragging creates a temporary dotted preview; release submits one existing replace_orders command with exact profile, turn and expected revision. The marker stays at its stored authoritative position. New moves append to that formation's existing route. Empty-map dragging still pans.
- Invalid/out-of-map drops, Escape, pointer cancellation/lost capture and Ready/closed states do not submit. A planning revision change during a drag rejects the stale intent. Camera easing is frozen when the army drag begins. Click-map plus Add movement and a disclosed coordinate entry remain keyboard alternatives; coordinates are not the primary workflow.
- Read-only automatic updates from the preceding branch remain active. Historical cohorts keep their existing controls. No API/schema/gameplay, auth/session/security, dependency, workflow, migration, imagery or ownership-policy changes.

Touched source: App.tsx/App.css; LoopWorkspace.tsx; WorldView.tsx; new EuropeCommand.tsx and test; europe/EuropeMap.tsx and test; countries.ts and test; europe.css; new map-interaction.ts. Documentation: this file and DEVELOPMENT_STATUS.md. Pre-existing untracked installation artifacts are preserved.

## Recruitment decision still required

The current scenario starts each player with a Lieutenant and five Infantry. GAME_DESIGN.md section 5 leaves exact costs/upkeep/reinforcement formulas undecided, while EUROPE_PLAYTEST.md explicitly excludes recruitment and automatic respawns. There is no authorized recruitment command to connect a spawn interface to.

Recommended interaction: select an owned city/camp, choose a recruit or formation in a contextual recruitment panel, then queue recruitment during planning. Recommended timing: recruits appear at their source when the next turn opens and can be dragged during that planning phase. This preserves source provenance and avoids free placement anywhere on the map. City eligibility, currency/costs, per-turn limits, dependency cancellation and behavior if the city is captured still need a concrete approved ruleset. No fake spawn control, invented treasury or client-created unit was implemented.

## Verification

Frontend suite: 270 passed / 16 files. Full build and final web build passed; web typecheck/lint passed. Whole-repository run: 2392 passed, 18 failed, 326 skipped. All failures are in five unchanged scripts test files: codex-hosted-packager, codex-proposal-replay, codex-responses-gateway, overnight-production and overnight-queue. Errors include python3 EACCES, gateway-socket-path and a malformed Windows C:\C:\.../2D%20Strategy... path. Git diff against the base confirms scripts are unchanged; this is not a green full suite or an assertion that those tests were run at the base before implementation. No workflow/security/tooling repair was attempted.

New tests cover label rectangle containment for all 56 display countries at four scales, concave anchors, font caps, real pointer drag/drop intent, stored-marker immobility, cancellation/Escape/lost capture, invalid drops, Ready locks and mid-drag revision changes. EuropeCommand tests cover exact command identities, read-only panels and intended-turn readiness.

Real in-app browser verification used normal signed local fixture Sov1 and the existing isolated home playtest, match 196b2135-26bf-4955-a7bb-7921692a274f. Observed full-height layout, Units inspection, country labels, invalid-drop rejection, successful valid land drag producing one queued order, persistence of that order after reload and cancellation of that exact test order. Final queue is empty; Ready remains Unready; no turn was advanced. These are real HTTP-backed UI observations, not injected transport fixtures. The two test commands advanced the queue revision normally. No recruitment, new combat/capture, capacity or new two-browser acceptance is claimed.

New-task correction history: pass 1 fixed readonly/optional presentation types found by typecheck; pass 2 completed the pointer-release path and moved inspection focus to an effect after tests/lint identified issues; pass 3 made the new DOM rectangle test stub configurable on rerender. Original implementation/repair histories remain separate.

The owner can reload the running home-PC app to review. No merge/deployment or hosted CI has been performed for this refinement. Publishing/commit identity and the final root typecheck outcome are recorded in the task handoff/status.

Final recovery correction (passes 4/5 and 5/5): development rebuilds restarted the server and exposed the initial-world manual recovery gap. Initial reads now retry automatically with the existing visibility/backoff helper and a 15-second timeout; the browser recovered without a Refresh click. A missing canvas during HMR is guarded. The new recovery regression passed; its changed error-copy assertion was updated without weakening private-error checks. Final full run: 2392 passed / 18 unchanged tooling failures / 326 skipped. No further implementation correction is authorized by this task after unresolved failures at five passes. All frontend cases pass.
