import { describe, expect, it } from "vitest";
import {
  AuthenticatedPlayerSchema, GameConfigSchema, GamePlayerSchema,
  LOBBY_TURN_DURATION_PRESETS_MS, classifyLobbyTurnDuration, lobbyActionRequestSchema,
  CreateLobbyRequestSchema, CreateLobbyResponseSchema, ListLobbiesRequestSchema, ListLobbiesResponseSchema,
  ViewLobbyRequestSchema, ViewLobbyResponseSchema, JoinLobbyRequestSchema, JoinLobbyResponseSchema,
  LeaveLobbyRequestSchema, LeaveLobbyResponseSchema, StartLobbyRequestSchema, StartLobbyResponseSchema,
  LobbyDetailSchema, LobbySummarySchema, LobbyErrorResponseSchema
} from "../src/index.js";

const host = { playerId: "lobby-player-host", username: "Commander" };
const member = { playerId: "lobby-player-member", username: "Captain" };
const settings = { name: "World Conquest", playerCapacity: 4, turnDurationMs: 900_000, visibility: "PUBLIC" };
const request = { schemaVersion: 1, lobbyId: "lobby-1" };
const creation = { schemaVersion: 1, settings };
function opening() {
  return {
    ...request, settings: { ...settings }, status: "OPEN", host: { ...host }, participantCount: 2, availableSlots: 2,
    durationCategory: "UNCATEGORIZED", participants: [{ ...host }, { ...member }],
    viewer: { role: "HOST", ...host, canJoin: false, canLeave: false, canStart: true }
  };
}
function guest() {
  return { ...opening(), viewer: { role: "NON_PARTICIPANT", playerId: null, username: "Visitor", canJoin: true, canLeave: false, canStart: false } };
}
function participant() {
  return { ...opening(), viewer: { role: "PARTICIPANT", ...member, canJoin: false, canLeave: true, canStart: false } };
}
function started() {
  return { ...opening(), status: "STARTED", availableSlots: 0,
    viewer: { ...opening().viewer, canStart: false } };
}
function alone() {
  return { ...opening(), participantCount: 1, availableSlots: 3, participants: [{ ...host }],
    viewer: { ...opening().viewer, canStart: false } };
}
function summary() {
  const { participants: _participants, viewer: _viewer, ...value } = opening();
  return value;
}
const response = (lobby: unknown) => ({ schemaVersion: 1, lobby });

describe("lobby creation and approved settings", () => {
  it.each([2, 40])("supports capacity %i including the creator", (playerCapacity) => {
    expect(CreateLobbyRequestSchema.parse({ ...creation, settings: { ...settings, playerCapacity } }).settings.playerCapacity).toBe(playerCapacity);
  });
  it.each([0, 1, 41, -1, 2.5, "10", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid capacity %s", (playerCapacity) => {
    expect(CreateLobbyRequestSchema.safeParse({ ...creation, settings: { ...settings, playerCapacity } }).success).toBe(false);
  });
  it.each([0, -1, 0.5, "60000", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid duration %s", (turnDurationMs) => {
    expect(CreateLobbyRequestSchema.safeParse({ ...creation, settings: { ...settings, turnDurationMs } }).success).toBe(false);
  });
  it.each([1, Number.MAX_SAFE_INTEGER])("retains existing positive-safe duration convention for %i", (turnDurationMs) => {
    expect(CreateLobbyRequestSchema.safeParse({ ...creation, settings: { ...settings, turnDurationMs } }).success).toBe(true);
  });
  it.each(["", " ", " World", "World\n"])("rejects blank/untrimmed lobby name %j", (name) => {
    expect(CreateLobbyRequestSchema.safeParse({ ...creation, settings: { ...settings, name } }).success).toBe(false);
  });
  it.each(["PRIVATE", "INVITE_ONLY", "PASSWORD"])("does not implement %s access", (visibility) => {
    expect(CreateLobbyRequestSchema.safeParse({ ...creation, settings: { ...settings, visibility } }).success).toBe(false);
  });
  it.each(["eraId", "scenarioId", "mapId", "teams", "startingFunds", "victoryCondition", "joinCutoffTurn", "maxMatchDurationMs"])("rejects unsupported setting %s", (field) => {
    expect(CreateLobbyRequestSchema.safeParse({ ...creation, settings: { ...settings, [field]: "unsupported" } }).success).toBe(false);
  });
  it("rejects even the internal empty-world scenario as a player-selected setting", () => {
    expect(CreateLobbyRequestSchema.safeParse({ ...creation, settings: { ...settings, scenarioId: "empty-turn-v1" } }).success).toBe(false);
  });
  it("requires explicit settings and creates only an OPEN one-host response", () => {
    expect(CreateLobbyRequestSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
    expect(CreateLobbyRequestSchema.safeParse({ ...creation, status: "OPEN" }).success).toBe(false);
    expect(CreateLobbyResponseSchema.safeParse(response(alone())).success).toBe(true);
    for (const lobby of [opening(), started(), guest()]) expect(CreateLobbyResponseSchema.safeParse(response(lobby)).success).toBe(false);
  });
});

describe("Quick/Casual duration classification", () => {
  it.each([
    [1, "UNCATEGORIZED"], [59_999, "UNCATEGORIZED"], [60_000, "QUICK"], [720_000, "QUICK"],
    [720_001, "UNCATEGORIZED"], [900_000, "UNCATEGORIZED"], [3_600_000, "UNCATEGORIZED"],
    [43_199_999, "UNCATEGORIZED"], [43_200_000, "CASUAL"], [172_800_000, "CASUAL"],
    [172_800_001, "UNCATEGORIZED"], [Number.MAX_SAFE_INTEGER, "UNCATEGORIZED"]
  ])("classifies %s ms as %s", (duration, expected) => {
    expect(classifyLobbyTurnDuration(duration)).toBe(expected);
  });
  it("pins the five approved presets without restricting other valid durations", () => {
    expect(LOBBY_TURN_DURATION_PRESETS_MS).toEqual([300_000, 900_000, 3_600_000, 43_200_000, 86_400_000]);
    expect(LOBBY_TURN_DURATION_PRESETS_MS.map(classifyLobbyTurnDuration)).toEqual(["QUICK", "UNCATEGORIZED", "UNCATEGORIZED", "CASUAL", "CASUAL"]);
    expect(Object.isFrozen(LOBBY_TURN_DURATION_PRESETS_MS)).toBe(true);
  });
  it("rejects invalid classification inputs instead of coercing them", () => {
    for (const value of [0, -1, NaN, Infinity, "60000", null]) expect(() => classifyLobbyTurnDuration(value)).toThrow();
  });
});

describe("strict request and response privacy", () => {
  it.each([
    ["create", CreateLobbyRequestSchema, creation], ["list", ListLobbiesRequestSchema, { schemaVersion: 1 }],
    ["view", ViewLobbyRequestSchema, request], ["join", JoinLobbyRequestSchema, request],
    ["leave", LeaveLobbyRequestSchema, request], ["start", StartLobbyRequestSchema, request]
  ])("rejects identity/authority spoofing in %s requests", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(true);
    for (const field of ["playerId", "identityId", "accountId", "host", "hostPlayerId", "username", "viewer", "canStart", "settingsUpdate"]) {
      expect(schema.safeParse({ ...input, [field]: "spoofed" }).success).toBe(false);
    }
    expect(schema.safeParse({ ...input, schemaVersion: 2 }).success).toBe(false);
  });
  it.each(["accountId", "oauthAccounts", "session", "providerSubject", "snapshot", "drafts", "units", "turnState"])("excludes %s from summaries", (field) => {
    expect(LobbySummarySchema.safeParse({ ...summary(), [field]: "private" }).success).toBe(false);
  });
  it("rejects sensitive nested participant/settings/viewer data and game spectator permissions", () => {
    const lobby = opening();
    for (const input of [
      { ...lobby, host: { ...host, email: "private@example.test" } },
      { ...lobby, participants: [{ ...host, accessToken: "private" }, member] },
      { ...lobby, viewer: { ...lobby.viewer, sessionId: "private" } },
      { ...lobby, viewer: { ...lobby.viewer, canSpectate: true } },
      { ...lobby, settings: { ...settings, rulesModule: () => undefined } }
    ]) expect(LobbyDetailSchema.safeParse(input).success).toBe(false);
    expect(LobbySummarySchema.safeParse(lobby).success).toBe(false); // No roster or own-viewer data in list summaries.
  });
  it("returns only strict error codes without exception messages or private records", () => {
    expect(LobbyErrorResponseSchema.safeParse({ schemaVersion: 1, error: "USERNAME_REQUIRED" }).success).toBe(true);
    for (const extra of [{ message: "private exception" }, { session: {} }, { schemaVersion: 2 }, { error: "UNKNOWN" }]) {
      expect(LobbyErrorResponseSchema.safeParse({ schemaVersion: 1, error: "NOT_FOUND", ...extra }).success).toBe(false);
    }
  });
});

describe("lifecycle, roster, and coherent viewer projections", () => {
  it.each(["DRAFT", "CLOSED", "CANCELLED", "RUNNING", "FINISHED"])("reserves/rejects unsupported lifecycle %s", (status) => {
    expect(LobbySummarySchema.safeParse({ ...summary(), status }).success).toBe(false);
  });
  it.each([
    { participantCount: 0 }, { participantCount: 5 }, { participantCount: 1.5 }, { availableSlots: 3 },
    { availableSlots: -1 }, { durationCategory: "QUICK" }, { schemaVersion: 2 },
    { status: "STARTED", participantCount: 1, availableSlots: 0 }
  ])("rejects inconsistent summary %#", (change) => {
    expect(LobbySummarySchema.safeParse({ ...summary(), ...change }).success).toBe(false);
  });
  it("supports a full 40-player roster and closes every remaining slot on start", () => {
    const players = [host, ...Array.from({ length: 39 }, (_, index) => ({ playerId: `player-${index}`, username: `Player_${index}` }))];
    const full = { ...opening(), settings: { ...settings, playerCapacity: 40 }, participants: players, participantCount: 40, availableSlots: 0 };
    expect(LobbyDetailSchema.safeParse(full).success).toBe(true);
    expect(LobbyDetailSchema.safeParse(started()).success).toBe(true);
    expect(LobbyDetailSchema.safeParse({ ...started(), availableSlots: 2 }).success).toBe(false);
  });
  it.each([
    { participants: [host] }, { participants: [member, { playerId: "other", username: "Other" }] },
    { participants: [host, { ...member, playerId: host.playerId }] },
    { participants: [host, { ...member, username: "commander" }] },
    { participants: [host, { ...member, username: null }] },
    { participants: [host, { ...member, username: "bad name" }] },
    { host: { ...host, username: "Wrong" } }
  ])("rejects inconsistent or unregistered roster %#", (change) => {
    expect(LobbyDetailSchema.safeParse({ ...opening(), ...change }).success).toBe(false);
  });
  it.each([
    { role: "PARTICIPANT" }, { playerId: "unknown" }, { username: "Other" }, { username: null },
    { canJoin: true }, { canLeave: true }, { canStart: false }
  ])("rejects incoherent host viewer %#", (change) => {
    expect(LobbyDetailSchema.safeParse({ ...opening(), viewer: { ...opening().viewer, ...change } }).success).toBe(false);
  });
  it("enforces participant and non-participant identity/permissions", () => {
    expect(LobbyDetailSchema.safeParse(participant()).success).toBe(true);
    expect(LobbyDetailSchema.safeParse(guest()).success).toBe(true);
    for (const change of [{ canStart: true }, { canJoin: true }, { canLeave: false }]) {
      expect(LobbyDetailSchema.safeParse({ ...participant(), viewer: { ...participant().viewer, ...change } }).success).toBe(false);
    }
    for (const change of [{ playerId: "unknown" }, { username: "commander" }, { canStart: true }, { canLeave: true }]) {
      expect(LobbyDetailSchema.safeParse({ ...guest(), viewer: { ...guest().viewer, ...change } }).success).toBe(false);
    }
  });
  it("freezes parsed nested values without freezing/mutating caller-owned data", () => {
    const input = opening(); const before = JSON.stringify(input); const parsed = LobbyDetailSchema.parse(input);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(input);
    expect(JSON.stringify(input)).toBe(before); expect(Object.isFrozen(input)).toBe(false);
    for (const value of [parsed, parsed.settings, parsed.participants, parsed.participants[0], parsed.viewer]) expect(Object.isFrozen(value)).toBe(true);
  });
});

describe("context-dependent action contracts (no execution)", () => {
  it("permits only an OPEN host with at least two participants to request start", () => {
    expect(lobbyActionRequestSchema("start", opening()).safeParse(request).success).toBe(true);
    for (const context of [alone(), participant(), guest(), started()]) {
      expect(lobbyActionRequestSchema("start", context).safeParse(request).success).toBe(false);
    }
    expect(lobbyActionRequestSchema("start", opening()).safeParse({ ...request, lobbyId: "other" }).success).toBe(false);
    expect(lobbyActionRequestSchema("start", opening()).safeParse({ ...request, viewer: opening().viewer }).success).toBe(false);
  });
  it("permits new members only when OPEN and below capacity", () => {
    expect(lobbyActionRequestSchema("join", guest()).safeParse(request).success).toBe(true);
    const full = { ...guest(), settings: { ...settings, playerCapacity: 2 }, availableSlots: 0,
      viewer: { ...guest().viewer, canJoin: false } };
    expect(lobbyActionRequestSchema("join", full).safeParse(request).success).toBe(false);
    const locked = { ...guest(), status: "STARTED", availableSlots: 0, viewer: { ...guest().viewer, canJoin: false } };
    expect(lobbyActionRequestSchema("join", locked).safeParse(request).success).toBe(false);
  });
  it("represents duplicate joins as existing membership without admitting anyone", () => {
    for (const context of [opening(), participant(), started()]) {
      expect(lobbyActionRequestSchema("join", context).safeParse(request).success).toBe(true);
      expect(JoinLobbyResponseSchema.safeParse({ ...response(context), outcome: "ALREADY_JOINED" }).success).toBe(true);
    }
    expect(JoinLobbyResponseSchema.safeParse({ ...response(guest()), outcome: "ALREADY_JOINED" }).success).toBe(false);
    expect(JoinLobbyResponseSchema.safeParse({ ...response(participant()), outcome: "JOINED" }).success).toBe(true);
    for (const context of [opening(), started(), guest()]) expect(JoinLobbyResponseSchema.safeParse({ ...response(context), outcome: "JOINED" }).success).toBe(false);
  });
  it("permits leaving only for an OPEN non-host participant", () => {
    expect(lobbyActionRequestSchema("leave", participant()).safeParse(request).success).toBe(true);
    const lockedMember = { ...participant(), status: "STARTED", availableSlots: 0, viewer: { ...participant().viewer, canLeave: false } };
    for (const context of [opening(), alone(), guest(), lockedMember]) expect(lobbyActionRequestSchema("leave", context).safeParse(request).success).toBe(false);
    expect(LeaveLobbyResponseSchema.safeParse(response(guest())).success).toBe(true);
    for (const context of [opening(), participant(), started()]) expect(LeaveLobbyResponseSchema.safeParse(response(context)).success).toBe(false);
  });
  it("requires a STARTED host view for successful start responses", () => {
    expect(StartLobbyResponseSchema.safeParse(response(started())).success).toBe(true);
    const lockedMember = { ...participant(), status: "STARTED", availableSlots: 0, viewer: { ...participant().viewer, canLeave: false } };
    for (const context of [opening(), alone(), lockedMember]) expect(StartLobbyResponseSchema.safeParse(response(context)).success).toBe(false);
  });
});

describe("listing, viewing, and legacy compatibility", () => {
  it("supports empty and filtered listings without inventing private access or era filters", () => {
    expect(ListLobbiesRequestSchema.safeParse({ schemaVersion: 1, status: "OPEN", durationCategory: "CASUAL" }).success).toBe(true);
    expect(ListLobbiesResponseSchema.safeParse({ schemaVersion: 1, lobbies: [] }).success).toBe(true);
    const list = { schemaVersion: 1, lobbies: [summary(), { ...summary(), lobbyId: "lobby-2" }] };
    expect(ListLobbiesResponseSchema.safeParse(list).success).toBe(true);
    expect(ListLobbiesResponseSchema.safeParse({ ...list, lobbies: [summary(), summary()] }).success).toBe(false);
    for (const change of [{ visibility: "PRIVATE" }, { eraId: "modern" }, { schemaVersion: 2 }, { durationCategory: "FAST" }]) {
      expect(ListLobbiesRequestSchema.safeParse({ schemaVersion: 1, ...change }).success).toBe(false);
    }
  });
  it("validates viewing wrappers and rejects unsupported versions at either level", () => {
    expect(ViewLobbyResponseSchema.safeParse(response(guest())).success).toBe(true);
    expect(ViewLobbyResponseSchema.safeParse({ ...response(guest()), schemaVersion: 2 }).success).toBe(false);
    expect(ViewLobbyResponseSchema.safeParse(response({ ...guest(), schemaVersion: 2 })).success).toBe(false);
  });
  it("keeps existing GameConfig, roster, and incomplete account contracts unchanged", () => {
    expect(GameConfigSchema.safeParse({ schemaVersion: 1, gameId: "game", turnDurationMs: 1 }).success).toBe(true);
    expect(GamePlayerSchema.safeParse({ schemaVersion: 1, gameId: "game", playerId: "one", active: true }).success).toBe(true);
    expect(AuthenticatedPlayerSchema.safeParse({ schemaVersion: 1, id: "account", username: null, linkedProviders: ["discord"] }).success).toBe(true);
    expect(GameConfigSchema.safeParse({ schemaVersion: 1, gameId: "game", turnDurationMs: 1, playerCapacity: 4 }).success).toBe(false);
  });
});
