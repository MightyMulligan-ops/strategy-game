import { StartingCreditsSchema } from "./city-economy.js";
import { z } from "zod";
import { UsernameSchema } from "./auth.js";
import { identifier, nonnegativeInteger, positiveInteger, version } from "./primitives.js";

export const LobbyCapacitySchema = z.number().int().min(2).max(40);
export const LobbyStatusSchema = z.enum(["OPEN", "RUNNING"]); // DRAFT is reserved, not supported in v1.
export const LobbyDurationCategorySchema = z.enum(["QUICK", "CASUAL", "UNCATEGORIZED"]);
export type LobbyDurationCategory = z.infer<typeof LobbyDurationCategorySchema>;

const minute = 60_000;
const hour = 60 * minute;
export const LOBBY_TURN_DURATION_PRESETS_MS = Object.freeze([5 * minute, 15 * minute, hour, 12 * hour, 24 * hour]);

function durationCategory(value: number): LobbyDurationCategory {
  if (value >= minute && value <= 12 * minute) return "QUICK";
  if (value >= 12 * hour && value <= 48 * hour) return "CASUAL";
  return "UNCATEGORIZED";
}

export function classifyLobbyTurnDuration(turnDurationMs: unknown): LobbyDurationCategory {
  return durationCategory(positiveInteger.parse(turnDurationMs));
}

export const LobbySettingsSchema = z.strictObject({
  name: identifier,
  playerCapacity: LobbyCapacitySchema,
  // Future turn initialization must check openedAtMs + turnDurationMs for safe
  // deadline arithmetic. Lobby start creates no turn/deadline.
  turnDurationMs: positiveInteger,
  startingCredits: StartingCreditsSchema.optional(),
  visibility: z.literal("PUBLIC")
}).readonly();
export type LobbySettings = z.infer<typeof LobbySettingsSchema>;

// A lobby-scoped public participant ID, never an OAuth subject, session ID,
// provider mapping, or authoritative account/database record.
export const LobbyParticipantSchema = z.strictObject({
  playerId: identifier, username: UsernameSchema, ready: z.boolean()
}).readonly();
export type LobbyParticipant = z.infer<typeof LobbyParticipantSchema>;

const summaryFields = {
  schemaVersion: version,
  lobbyId: identifier,
  settings: LobbySettingsSchema,
  status: LobbyStatusSchema,
  host: LobbyParticipantSchema,
  participantCount: z.number().int().min(1).max(40),
  readyCount: nonnegativeInteger.max(40),
  availableSlots: nonnegativeInteger.max(39),
  durationCategory: LobbyDurationCategorySchema
};

function checkSummary(summary: z.infer<typeof summaryBase>, context: z.RefinementCtx): void {
  if (summary.readyCount > summary.participantCount || (summary.host.ready && summary.readyCount === 0) ||
      (!summary.host.ready && summary.readyCount === summary.participantCount)) {
    context.addIssue({ code: "custom", path: ["readyCount"], message: "Readiness must agree with occupancy and host readiness" });
  }
  if (summary.participantCount > summary.settings.playerCapacity) {
    context.addIssue({ code: "custom", path: ["participantCount"], message: "Roster exceeds player capacity" });
  }
  const available = summary.status === "OPEN" ? summary.settings.playerCapacity - summary.participantCount : 0;
  if (summary.availableSlots !== available) {
    context.addIssue({ code: "custom", path: ["availableSlots"], message: "Available slots must match lifecycle and occupancy" });
  }
  if (summary.status === "RUNNING" && summary.participantCount < 2) {
    context.addIssue({ code: "custom", path: ["participantCount"], message: "Starting requires at least two participants" });
  }
  if (summary.durationCategory !== durationCategory(summary.settings.turnDurationMs)) {
    context.addIssue({ code: "custom", path: ["durationCategory"], message: "Duration category must match turn duration" });
  }
}
const summaryBase = z.strictObject(summaryFields);
export const LobbySummarySchema = summaryBase.superRefine(checkSummary).readonly();
export type LobbySummary = z.infer<typeof LobbySummarySchema>;

// These flags are a session-derived response projection, not client authority.
// Every lobby viewer must have a registered username; lobby viewing is not game spectating.
export const LobbyViewerSchema = z.strictObject({
  role: z.enum(["HOST", "PARTICIPANT", "NON_PARTICIPANT"]),
  playerId: identifier.nullable(),
  username: UsernameSchema,
  canJoin: z.boolean(),
  canLeave: z.boolean(),
  canStart: z.boolean()
}).readonly();
export type LobbyViewer = z.infer<typeof LobbyViewerSchema>;

export const LobbyDetailSchema = z.strictObject({
  ...summaryFields,
  participants: z.array(LobbyParticipantSchema).min(1).max(40).readonly(),
  viewer: LobbyViewerSchema
}).superRefine((lobby, context) => {
  checkSummary(lobby, context);
  const reject = (message: string) => context.addIssue({ code: "custom", message });
  if (lobby.participants.length !== lobby.participantCount) reject("Participant count must match the roster");
  if (lobby.readyCount !== lobby.participants.filter((player) => player.ready).length) reject("Ready count must match the roster");
  if (new Set(lobby.participants.map((player) => player.playerId)).size !== lobby.participants.length ||
      new Set(lobby.participants.map((player) => player.username.toLowerCase())).size !== lobby.participants.length) {
    reject("Roster IDs and registered usernames must be unique");
  }
  const host = lobby.participants.find((player) => player.playerId === lobby.host.playerId);
  if (!host || host.username !== lobby.host.username || host.ready !== lobby.host.ready) reject("The host must occur exactly once in the roster");
  const participant = lobby.participants.find((player) => player.playerId === lobby.viewer.playerId);
  const role = participant ? participant.playerId === lobby.host.playerId ? "HOST" : "PARTICIPANT" : "NON_PARTICIPANT";
  if (lobby.viewer.role !== role || (!participant && lobby.viewer.playerId !== null) ||
      (participant && participant.username !== lobby.viewer.username) ||
      (!participant && lobby.participants.some((player) => player.username.toLowerCase() === lobby.viewer.username.toLowerCase()))) {
    reject("Viewer identity and role must agree with the roster");
  }
  const open = lobby.status === "OPEN";
  if (lobby.viewer.canJoin !== (open && role === "NON_PARTICIPANT" && lobby.availableSlots > 0) ||
      lobby.viewer.canLeave !== (open && role === "PARTICIPANT") ||
      lobby.viewer.canStart !== (open && role === "HOST" && lobby.participantCount >= 2 && lobby.readyCount === lobby.participantCount)) {
    reject("Viewer permissions must agree with lifecycle, occupancy, and host role");
  }
}).readonly();
export type LobbyDetail = z.infer<typeof LobbyDetailSchema>;

export const CreateLobbyRequestSchema = z.strictObject({ schemaVersion: version, settings: LobbySettingsSchema }).readonly();
export type CreateLobbyRequest = z.infer<typeof CreateLobbyRequestSchema>;
export const ListLobbiesRequestSchema = z.strictObject({
  schemaVersion: version,
  status: LobbyStatusSchema.optional(),
  durationCategory: LobbyDurationCategorySchema.optional()
}).readonly();
export type ListLobbiesRequest = z.infer<typeof ListLobbiesRequestSchema>;

const lobbyIdRequestFields = { schemaVersion: version, lobbyId: identifier };
export const ViewLobbyRequestSchema = z.strictObject(lobbyIdRequestFields).readonly();
export const JoinLobbyRequestSchema = z.strictObject(lobbyIdRequestFields).readonly();
export const LeaveLobbyRequestSchema = z.strictObject(lobbyIdRequestFields).readonly();
export const StartLobbyRequestSchema = z.strictObject(lobbyIdRequestFields).readonly();
export const SetLobbyReadyRequestSchema = z.strictObject({ ...lobbyIdRequestFields, ready: z.boolean() }).readonly();
export type ViewLobbyRequest = z.infer<typeof ViewLobbyRequestSchema>;
export type JoinLobbyRequest = z.infer<typeof JoinLobbyRequestSchema>;
export type LeaveLobbyRequest = z.infer<typeof LeaveLobbyRequestSchema>;
export type StartLobbyRequest = z.infer<typeof StartLobbyRequestSchema>;
export type SetLobbyReadyRequest = z.infer<typeof SetLobbyReadyRequestSchema>;

// Optional context-dependent contract validation. The server must construct this
// detail from its authenticated, registered viewer and latest locked lobby state.
// Never accept a client-supplied detail/permissions object as this argument.
// This validates eligibility only: no membership, settings, or game state changes.
export function lobbyActionRequestSchema(action: "join" | "leave" | "start", trustedDetailInput: unknown) {
  const lobby = LobbyDetailSchema.parse(trustedDetailInput);
  return z.strictObject(lobbyIdRequestFields).superRefine((request, context) => {
    const allowed = action === "join" ? lobby.viewer.canJoin || lobby.viewer.role !== "NON_PARTICIPANT"
      : action === "leave" ? lobby.viewer.canLeave : action === "start" ? lobby.viewer.canStart : false;
    if (request.lobbyId !== lobby.lobbyId || !allowed) {
      context.addIssue({ code: "custom", message: "Lobby action is not eligible for this trusted viewer and state" });
    }
  }).readonly();
}

export const ListLobbiesResponseSchema = z.strictObject({
  schemaVersion: version,
  lobbies: z.array(LobbySummarySchema).refine((lobbies) => new Set(lobbies.map((lobby) => lobby.lobbyId)).size === lobbies.length,
    "List responses must not duplicate lobby IDs").readonly()
}).readonly();
export type ListLobbiesResponse = z.infer<typeof ListLobbiesResponseSchema>;
const detailResponseFields = { schemaVersion: version, lobby: LobbyDetailSchema };
export const ViewLobbyResponseSchema = z.strictObject(detailResponseFields).readonly();
export type ViewLobbyResponse = z.infer<typeof ViewLobbyResponseSchema>;
export const CreateLobbyResponseSchema = z.strictObject(detailResponseFields).refine(
  ({ lobby }) => lobby.status === "OPEN" && lobby.participantCount === 1 && lobby.readyCount === 0 && lobby.viewer.role === "HOST",
  "A new lobby is OPEN with its creator as the sole participant and host"
).readonly();
export type CreateLobbyResponse = z.infer<typeof CreateLobbyResponseSchema>;
export const JoinLobbyResponseSchema = z.strictObject({
  ...detailResponseFields, outcome: z.enum(["JOINED", "ALREADY_JOINED"])
}).refine(({ lobby, outcome }) => outcome === "JOINED"
  ? lobby.status === "OPEN" && lobby.viewer.role === "PARTICIPANT"
  : lobby.viewer.role !== "NON_PARTICIPANT", "Joining must return the caller's membership; only OPEN lobbies accept new members"
).readonly();
export type JoinLobbyResponse = z.infer<typeof JoinLobbyResponseSchema>;
export const LeaveLobbyResponseSchema = z.strictObject(detailResponseFields).refine(
  ({ lobby }) => lobby.status === "OPEN" && lobby.viewer.role === "NON_PARTICIPANT",
  "Leaving must return an OPEN lobby in which the viewer is no longer a participant"
).readonly();
export type LeaveLobbyResponse = z.infer<typeof LeaveLobbyResponseSchema>;
export const SetLobbyReadyResponseSchema = z.strictObject(detailResponseFields).refine(
  ({ lobby }) => lobby.status === "OPEN" && lobby.viewer.role !== "NON_PARTICIPANT",
  "Only an active participant in an OPEN lobby may set readiness"
).readonly();
export type SetLobbyReadyResponse = z.infer<typeof SetLobbyReadyResponseSchema>;
export const StartLobbyResponseSchema = z.strictObject({
  ...detailResponseFields, outcome: z.enum(["STARTED", "ALREADY_STARTED"])
}).refine(
  ({ lobby, outcome }) => lobby.status === "RUNNING" && lobby.viewer.role === "HOST" &&
    (outcome === "ALREADY_STARTED" || lobby.readyCount === lobby.participantCount),
  "Only the host may receive a successful start result with at least two participants"
).readonly();
export type StartLobbyResponse = z.infer<typeof StartLobbyResponseSchema>;

export const LobbyErrorResponseSchema = z.strictObject({
  schemaVersion: version,
  error: z.enum(["UNAUTHENTICATED", "USERNAME_REQUIRED", "NOT_FOUND", "LOBBY_NOT_OPEN", "LOBBY_FULL",
    "HOST_CANNOT_LEAVE", "HOST_REQUIRED", "NOT_A_PARTICIPANT", "NOT_ENOUGH_PARTICIPANTS", "NOT_ALL_READY",
    "INVALID_REQUEST", "INVALID_ORIGIN", "CSRF_REJECTED", "RATE_LIMITED", "INTERNAL_ERROR"])
}).readonly();
export type LobbyErrorResponse = z.infer<typeof LobbyErrorResponseSchema>;
