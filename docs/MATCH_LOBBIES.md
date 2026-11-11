# Multiplayer lobby contracts (Assignment 004B.2A / Issue #7)

**Scope:** Approved rules and strict version-1 transport contracts. There are no lobby endpoints, UI, database models/migrations, WebSockets, matchmaking, or working create/join/start operations. Existing authentication, turn resolution, and match persistence are unchanged.

## Access and lifecycle

- Every caller must be authenticated and have a registered username before listing, viewing, creating, joining, leaving, or starting. Existing account contracts still permit a null username during onboarding; the future lobby adapter must require a valid registered username separately.
- All supported lobbies are `PUBLIC`, discoverable by authenticated, registered users. Public discovery exposes lobby metadata, not game state or spectator access.
- Creation makes the authenticated creator the host and first participant. New lobbies begin `OPEN`. Capacity is **2–40 total player slots, including the host**; one host can create a lobby, but at least two participants must be present to start.
- Only `OPEN` lobbies admit new participants. Non-host participants may leave while `OPEN`. The host cannot leave before start. Only the host may start, and the roster must contain at least two participants.
- Starting changes the lobby status to `RUNNING` and fixes its roster. No new joining or leaving is permitted afterward. The existing engine's fixed active-roster behavior remains unchanged.
- `DRAFT` is reserved for future use and rejected by the current public contracts. Cancellation, host transfer, completion states, and reopening need later decisions; no such command or status is added here.

| Current state | Operation | Required trusted context | Result represented by the contracts |
|---|---|---|---|
| No lobby | Create | Authenticated creator with username; valid settings | `OPEN`, host is the sole participant |
| `OPEN` | New join | Caller is not a participant; at least one available slot | Caller becomes a non-host participant |
| `OPEN` or `RUNNING` | Duplicate join | Caller already belongs to the roster | `ALREADY_JOINED`; same membership, no new slot consumed |
| `OPEN` | Leave | Caller is a non-host participant | Caller is no longer in the roster; host remains |
| `OPEN` | Start | Caller is the host; at least two participants | `RUNNING`; joining/leaving locked |
| `OPEN` or `RUNNING` | List/view | Authenticated caller with username | Authorized lobby metadata only |

Duplicate joining is idempotent, including an existing member retrying when the lobby is full. A retry can acknowledge existing membership after start without changing the roster. It cannot admit a late participant. Durable request receipts, start/leave retry semantics, HTTP status mapping, and transaction implementation remain later API work. Membership/capacity checks and start must eventually use one server serialization boundary so concurrent requests cannot overfill or alter a started roster. No concurrency implementation is introduced by these schemas.

## Fixed settings and timing

Version-1 `LobbySettings` contains a nonempty, already-trimmed `name`, `playerCapacity`, `turnDurationMs`, and literal `visibility: PUBLIC`. All settings are immutable after creation, including the name. There is no configuration-update request. Name validation is a transport convention, not a new gameplay balance rule; product payload/name-length limits remain to be decided before endpoints.

Durations use the existing JSON-safe positive integer millisecond convention. They are not limited to the presets or named categories. Zero, fractions, unsafe integers, nonfinite numbers, and numeric strings are rejected. Existing `GameConfig` is not narrowed or extended.

Accepting a duration in this shared contract does **not** guarantee it can be scheduled. Before committing a match/start, the future server must validate the trusted `openedAtMs` timestamp and compute `deadlineAtMs = openedAtMs + turnDurationMs` using safe-integer arithmetic. Require `Number.isSafeInteger(deadlineAtMs)` and a deadline later than opening; reject an unsupported deadline before committing any match/start state. For example, `Number.MAX_SAFE_INTEGER` is a valid duration, but adding it to `openedAtMs = 1` overflows the safe-integer range. The existing turn metadata schema rejects that deadline. This contracts-only assignment adds no scheduler, persistence change, or arbitrary duration cap; the approved categories/presets are unchanged.

| Category | Inclusive turn-duration range |
|---|---|
| `QUICK` | 60,000–720,000 ms (1–12 minutes) |
| `CASUAL` | 43,200,000–172,800,000 ms (12–48 hours) |
| `UNCATEGORIZED` | Every other valid positive-safe integer duration |

Initial presets are **5 minutes, 15 minutes, 1 hour, 12 hours, and 24 hours**. The 15-minute and 1-hour presets are uncategorized. Categories and presets are original project rules approved in Issue #7; they do not introduce a maximum match duration, deadline scheduler, or new turn advancement behavior. Hybrid deadline/unanimous-Ready closure remains authoritative once turns exist.

Era, map, scenario, teams, countries, starting resources, victory conditions, and maximum match duration are not selectable in these requests. An empty-world fixture may support internal development testing only. Even its identifier is rejected as a player-selected scenario. No public option presents an empty fixture as playable content.

## Public data and viewer permissions

`LobbyParticipant` contains only a lobby-scoped opaque `playerId` and a valid registered `username`. This ID is separate from a provider subject, session ID, account database record, or authoritative game identity mapping. The future server owns the mapping from the authenticated account to its lobby participant. It never accepts it from request bodies.

A summary contains `schemaVersion`, `lobbyId`, settings, lifecycle, the public host record, participant count, available slots, and derived duration category. Count includes the host. `availableSlots` means slots currently available to new joiners: capacity minus participant count while `OPEN`, and zero after `RUNNING`. Summaries do not include the roster or the requesting user's viewer projection.

A detail additionally contains the public roster and the caller's session-derived `viewer` projection. IDs and case-insensitive registered usernames must be unique, the host must appear exactly once, and reported counts must match the roster. The caller's username must be registered; an existing participant's ID/username must match that roster entry. A non-participant has `playerId: null` and cannot masquerade as an existing username.

| Viewer role | Join a new slot | Leave | Start |
|---|---|---|---|
| `HOST` | No; already a member | No | Only while `OPEN` with at least two participants |
| `PARTICIPANT` | No; already a member | Only while `OPEN` | No |
| `NON_PARTICIPANT` | Only while `OPEN` with room | No | No |

All flags are false after `RUNNING`. Existing-membership join acknowledgements remain possible without a new join permission. Viewing a public lobby's settings/roster confers no authorization to observe its turns, drafts, map, units, economy, or hidden state. Spectator and fog-of-war policies remain unresolved.

Strict schemas reject unknown fields recursively. Summaries/details reject OAuth subjects, emails, provider mappings/tokens, session data, internal account IDs, drafts, snapshots, seeds, and authoritative game state. The future server must explicitly build the safe projection before transmission; it must not send a private record and rely on UI hiding. Schema validation cannot prove authentication, ownership, freshness, or that two IDs refer to the same real account.

## Contracts and validation boundary

All public exports live in `packages/shared-types/src/lobby.ts` and the existing public barrel. Nested records are covered by their enclosing version. Each request and response envelope uses `schemaVersion: 1`. Parsed objects/arrays are readonly and frozen; caller-owned inputs are copied rather than frozen or mutated.

| Operation | Request | Successful response |
|---|---|---|
| Create | `CreateLobbyRequest`: version and settings only | `CreateLobbyResponse`: `OPEN` detail, creator/host, exactly one participant |
| List | `ListLobbiesRequest`: version and optional status/duration-category filters | `ListLobbiesResponse`: unique-ID array of safe summaries, including an empty list |
| View | `ViewLobbyRequest`: version and lobby ID | `ViewLobbyResponse`: safe detail for the current authenticated caller |
| Join | `JoinLobbyRequest`: version and lobby ID | `JoinLobbyResponse`: member detail plus `JOINED` or `ALREADY_JOINED`; a new member requires `OPEN` |
| Leave | `LeaveLobbyRequest`: version and lobby ID | `LeaveLobbyResponse`: `OPEN` detail showing the caller as a non-participant |
| Start | `StartLobbyRequest`: version and lobby ID | `StartLobbyResponse`: `RUNNING` detail for the host with at least two participants |

Request bodies accept no acting player/account ID, username, host field, permission flag, roster, or state override. The operation will be selected by a future trusted transport adapter; this assignment chooses no REST paths. Strict error envelopes contain only a version and one enumerated safe code; they never carry raw exception details. Error precedence and HTTP mapping are not implemented.

Context-free requests validate payload shape. `lobbyActionRequestSchema(action, trustedDetail)` additionally checks the target lobby and the current viewer's join/leave/start eligibility, including host-only start and minimum occupancy. It parses a **server-constructed, current, session-bound** detail, never a client-supplied context. It is a pure schema factory: no command execution, membership mutation, persistence, network, clock, or game-state transition occurs. Successful parsing is not a durable acknowledgement. A later server must recheck under its transaction boundary, authorize the session, apply the action, commit, and then return the appropriate response.

The existing `GameConfig`, `GamePlayer`, account schemas, authoritative snapshots, resolver, and repository are preserved. Old engine/internal fixtures with one active player continue to validate; the 2–40 capacity and two-participant start constraints apply to the new lobby boundary. Mapping lobby lifecycle/identifiers into persisted matches and turn orchestration is future implementation work.

## Future decisions

Private/password/invite-only access; spectator authorization and fog-of-war restrictions; late joining/cutoff turns; host transfer and cancellation; teams; victory conditions and maximum match duration; country selection and starting resources; real era/map/scenario initialization; payload limits/pagination; request receipts and command error precedence. None of these is silently implemented by this contract assignment.

Reference observations and differences are recorded in [ATWAR_REFERENCE.md](ATWAR_REFERENCE.md). The approved project rules above take precedence over reference-game behavior.
