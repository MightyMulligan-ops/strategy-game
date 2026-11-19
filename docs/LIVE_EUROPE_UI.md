# Europe UI and automatic updates

Owner-started task, November 18, 2026. Baseline main b216e43b1d00dafab9fab62886ea16ac9cb25a85. The owner reported two-browser Turn 3 aftermath/survivor carryover and successful West logout while East retained refresh access. Those are owner-observed baseline results, not verification of this change.

## Scope

Frontend-only map cleanup, country identification and automatic refresh of existing lobby and repeating-planning GET projections. Main lobby visual redesign is deferred. No API, database, runtime, gameplay, auth/security, workflow, dependency, imagery or geometry changes.

Implementation paths: apps/web/src/{useAutoRefresh.ts,useAutoRefresh.test.tsx,App.css,App.test.tsx,LobbyBrowser.tsx,LoopWorkspace.tsx,LoopWorkspace.test.tsx,CombatAftermath.tsx}; apps/web/src/europe/{countries.ts,countries.test.ts,EuropeMap.tsx,EuropeMap.test.tsx,europe.css}; this document and DEVELOPMENT_STATUS.md. Same checkout, branch ui/live-europe-map. Existing untracked scripts/__pycache__ preserved.

## Automatic refresh

Visible online tabs check every 10 seconds. Lobby checks list plus the currently inspected room; repeating cohorts check the own current-turn projection. Requests do not overlap. Hidden/offline tabs pause; focus/visibility/online events wake checks. Failures back off to 20/40/60 seconds. Lobby and planning GETs time out after 15 seconds. Manual Refresh remains a recovery option. No POST is retried automatically. This uses existing HTTP endpoints and does not introduce WebSocket infrastructure or promise instantaneous push delivery.

Background planning refresh preserves selected formation, coordinate inputs, camera and inspected history when the response is unchanged. A new authoritative turn remounts its controls, clearing prior-turn selection/inputs and history. Own revision changes invalidate the historical inspection. Commands abort older reads before submission; reconciliation after a command preserves the map for the same turn. Authentication/access loss clears private planning/history and stops further automatic reads from that reader. Lobby drafts survive background roster changes. Polling pauses while a command is in flight; the server remains authoritative for acceptance and conflict checks.

Historical cohorts retain archived ownership wording. Europe uses current own camp wording; country geometry conveys no control. Historical aftermath is explicitly selected with Read own aftermath, not streamed or automatically advanced while being inspected. The countdown remains informational. Ten-second checks are not capacity certification; clients sharing an IP still share the existing limiter.

## Map cleanup

Match planning uses the full workspace width, with account controls below it. The city inspector and layer controls live in collapsed Map options above the map. Main camera controls remain available, with drawing/Spain shortcuts under More map tools. Map help is collapsed. Formation choices and current roster use readable presentation labels; technical identifiers/provenance remain in a disclosure. These display labels are not persistent army/unit names.

Country labels use the unchanged 56-country display geometry, with interior anchors and overlap suppression; tiny/offscreen countries omit faint labels. Pointer movement inside a country's polygon shows a compact name, including islands and excluding polygon holes/ocean. Find a country provides keyboard identification and camera centering. Borders, city labels and country names can be toggled independently. Identification does not consume map clicks or submit movement. No physical navigation masks or gameplay ownership data are used for this display feature.

## Verification history

Initial focused regression: 98 passed, one failure because an assertion still expected the replaced lobby-start sentence. Updated that copy assertion; no security/gameplay expectations were weakened. Correction pass 1/5 updated the copy assertion. Pass 2/5 corrected an optional RequestInit access in the new lobby test found by the full build. Both remain separate from prior implementation/repair histories.

New auto-refresh, stale-read/write, auth-loss, input preservation, country polygon/hole/ocean/anchor, collapsed map options and hover tests passed. Full frontend: 258 tests / 15 files passed. Web typecheck and lint passed. Final broader commands/results are recorded in DEVELOPMENT_STATUS.md after execution.

No database was connected or provisioned during this frontend task. No real-browser rendering, hands-on acceptance of the new layout, capacity certification, merge or deployment is claimed. The owner must apply/pull this source into their Windows checkout and restart pnpm dev before the running local site changes.
