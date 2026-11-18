# Repeating combat loop — Issue105 frozen contract

Owner-started from905ee35dc67e271fb64b613f0be83257b7c169fb in the existing checkout.
Owner authorizes this loop/gameplay/contracts, additive offline SQL, tests, one
draft publication, unchanged fresh disposable hosted PostgreSQL CI and author
review/merge after required checks. Independent review is waived, never claimed.
No existing database, deployment, agents, paid API, dependencies, security,
workflows or instructions change. Prior A3/5+repair1/2, B5/5, C0/5 remain historical;
new task starts0/5. Issue70 remains broader backlog, not automatically completed.

## Versions and transition frozen before implementation

New pin combat-loop/1, simulation combat-loop-v1, chronological-speed-v1 geometry.
Private state10 loop_state, frozen5 loop_frozen, result4 loop_result, commit1
loop_commit (deterministic result plus trusted nextOpenedAtMs). Public current1
loop_current; history1 loop_aftermath; formation gate4. Historical validators and
combat-turn/1 remain strict and stop at Turn1. No backfill or GET repair.

State version N is exactly the result of Turn N and starts Turn N+1. Genesis0
alone recruits the original six units. State IDs hash complete canonical metadata,
including immutable predecessor resolution, policies and carried city owners.
All surviving HP/provenance/membership/positions/relationships carry unchanged
from established completed-battle healing. No extra between-turn healing, army
regeneration, world regeneration, elimination or victory. Destroyed players stay
active and may Ready empty queues. Each new turn starts empty revision0/unready,
with a fresh250 per-formation budget. Leader-only surviving formations may move;
leaderless groups cannot. The existing singleton Infantry source-radius policy is
null/unapproved: reject SOURCE_RADIUS_UNAPPROVED, never invent/reset a radius.

Frozen seeds use a versioned uint32 permutation of world seed and turn counter:
(worldSeed + N - 1) modulo2^32, unique across supported counter space. Include a
full match/turn/state seed identity in the frozen input and per-encounter identity.
The technical uint32 counter exhausts before opening beyond4294967295; fail closed
without partial outcome, rather than reuse seeds. This is RNG representation
exhaustion, not a gameplay victory/capacity policy or promised operating lifetime.

Resolution is pure and independent of opening wall time. Under Match-first lock,
commit result + next state + previous RESOLVED + exactly one next OPEN turn and its
revision-zero histories + Match version advance together. Trusted opening sample
comes after complete resolution, >= prior observed time; deadline=opening+fixed
configured duration, safe integer checked. Overdue restart gives one full window,
never recursive catch-up. SQL acceptance/commit clock guards remain exact-window.
Work/clock/storage failures roll back to frozen CLOSED; no partial next planning.

Reads verify state hashes/identities and immediate predecessor/result/successor
semantic replay, relying on immutable SQL-sealed earlier records. Query footprint
is constant in number of turns (current, adjacent predecessor and genesis), not
whole-match replay. Revision replay is linear in accepted revisions for those
turns; no fabricated capacity/SLO claim. Bounded worker scans at most configured
batch; one processed match advances at most one turn per tick, same shutdown bound.

Dedicated /loop/current and /loop/turns/N/{commands,aftermath} routes bind exact
intended N in body/path plus expected revision. Existing routes/validators remain
historical. Histories fetch one exact completed turn, no whole-match dump. New
allowlists expose own formations/HP/provenance/orders, own currently owned city IDs
and own bounded aftermath only. Archive/map colors remain initial; no enemy current
ownership/position/roster/HP/order/seed/audit/timing is inferred or transmitted.
UI keys match and current turn, clears routes/selection/countdowns/history on turn
switch; GET refresh after uncertain writes, never automatic POST replay.

## Frozen allowed path manifest

README.md; docs/REPEATING_COMBAT.md; docs/DEVELOPMENT_STATUS.md;
packages/shared-types/src/{server.ts,index.ts,loop.ts,movement-resolution-view.ts};
packages/game-engine/src/{combat-turn.ts,combat-loop.ts,server.ts};
packages/game-engine/tests/combat-loop.test.ts;
database/src/{loop-storage.ts,loop-repository.ts,loop-view.ts,lobby-repository.ts,
turn-storage.ts,turn-read-repository.ts,formation-read-repository.ts,index.ts};
database/prisma/migrations/202611170002_repeating_combat/migration.sql;
database/tests/{loop-fixture.ts,loop-storage.test.ts,loop-migration.test.ts,loop.integration.test.ts};
apps/server/src/{app.ts,index.ts,turns/loop-routes.ts,turns/deadline-worker.ts};
apps/server/tests/{lobby-fixture.ts,loop-routes.test.ts,loop.integration.test.ts,loop-worker.test.ts};
apps/web/src/{LoopWorkspace.tsx,LoopWorkspace.test.tsx,Formations.tsx,WorldView.tsx,CombatAftermath.tsx}.

## Internal acceptance checkpoints

1. Strict contracts and pure Turn1→2→3→4, repeated battle/synthetic capture carryover,
   seed uniqueness, budget/leadership/no-army/time failures, historical regressions.
2. Persisted chain, exact-turn revisions/deadlines, atomic next opening, bounded
   worker; auth/Origin/CSRF and privacy projection; real fresh-hosted concurrency,
   rollback/restart and forged-chain rejection. SQL authored offline only.
3. Current-turn controls, informational countdown, explicit bounded own-history
   navigation, no stale response/route reuse or POST retries; own positions/ownership
   separate from archive; accessibility/error/auth boundaries.
4. Frozen install/generation/full checks, exact scoped diff, draft and exact-head
   hosted required checks; author review then authorized merge only when green.

No terrain restrictions, economy/recruitment/supply processing, diplomacy UI,
Europe/Figma/HUD redesign, animation, capacity certification or deployment.

Before API adapters: turn-read-repository.ts is included to project the new runtime
through its already-generic own turn status contract without a legacy reader error.

## Acceptance evidence map (execution results recorded per checkpoint)

| Requirement | Executable evidence |
|---|---|
| New pin/historical isolation | LoopRuntimeSchema; creation-only lobby branch; old literal-one contracts unchanged; full historical suites; migration admission-body equivalence guard |
| Exact carryover/reset across1→2→3→4 | combat-loop.test.ts2/4/40; loop-storage.test.ts durable rows/replay; loop.integration.test.ts real2/4/40 state/window/order/Ready reset/restart |
| Complete repeated combat/capture/HP/provenance | Pure synthetic two-battle scenario, failure budget and no resurrection; hosted synthetic allied capture into4 then second campaign through7, adjacent survivors and preserved own history; explicit fixture-only common InfantryHP70 to reduce stochastic fragility, production7/4/6 unchanged |
| No armies/leadership/original source/budget | Empty-army Ready, destroyed/foreign formation rejection, preserved source IDs and unapproved singleton-radius rejection; in-bounds return route proves fresh budget |
| Time and exact commands | Full window after overdue restart, rollback/overflow rejection; strict body/path/expected revision, Ready locks/Unready/deadline and delayed-body tests |
| Atomic next turn and recovery | Nine fake durable-stage rollback injections; six hosted write-stage constraints; duplicate/concurrent resolvers, restart, immutable history and forged sequential insertion rejection |
| Privacy/security | Explicit own allowlist projection; signed HTTP membership/session/Origin/CSRF/private headers; strict response identity; no server audits/seeds/enemy state in transport |
| Current UI and bounded history | LoopWorkspace.test.tsx: selection/order clearing, ownership versus archive, Ready without armies, exact historical query, GET-only reconciliation after uncertain write, stale body/history/reconnect/auth/match/unmount |
| Bounded execution | Existing worker only; one transition per visit, persisted eligible work scan capped by batch; no recursive catch-up/new scheduler. Constant number of state/turn rows read; indexed count checks still scale linearly with stored turn count and revision replay with accepted commands. No SLO/capacity certification |

SQL is complementary structural/transaction integrity, not a duplicate RNG engine.
Applications replay semantic predecessor/result/successor consistency for inspected
adjacent turns; older history relies on SQL immutability. This is not cryptographic
attestation of an arbitrarily rewritten whole database. Hosted migration/runtime
results remain pending until actually observed. No existing database was accessed.
