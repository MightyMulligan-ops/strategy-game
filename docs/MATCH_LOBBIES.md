# Multiplayer lobby contracts (Assignment 004B.2A / Issue #7)

**Scope:** Public lobby contracts, PostgreSQL persistence, authenticated REST endpoints, Sovereign UI, and player readiness/host-controlled lifecycle start (005A / Issue #17). WebSockets, matchmaking, Turn 1 and world initialization remain future work. See [LOBBY_API.md](LOBBY_API.md) for HTTP/security and [database documentation](../database/README.md) for migration safeguards. Existing auth behavior and deterministic turns are preserved.

## Access and lifecycle

- Every caller must be authenticated and have a registered username before listing, viewing, creating, joining, leaving, setting readiness or starting. Existing account contracts still permit a null username during onboarding; the HTTP adapter and repository separately enforce registered usernames.
- All supported lobbies are `PUBLIC`, discoverable by authenticated, registered users. Public discovery exposes lobby metadata, not game state or spectator access.
- Creation makes the authenticated creator the host and first participant. New lobbies begin `OPEN`. Capacity is **2–40 total player slots, including the host**; one host can create a lobby, but at least two participants must be present to start.
- Only `OPEN` lobbies admit new participants. Non-host participants may leave while `OPEN`. The host cannot leave before start. Only the host may start, with at least two active participants and **all active participants, including the host, READY**.
- New/rejoining participants are NOT_READY. Each active participant may set only their own boolean readiness while OPEN. Duplicate active joins preserve readiness; leaving clears it and removes that player from readiness/count checks. Lobby readiness is separate from per-turn `PlayerTurnState.ready` and never resolves a turn.
- Starting changes the lobby status to `RUNNING` and fixes its roster. No new joining or leaving is permitted afterward. The existing engine's fixed active-roster behavior remains unchanged.
- `DRAFT` is reserved for future use and rejected by the current public contracts. Cancellation, host transfer, completion states, and reopening need later decisions; no such command or status is added here.

| Current state | Operation | Required trusted context | Result represented by the contracts |
|---|---|---|---|
| No lobby | Create | Authenticated creator with username; valid settings | `OPEN`, host is the sole participant |
| `OPEN` | New join | Caller is not a participant; at least one available slot | Caller becomes a non-host participant |
| `OPEN` | Duplicate join | Caller already belongs to the roster | `ALREADY_JOINED`; same membership, no new slot consumed |
| `OPEN` | Leave | Caller is a non-host participant | Caller is no longer in the roster; host remains |
| `OPEN` | Set readiness | Caller is an active participant | Explicit own READY/NOT_READY value; repeated value is idempotent |
| `OPEN` | Start | Caller is host; at least two active participants; all READY | `STARTED`, `RUNNING`; joining/leaving/readiness locked |
| `RUNNING` | Start retry | Caller is still the host | `ALREADY_STARTED`, current RUNNING detail; no initialization |
| `OPEN` or `RUNNING` | List/view | Authenticated caller with username | Authorized lobby metadata only |

Duplicate joining is idempotent while OPEN, including when full. **Issue #9 / owner clarification:** every RUNNING join is rejected, including duplicate retries. Contracts can structurally represent an acknowledgement; persistence enforces the stricter rule. Membership, readiness and start all lock the parent Match before reading lifecycle/roster in a ReadCommitted transaction. A waiter re-reads committed state. Start checks host, occupancy and all readiness under that lock, then conditionally updates only OPEN to RUNNING. Results follow commit. Concurrent starts yield one STARTED and subsequent ALREADY_STARTED results; non-host retries remain forbidden. No durable request receipt is added.

Issue #17 authorizes the lifecycle transition only. It preserves configuration/duration/state version and creates no world, runtime pins, snapshot, turn or deadline. A RUNNING lobby is not a playable match yet. Future world/turn initialization requires its own approved design and atomic/idempotent boundary.

## Fixed settings and timing

Version-1 `LobbySettings` contains a nonempty, already-trimmed `name`, `playerCapacity`, `turnDurationMs`, and literal `visibility: PUBLIC`. All settings are immutable after creation, including the name. There is no configuration-update request. Name validation is a transport convention, not a new gameplay balance rule; product payload/name-length limits remain to be decided before endpoints.

Durations use the existing JSON-safe positive integer millisecond convention. They are not limited to the presets or named categories. Zero, fractions, unsafe integers, nonfinite numbers, and numeric strings are rejected. Existing `GameConfig` is not narrowed or extended.

Accepting a duration does **not** guarantee it can be scheduled. Issue #17's lifecycle-only start inherits the existing duration and does not open a turn or sample a clock. When future orchestration opens a turn, it must validate trusted `openedAtMs` and compute `deadlineAtMs = openedAtMs + turnDurationMs` using safe-integer arithmetic before committing that initialization. Require `Number.isSafeInteger(deadlineAtMs)` and a deadline later than opening. For example, `Number.MAX_SAFE_INTEGER` is a valid duration, but adding `openedAtMs = 1` overflows. Existing turn metadata rejects that deadline. No scheduler or arbitrary duration cap is added; categories/presets remain unchanged.

| Category | Inclusive turn-duration range |
|---|---|
| `QUICK` | 60,000–720,000 ms (1–12 minutes) |
| `CASUAL` | 43,200,000–172,800,000 ms (12–48 hours) |
| `UNCATEGORIZED` | Every other valid positive-safe integer duration |

Initial presets are **5 minutes, 15 minutes, 1 hour, 12 hours, and 24 hours**. The 15-minute and 1-hour presets are uncategorized. Categories and presets are original project rules approved in Issue #7; they do not introduce a maximum match duration, deadline scheduler, or new turn advancement behavior. Hybrid deadline/unanimous-Ready closure remains authoritative once turns exist.

Era, map, scenario, teams, countries, starting resources, victory conditions, and maximum match duration are not selectable in these requests. An empty-world fixture may support internal development testing only. Even its identifier is rejected as a player-selected scenario. No public option presents an empty fixture as playable content.

## Public data and viewer permissions

`LobbyParticipant` contains only a lobby-scoped opaque `playerId`, registered `username` and required boolean `ready`. This ID is separate from provider/session/account IDs. The server owns the identity mapping and never accepts it from request bodies.

A summary contains `schemaVersion`, `lobbyId`, settings, lifecycle, public host record, participant count, `readyCount`, available slots and derived duration category. Counts include the host; readyCount cannot exceed occupancy and must agree with host readiness. Details additionally validate readyCount and host readiness against the roster. `availableSlots` is capacity minus occupancy while OPEN, zero after RUNNING. Summaries exclude roster/viewer data.

A detail additionally contains the public roster and the caller's session-derived `viewer` projection. IDs and case-insensitive registered usernames must be unique, the host must appear exactly once, and reported counts must match the roster. The caller's username must be registered; an existing participant's ID/username must match that roster entry. A non-participant has `playerId: null` and cannot masquerade as an existing username.

| Viewer role | Join a new slot | Leave | Start |
|---|---|---|---|
| `HOST` | No; already a member | No | Only while `OPEN`, at least two participants, all READY |
| `PARTICIPANT` | No; already a member | Only while `OPEN` | No |
| `NON_PARTICIPANT` | Only while `OPEN` with room | No | No |

All flags are false after `RUNNING`; the repository also rejects existing-membership join acknowledgements after start. Viewing a public lobby's settings/roster confers no authorization to observe its turns, drafts, map, units, economy, or hidden state. Spectator and fog-of-war policies remain unresolved.

Strict schemas reject unknown fields recursively. Summaries/details reject OAuth subjects, emails, provider mappings/tokens, session data, internal account IDs, drafts, snapshots, seeds, and authoritative game state. The future server must explicitly build the safe projection before transmission; it must not send a private record and rely on UI hiding. Schema validation cannot prove authentication, ownership, freshness, or that two IDs refer to the same real account.

## Contracts and validation boundary

All public exports live in `packages/shared-types/src/lobby.ts` and its public barrel. Nested records are covered by their enclosing version. Envelopes retain `schemaVersion: 1`; Issue #17 explicitly evolves this pre-release contract with required readiness fields, NOT_ALL_READY and start outcomes. Deploy/rebuild shared-types, server and frontend together; old strict clients are not compatible with the new fields. Parsed objects/arrays are readonly/frozen; caller inputs are copied, not mutated.

| Operation | Request | Successful response |
|---|---|---|
| Create | `CreateLobbyRequest`: version and settings only | `CreateLobbyResponse`: `OPEN` detail, creator/host, exactly one participant |
| List | `ListLobbiesRequest`: version and optional status/duration-category filters | `ListLobbiesResponse`: unique-ID array of safe summaries, including an empty list |
| View | `ViewLobbyRequest`: version and lobby ID | `ViewLobbyResponse`: safe detail for the current authenticated caller |
| Join | `JoinLobbyRequest`: version and lobby ID | `JoinLobbyResponse`: member detail plus `JOINED` or `ALREADY_JOINED`; a new member requires `OPEN` |
| Leave | `LeaveLobbyRequest`: version and lobby ID | `LeaveLobbyResponse`: `OPEN` detail showing the caller as a non-participant |
| Ready | `SetLobbyReadyRequest`: version, lobby ID, boolean ready | `SetLobbyReadyResponse`: OPEN detail for an active member |
| Start | `StartLobbyRequest`: version and lobby ID | `StartLobbyResponse`: RUNNING host detail, STARTED or ALREADY_STARTED; STARTED requires all READY |

Request bodies accept no acting player/account ID, username, host field, permission flag, roster or state override. HTTP selects the route and derives identity only from a persistent session. Paths, path-owned IDs and error precedence are in [LOBBY_API.md](LOBBY_API.md). Errors contain only a version and safe enumerated code, never raw exceptions.

Context-free requests validate shape. `lobbyActionRequestSchema(action, trustedDetail)` checks target and join/leave/start eligibility, including host, minimum count and all-ready state. It parses a **server-constructed, current, session-bound** detail, never client context. It is a pure schema factory, with no command execution or persistence. Successful parsing is not a durable acknowledgement. HTTP authenticates the session and delegates current-state checks to repository transactions; responses follow commit. Viewer flags never authorize writes.

The existing `GameConfig`, `GamePlayer`, account schemas, snapshots, resolver and `MatchRepository` are preserved. One-player internal fixtures still validate; capacity and start constraints apply at the lobby boundary. `LobbyRepository` maps session identities to persisted membership and public projections. HTTP authentication/CSRF and lifecycle start are implemented; gameplay commands and turn orchestration remain future work.

## Future decisions

Private/password/invite-only access; spectator authorization and fog-of-war restrictions; late joining/cutoff turns; host transfer and cancellation; teams; victory conditions and maximum match duration; country selection and starting resources; real era/map/scenario initialization; payload limits/pagination; request receipts and command error precedence. None of these is silently implemented by this contract assignment.

Reference observations and differences are recorded in [ATWAR_REFERENCE.md](ATWAR_REFERENCE.md). The approved project rules above take precedence over reference-game behavior.
