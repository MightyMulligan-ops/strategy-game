import type { AuthenticatedPlayer, OAuthProvider } from "@strategy-game/shared-types";

export type OAuthAttemptData = Readonly<{
  state: string; provider: OAuthProvider; sessionBinding: string;
  targetIdentityId: string | null; codeVerifier: string; nonce: string | null; expiresAt: Date;
}>;
export type SessionWrite = Readonly<{
  generation: string; identityId: string | null; data: Record<string, unknown>; expiresAt: Date;
}>;

export interface AuthPersistence {
  profile(identityId: string): Promise<AuthenticatedPlayer | null>;
  signIn(provider: OAuthProvider, subject: string): Promise<AuthenticatedPlayer>;
  link(identityId: string, provider: OAuthProvider, subject: string): Promise<AuthenticatedPlayer>;
  selectUsername(identityId: string, username: string): Promise<AuthenticatedPlayer>;
  createAttempt(attempt: OAuthAttemptData): Promise<void>;
  consumeAttempt(state: string, provider: OAuthProvider, sessionBinding: string, targetIdentityId: string | null): Promise<OAuthAttemptData | null>;
  createSession(id: string, session: SessionWrite): Promise<void>;
  updateSession(id: string, expectedGeneration: string, session: SessionWrite): Promise<boolean>;
  readSession(id: string): Promise<SessionWrite | null>;
  revokeSession(id: string): Promise<void>;
  revokeAllSessions(identityId: string): Promise<void>;
}

export class AuthError extends Error {
  constructor(readonly code: "identity_conflict" | "username_taken" | "username_locked" | "unauthorized") {
    super(code);
    this.name = "AuthError";
  }
}
