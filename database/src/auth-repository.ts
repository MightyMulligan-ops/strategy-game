import { randomUUID } from "node:crypto";
import { AuthenticatedPlayerSchema, UsernameSchema } from "@strategy-game/shared-types";
import type { AuthenticatedPlayer, OAuthProvider } from "@strategy-game/shared-types";
import type { PrismaClient, Prisma, OAuthProvider as StoredProvider } from "./generated/prisma/client.js";
import { AuthError } from "./auth-types.js";
import type { AuthPersistence, OAuthAttemptData, SessionWrite } from "./auth-types.js";
import { json } from "./mappings.js";
import { isLocalTestIdentity, localTestIdentity } from "./local-test-identities.js";
import type { LocalTestLoginPersistence, LocalTestPlayer } from "./local-test-identities.js";

const providerKey = (provider: OAuthProvider): StoredProvider => provider === "google" ? "GOOGLE" : "DISCORD";
const duplicate = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
const userInclude = { oauthAccounts: true } as const;
type PlayerRow = Prisma.PlayerIdentityGetPayload<{ include: typeof userInclude }>;
function publicPlayer(row: PlayerRow): AuthenticatedPlayer {
  return AuthenticatedPlayerSchema.parse({
    schemaVersion: 1, id: row.id, username: row.username,
    linkedProviders: row.oauthAccounts.map((account) => account.provider.toLowerCase()).sort()
  });
}

/** Trusted server operations only. No email lookup, account merging, or tokens. */
export class AuthRepository implements AuthPersistence, LocalTestLoginPersistence {
  constructor(private readonly client: PrismaClient) {}

  async profile(identityId: string) {
    const row = await this.client.playerIdentity.findUnique({ where: { id: identityId }, include: userInclude });
    return row ? publicPlayer(row) : null;
  }

  async signIn(provider: OAuthProvider, subject: string) {
    const key = { provider: providerKey(provider), subject };
    const existing = await this.client.oAuthAccount.findUnique({ where: { provider_subject: key } });
    if (existing) {
      if (isLocalTestIdentity(existing.identityId)) throw new AuthError("unauthorized");
      const player = await this.profile(existing.identityId);
      if (!player) throw new AuthError("unauthorized");
      return player;
    }
    try {
      const row = await this.client.playerIdentity.create({ data: {
        id: randomUUID(), oauthAccounts: { create: key }
      }, include: userInclude });
      return publicPlayer(row);
    } catch (error) {
      if (!duplicate(error)) throw error;
      // A concurrent callback may have created this same provider subject. The
      // nested create rolls back its losing identity rather than leaving orphans.
      const winner = await this.client.oAuthAccount.findUniqueOrThrow({ where: { provider_subject: key } });
      if (isLocalTestIdentity(winner.identityId)) throw new AuthError("unauthorized");
      const player = await this.profile(winner.identityId);
      if (!player) throw new AuthError("unauthorized");
      return player;
    }
  }

  async link(identityId: string, provider: OAuthProvider, subject: string) {
    // Local fixture sessions must never become a recovery path for a real account.
    if (isLocalTestIdentity(identityId)) throw new AuthError("identity_conflict");
    try {
      return await this.client.$transaction(async (tx) => {
        const player = await tx.playerIdentity.findUnique({ where: { id: identityId } });
        if (!player) throw new AuthError("unauthorized");
        const key = { provider: providerKey(provider), subject };
        const account = await tx.oAuthAccount.findUnique({ where: { provider_subject: key } });
        if (account && account.identityId !== identityId) throw new AuthError("identity_conflict");
        if (!account) await tx.oAuthAccount.create({ data: { ...key, identityId } });
        return publicPlayer(await tx.playerIdentity.findUniqueOrThrow({ where: { id: identityId }, include: userInclude }));
      });
    } catch (error) {
      if (duplicate(error)) throw new AuthError("identity_conflict");
      throw error;
    }
  }

  async selectUsername(identityId: string, input: string) {
    const username = UsernameSchema.parse(input);
    try {
      const changed = await this.client.playerIdentity.updateMany({
        where: { id: identityId, username: null }, data: { username, usernameKey: username.toLowerCase() }
      });
      if (changed.count !== 1) throw new AuthError("username_locked");
    } catch (error) {
      if (duplicate(error)) throw new AuthError("username_taken");
      throw error;
    }
    const player = await this.profile(identityId);
    if (!player) throw new AuthError("unauthorized");
    return player;
  }

  async signInLocalTest(player: LocalTestPlayer) {
    const id = localTestIdentity(player);
    if (!id) throw new AuthError("unauthorized");
    return this.client.$transaction(async (tx) => {
      // Keep the scalar upsert eligible for PostgreSQL ON CONFLICT; nested
      // relation selection can force Prisma's read/create fallback in a race.
      await tx.playerIdentity.upsert({ where: { id }, create: { id }, update: { id } });
      const row = await tx.playerIdentity.findUniqueOrThrow({ where: { id }, include: userInclude });
      // Refuse collisions; never detach/merge/claim an OAuth-linked identity.
      if (row.oauthAccounts.length !== 0) throw new AuthError("identity_conflict");
      return publicPlayer(row);
    });
  }

  async createAttempt(attempt: OAuthAttemptData) {
    await this.client.$transaction(async (tx) => {
      await tx.oAuthAttempt.deleteMany({ where: { sessionBinding: attempt.sessionBinding } });
      await tx.oAuthAttempt.create({ data: { ...attempt, provider: providerKey(attempt.provider) } });
    });
  }

  async consumeAttempt(state: string, provider: OAuthProvider, sessionBinding: string, targetIdentityId: string | null) {
    return this.client.$transaction(async (tx) => {
      const where = { state, provider: providerKey(provider), sessionBinding, targetIdentityId, expiresAt: { gt: new Date() } };
      const row = await tx.oAuthAttempt.findFirst({ where });
      if (!row || (await tx.oAuthAttempt.deleteMany({ where })).count !== 1) return null;
      return { ...row, provider };
    });
  }

  async createSession(id: string, session: SessionWrite) {
    await this.client.authSession.create({ data: { id, ...session, data: json(session.data) } });
  }

  async updateSession(id: string, expectedGeneration: string, session: SessionWrite) {
    const changed = await this.client.authSession.updateMany({
      where: { id, generation: expectedGeneration, revokedAt: null, expiresAt: { gt: new Date() } },
      // Preserve the original absolute expiry; reads never extend a session.
      data: { generation: session.generation, identityId: session.identityId, data: json(session.data) }
    });
    return changed.count === 1;
  }

  async readSession(id: string): Promise<SessionWrite | null> {
    const row = await this.client.authSession.findFirst({ where: { id, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!row || typeof row.data !== "object" || row.data === null || Array.isArray(row.data)) return null;
    return { generation: row.generation, identityId: row.identityId, expiresAt: row.expiresAt, data: row.data as Record<string, unknown> };
  }

  async revokeSession(id: string) {
    await this.client.authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllSessions(identityId: string) {
    await this.client.authSession.updateMany({ where: { identityId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
