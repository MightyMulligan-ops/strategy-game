import { describe, expect, it } from "vitest";
import { ReadTurnRequestSchema, ReadTurnResponseSchema, SetTurnReadyRequestSchema, SetTurnReadyResponseSchema, TurnErrorResponseSchema, TurnReadyPathSchema } from "../src/index.js";

const turn = { schemaVersion: 1, gameId: "match", turnNumber: 1, openedAtMs: 1_000, deadlineAtMs: 2_000, status: "open" };
const own = { schemaVersion: 1, gameId: "match", turnNumber: 1, revision: 0, ready: false, orders: [] };
const view = { schemaVersion: 1, matchId: "match", state: "READY", turn, own };
const request = { schemaVersion: 1, expectedRevision: 0, ready: true };

describe("006A versioned turn API contracts", () => {
  it("round-trips available, not-started and uninitialized views without authoritative data", () => {
    for (const value of [view, { schemaVersion: 1, matchId: "match", state: "NOT_STARTED" }, { schemaVersion: 1, matchId: "match", state: "UNINITIALIZED" }]) {
      expect(ReadTurnResponseSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    }
    expect(SetTurnReadyRequestSchema.parse(request)).toEqual(request);
    expect(SetTurnReadyResponseSchema.parse(view)).toEqual(view);
    expect(ReadTurnRequestSchema.parse({ schemaVersion: 1, matchId: "match" }).matchId).toBe("match");
  });
  it.each([null, [], {}, { ...request, schemaVersion: 2 }, { ...request, ready: "true" }, { ...request, expectedRevision: -1 },
    { ...request, expectedRevision: .5 }, { ...request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    ...["identityId", "playerId", "gameId", "turnNumber", "serverNowMs", "seed", "pinnedRuleset", "orders", "kind"].map((field) => ({ ...request, [field]: "forged" }))
  ])("rejects malformed or forged Ready payload %#", (value) => {
    expect(SetTurnReadyRequestSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    { ...view, seed: 123 }, { ...view, drafts: [] }, { ...view, own: { ...own, playerId: "other" } },
    { ...view, turn: { ...turn, frozenInput: {} } }, { ...view, own: { ...own, gameId: "other" } },
    { ...view, turn: { ...turn, gameId: "other" } }, { ...view, own: { ...own, turnNumber: 2 } },
    { schemaVersion: 1, matchId: "match", state: "UNINITIALIZED", own }, { ...view, schemaVersion: 2 }
  ])("rejects private, mismatched or unsupported views %#", (value) => {
    expect(ReadTurnResponseSchema.safeParse(value).success).toBe(false);
  });
  it("bounds paths and errors and requires canonical safe turn numbers", () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1"]) {
      expect(TurnReadyPathSchema.safeParse({ matchId: "match", turnNumber: value }).success).toBe(false);
    }
    expect(ReadTurnRequestSchema.safeParse({ schemaVersion: 1, matchId: " " }).success).toBe(false);
    expect(ReadTurnRequestSchema.safeParse({ schemaVersion: 1, matchId: "x".repeat(129) }).success).toBe(false);
    expect(TurnErrorResponseSchema.parse({ schemaVersion: 1, error: "STALE_REVISION" })).toEqual({ schemaVersion: 1, error: "STALE_REVISION" });
    expect(TurnErrorResponseSchema.safeParse({ schemaVersion: 1, error: "NOT_FOUND", match: {} }).success).toBe(false);
  });
});
