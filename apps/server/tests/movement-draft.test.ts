import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MovementDraftError } from "@strategy-game/database";
import type { MovementDraftReady, ReadMovementDraft } from "@strategy-game/shared-types";
import type { LobbyPersistence } from "../src/lobbies/routes.js";
import { lobbyFixture } from "./lobby-fixture.js";
import { MemoryAuth } from "./memory-auth.js";
import { buildApp } from "../src/app.js";

const path = "/api/matches/match/turns/1/orders", formationId = `formation:${"a".repeat(64)}`;
const body = { schemaVersion: 1, kind: "replace_orders", expectedRevision: 0, orders: [] };
const ready = (revision = 0): MovementDraftReady => ({ schemaVersion: 1, matchId: "match", state: "READY",
  turn: { schemaVersion: 1, gameId: "match", turnNumber: 1, status: "open", openedAtMs: 1000, deadlineAtMs: 2000 },
  own: { schemaVersion: 1, gameId: "match", turnNumber: 1, revision, ready: false, orders: [] },
  route: { formationId, range: 250, distance: 0, remaining: 250, segments: [] } });
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
async function fixture() {
  const accounts = new MemoryAuth(), getDraft = vi.fn(async (): Promise<ReadMovementDraft> => ready()), submitDraft = vi.fn(async () => ready(1));
  const f = await lobbyFixture(accounts, {} as LobbyPersistence, undefined, undefined, undefined, undefined, { getDraft, submitDraft }); apps.push(f.app);
  const browser = await f.login();
  return { ...f, browser, accounts, getDraft, submitDraft };
}
function privateHeaders(headers: Record<string, unknown>) {
  expect(headers["cache-control"]).toBe("no-store"); expect(headers["referrer-policy"]).toBe("no-referrer"); expect(headers["x-content-type-options"]).toBe("nosniff");
}
describe("production movement draft GET/POST security", () => {
  it("uses the persisted session actor, one validated mutation and private headers", async () => {
    const f = await fixture(); const response = await f.request(f.browser, "POST", path, body);
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual(ready(1)); privateHeaders(response.headers);
    expect(f.submitDraft).toHaveBeenCalledExactlyOnceWith("match", 1, f.browser.identityId, body);
    const read = await f.app.inject({ url: `${path}?schemaVersion=1`, headers: { cookie: f.browser.cookie } });
    expect(read.statusCode).toBe(200); expect(f.getDraft).toHaveBeenCalledExactlyOnceWith("match", 1, f.browser.identityId); privateHeaders(read.headers);
  });
  it.each(["anonymous", "forged", "expired", "revoked", "onboarding"])("denies %s before persistence", async (kind) => {
    const f = await fixture();
    if (kind === "anonymous") f.browser.cookie = "";
    if (kind === "forged") f.browser.cookie = "sessionId=forged";
    if (kind === "expired") for (const [id, s] of f.accounts.sessions) f.accounts.sessions.set(id, { ...s, expiresAt: new Date(0) });
    if (kind === "revoked") await f.accounts.revokeAllSessions(f.browser.identityId);
    if (kind === "onboarding") f.browser = await f.login(null);
    const result = await f.request(f.browser, "GET", path); expect(result.statusCode).toBe(kind === "onboarding" ? 403 : 401);
    expect(f.getDraft).not.toHaveBeenCalled(); expect(f.submitDraft).not.toHaveBeenCalled(); privateHeaders(result.headers);
  });
  it.each(["missing-origin", "foreign-origin", "missing-csrf", "invalid-csrf"])("enforces %s on POST without reaching storage", async (kind) => {
    const f = await fixture(); const headers: Record<string, string> = { cookie: f.browser.cookie, origin: "http://127.0.0.1:5173", "x-csrf-token": f.browser.csrf };
    if (kind === "missing-origin") delete headers.origin;
    if (kind === "foreign-origin") headers.origin = "https://attacker.invalid";
    if (kind === "missing-csrf") delete headers["x-csrf-token"];
    if (kind === "invalid-csrf") headers["x-csrf-token"] = "forged";
    const result = await f.app.inject({ method: "POST", url: path, headers, payload: body });
    expect(result.statusCode).toBe(403); expect(f.submitDraft).not.toHaveBeenCalled(); privateHeaders(result.headers);
  });
  it.each([
    { ...body, schemaVersion: 2 }, { ...body, playerId: "enemy" }, { ...body, gameId: "other" }, { ...body, expectedRevision: -1 },
    { schemaVersion: 1, kind: "set_ready", expectedRevision: 0, ready: true },
    { ...body, orders: [{ type: "attack", orderId: "a", stackId: formationId, targetId: "other" }] },
    { ...body, orders: [{ type: "move", orderId: "a", stackId: formationId, destination: { x: .5, y: 0 } }] },
    { ...body, orders: [{ type: "move", orderId: "a", stackId: formationId, destination: { x: 0, y: 0 }, moveNumber: 1 }] }
  ])("rejects unsupported/untrusted body %j", async (input) => {
    const f = await fixture(); const result = await f.request(f.browser, "POST", path, input);
    expect(result.statusCode).toBe(400); expect(f.submitDraft).not.toHaveBeenCalled();
  });
  it.each(["schemaVersion=2", "schemaVersion=1&schemaVersion=1", "identityId=enemy", "now=1000", "runtime=movement-drafts-v1"])("strictly rejects query %s", async (query) => {
    const f = await fixture(); expect((await f.request(f.browser, "GET", `${path}?${query}`)).statusCode).toBe(400);
    expect((await f.request(f.browser, "POST", `${path}?${query}`, body)).statusCode).toBe(400);
    expect(f.getDraft).not.toHaveBeenCalled(); expect(f.submitDraft).not.toHaveBeenCalled();
  });
  it.each(["0", "01", "1.5", "NaN", "9007199254740992"])("rejects malformed turn path %s", async (turn) => {
    const f = await fixture(); expect((await f.request(f.browser, "GET", path.replace("turns/1/", `turns/${turn}/`))).statusCode).toBe(400);
    expect(f.getDraft).not.toHaveBeenCalled();
  });
  it.each([["NOT_FOUND", 404], ["INVALID_DRAFT", 422], ["STALE_REVISION", 409], ["DEADLINE_PASSED", 409], ["UNSUPPORTED_RUNTIME", 409], ["ORDER_NOT_FOUND", 409]] as const)("returns private %s status %i", async (code, status) => {
    const f = await fixture(); f.submitDraft.mockRejectedValue(new MovementDraftError(code));
    const result = await f.request(f.browser, "POST", path, body); expect(result.statusCode).toBe(status); expect(result.json()).toEqual({ schemaVersion: 1, error: code }); privateHeaders(result.headers);
  });
  it.each(["exception", "private-response", "wrong-match", "wrong-revision"])("sanitizes %s without logs leaking details", async (kind) => {
    const f = await fixture(), secret = "private-seed-database-session";
    if (kind === "exception") f.submitDraft.mockRejectedValue(new Error(secret));
    if (kind === "private-response") f.submitDraft.mockResolvedValue({ ...ready(1), seed: secret } as MovementDraftReady);
    if (kind === "wrong-match") f.submitDraft.mockResolvedValue({ ...ready(1), matchId: "other" });
    if (kind === "wrong-revision") f.submitDraft.mockResolvedValue(ready(2));
    const result = await f.request(f.browser, "POST", path, body); expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain(secret); expect(f.logs.join("\n")).not.toContain(secret); privateHeaders(result.headers);
  });
  it("retains rate limits and does not register Ready or gameplay routes", async () => {
    const f = await fixture();
    for (const action of ["ready", "resolve", "advance", "freeze"]) expect((await f.request(f.browser, "POST", path.replace("orders", action), body)).statusCode).toBe(404);
    let response = await f.request(f.browser, "GET", path);
    for (let i = 0; i < 65 && response.statusCode !== 429; i++) response = await f.request(f.browser, "GET", path);
    expect(response.statusCode).toBe(429); privateHeaders(response.headers);
  });
  it("exposes no draft API when authentication is disabled", async () => {
    const app = await buildApp({ movementDrafts: { getDraft: vi.fn(), submitDraft: vi.fn() } }); apps.push(app);
    expect((await app.inject({ url: path })).statusCode).toBe(404); expect((await app.inject({ method: "POST", url: path, payload: body })).statusCode).toBe(404);
  });
});
