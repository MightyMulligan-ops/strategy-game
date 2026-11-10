import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AuthRepository, createDatabaseClient } from "../src/index.js";
import { testDatabaseUrl } from "../src/environment.js";
import type { OAuthAttemptData, SessionWrite } from "../src/auth-types.js";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("PostgreSQL account/session persistence", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let repository: AuthRepository;
  const identities = new Set<string>();
  const sessions = new Set<string>();
  const states = new Set<string>();
  beforeAll(async () => {
    client = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    repository = new AuthRepository(client); await client.$connect();
  });
  afterEach(async () => {
    if (!client) return;
    const ids = [...identities];
    await client.$transaction(async (tx) => {
      await tx.oAuthAttempt.deleteMany({ where: { OR: [{ state: { in: [...states] } }, { targetIdentityId: { in: ids } }] } });
      await tx.authSession.deleteMany({ where: { OR: [{ id: { in: [...sessions] } }, { identityId: { in: ids } }] } });
      await tx.oAuthAccount.deleteMany({ where: { identityId: { in: ids } } });
      await tx.playerIdentity.deleteMany({ where: { id: { in: ids }, participants: { none: {} } } });
    });
    identities.clear(); sessions.clear(); states.clear();
  });
  afterAll(async () => { if (client) await client.$disconnect(); });

  async function player(provider: "google" | "discord" = "google", subject = randomUUID()) {
    const created = await repository.signIn(provider, subject); identities.add(created.id); return created;
  }
  function session(identityId: string, generation = "generation-1"): SessionWrite {
    return { identityId, generation, expiresAt: new Date(Date.now() + 60_000), data: {
      playerIdentityId: identityId, cookie: { expires: new Date(Date.now() + 60_000), originalMaxAge: null },
      __fastifySessionMetadata: { generation }
    } };
  }
  function attempt(): OAuthAttemptData {
    const state = randomUUID(); states.add(state);
    return { state, provider: "google", codeVerifier: "p".repeat(43), nonce: "test-nonce", sessionBinding: randomUUID(),
      targetIdentityId: null, expiresAt: new Date(Date.now() + 60_000) };
  }

  it("deduplicates concurrent provider identities and keeps subjects provider-scoped", async () => {
    const subject = randomUUID();
    const results = await Promise.all([player("google", subject), player("google", subject)]);
    expect(results[0]?.id).toBe(results[1]?.id);
    expect((await player("discord", subject)).id).not.toBe(results[0]?.id);
    expect(await client.oAuthAccount.count({ where: { provider: "GOOGLE", subject } })).toBe(1);
  });

  it("links only to the explicit owner and never transfers another account's provider identity", async () => {
    const owner = await player(); const discordSubject = randomUUID();
    expect(await repository.link(owner.id, "discord", discordSubject)).toMatchObject({ id: owner.id, linkedProviders: ["discord", "google"] });
    expect((await repository.signIn("discord", discordSubject)).id).toBe(owner.id);
    const other = await player();
    await expect(repository.link(other.id, "discord", discordSubject)).rejects.toMatchObject({ code: "identity_conflict" });
    await expect(repository.link(owner.id, "discord", randomUUID())).rejects.toMatchObject({ code: "identity_conflict" });
    expect((await repository.profile(other.id))?.linkedProviders).toEqual(["google"]);
  });

  it("enforces case-insensitive username uniqueness, including races, and disallows renaming", async () => {
    const first = await player(); const second = await player();
    const name = `Player_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const selected = await Promise.allSettled([repository.selectUsername(first.id, name), repository.selectUsername(second.id, name.toLowerCase())]);
    expect(selected.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(selected.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "username_taken" } });
    const winner = selected.find((result) => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("Expected username owner");
    await expect(repository.selectUsername(winner.value.id, "AnotherName")).rejects.toMatchObject({ code: "username_locked" });
    await expect(repository.selectUsername(first.id, "0invalid")).rejects.toThrow();
  });

  it("atomically consumes state once and binds it to provider, browser, target identity, and expiry", async () => {
    const flow = attempt(); await repository.createAttempt(flow);
    expect(await repository.consumeAttempt(flow.state, "google", "different-browser", null)).toBeNull();
    expect(await repository.consumeAttempt(flow.state, "discord", flow.sessionBinding, null)).toBeNull();
    expect(await repository.consumeAttempt(flow.state, "google", flow.sessionBinding, "different-user")).toBeNull();
    const consumed = await Promise.all([
      repository.consumeAttempt(flow.state, "google", flow.sessionBinding, null),
      repository.consumeAttempt(flow.state, "google", flow.sessionBinding, null)
    ]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
    const expired = { ...attempt(), expiresAt: new Date(0) }; await repository.createAttempt(expired);
    expect(await repository.consumeAttempt(expired.state, "google", expired.sessionBinding, null)).toBeNull();
  });

  it("persists session generations across clients without extending absolute expiry", async () => {
    const user = await player(); const id = randomUUID(); sessions.add(id);
    const original = session(user.id); await repository.createSession(id, original);
    const otherClient = createDatabaseClient(testDatabaseUrl(process.env.TEST_DATABASE_URL));
    try {
      const restarted = new AuthRepository(otherClient);
      expect((await restarted.readSession(id))?.identityId).toBe(user.id);
      expect(await restarted.updateSession(id, "generation-1", session(user.id, "generation-2"))).toBe(true);
      expect((await restarted.readSession(id))?.expiresAt).toEqual(original.expiresAt);
      expect(await repository.updateSession(id, "generation-1", session(user.id, "generation-3"))).toBe(false);
    } finally { await otherClient.$disconnect(); }
  });

  it("enforces expiry, logout, and global invalidation without allowing session resurrection", async () => {
    const user = await player(); const first = randomUUID(); const second = randomUUID(); const expired = randomUUID();
    [first, second, expired].forEach((id) => sessions.add(id));
    for (const id of [first, second]) await repository.createSession(id, session(user.id));
    await repository.createSession(expired, { ...session(user.id), expiresAt: new Date(0) });
    expect(await repository.readSession(expired)).toBeNull();
    await repository.revokeSession(first);
    expect(await repository.readSession(first)).toBeNull();
    expect(await repository.updateSession(first, "generation-1", session(user.id))).toBe(false);
    await expect(repository.createSession(first, session(user.id))).rejects.toThrow();
    expect(await repository.readSession(second)).not.toBeNull();
    await repository.revokeAllSessions(user.id);
    expect(await repository.readSession(second)).toBeNull();
  });
});
