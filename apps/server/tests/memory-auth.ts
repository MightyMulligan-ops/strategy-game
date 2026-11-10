import { randomUUID } from "node:crypto";
import { AuthError } from "@strategy-game/database";
import type { AuthPersistence, OAuthAttemptData, SessionWrite } from "@strategy-game/database";
import type { AuthenticatedPlayer, OAuthProvider } from "@strategy-game/shared-types";

// Unit-test double only. Runtime startup always uses PostgreSQL.
export class MemoryAuth implements AuthPersistence {
  users = new Map<string, AuthenticatedPlayer>();
  accounts = new Map<string, string>();
  attempts = new Map<string, OAuthAttemptData>();
  sessions = new Map<string, SessionWrite>();
  revoked = new Set<string>();
  async profile(id: string) { return this.users.get(id) ?? null; }
  async signIn(provider: OAuthProvider, subject: string) {
    const key = `${provider}:${subject}`;
    let id = this.accounts.get(key);
    if (!id) { id = randomUUID(); this.accounts.set(key, id); this.users.set(id, { schemaVersion: 1, id, username: null, linkedProviders: [provider] }); }
    return this.users.get(id)!;
  }
  async link(id: string, provider: OAuthProvider, subject: string) {
    const key = `${provider}:${subject}`;
    const existing = this.accounts.get(key);
    const user = this.users.get(id)!;
    if (existing && existing !== id || !existing && user.linkedProviders.includes(provider)) throw new AuthError("identity_conflict");
    this.accounts.set(key, id);
    const updated = { ...user, linkedProviders: [...new Set([...user.linkedProviders, provider])].sort() };
    this.users.set(id, updated);
    return updated;
  }
  async selectUsername(id: string, username: string) {
    const user = this.users.get(id)!;
    if (user.username) throw new AuthError("username_locked");
    if ([...this.users.values()].some((other) => other.username?.toLowerCase() === username.toLowerCase())) throw new AuthError("username_taken");
    const updated = { ...user, username }; this.users.set(id, updated); return updated;
  }
  async createAttempt(attempt: OAuthAttemptData) {
    for (const [id, existing] of this.attempts) if (existing.sessionBinding === attempt.sessionBinding) this.attempts.delete(id);
    this.attempts.set(attempt.state, attempt);
  }
  async consumeAttempt(state: string, provider: OAuthProvider, binding: string, target: string | null) {
    const attempt = this.attempts.get(state);
    if (!attempt || attempt.provider !== provider || attempt.sessionBinding !== binding || attempt.targetIdentityId !== target || attempt.expiresAt <= new Date()) return null;
    this.attempts.delete(state); return attempt;
  }
  async createSession(id: string, data: SessionWrite) {
    if (this.sessions.has(id)) throw new Error("duplicate session"); this.sessions.set(id, structuredClone(data));
  }
  async updateSession(id: string, expected: string, next: SessionWrite) {
    const old = await this.readSession(id);
    if (!old || old.generation !== expected) return false;
    this.sessions.set(id, structuredClone({ ...next, expiresAt: old.expiresAt })); return true;
  }
  async readSession(id: string) {
    const stored = this.sessions.get(id);
    return stored && !this.revoked.has(id) && stored.expiresAt > new Date() ? structuredClone(stored) : null;
  }
  async revokeSession(id: string) { this.revoked.add(id); }
  async revokeAllSessions(id: string) {
    for (const [key, session] of this.sessions) if (session.identityId === id) this.revoked.add(key);
  }
}
