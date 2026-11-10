import type { Session } from "fastify";
import type { SessionStore } from "@fastify/session";
import type { AuthPersistence, SessionWrite } from "@strategy-game/database";

declare module "fastify" {
  interface Session {
    playerIdentityId?: string;
    __fastifySessionMetadata?: { generation: string };
  }
}
const missing = () => Object.assign(new Error("Session is expired, revoked, or replaced"), { code: "ENOENT" });

export class PersistentSessionStore implements SessionStore {
  constructor(private readonly persistence: AuthPersistence, private readonly ttlMs: number) {}

  private serialize(id: string, session: Session): SessionWrite {
    return {
      generation: session.__fastifySessionMetadata?.generation ?? id,
      identityId: session.playerIdentityId ?? null,
      data: JSON.parse(JSON.stringify(session)) as Record<string, unknown>,
      expiresAt: new Date(Date.now() + this.ttlMs)
    };
  }

  set(id: string, session: Session, callback: (error?: Error) => void) {
    this.persistence.createSession(id, this.serialize(id, session)).then(() => callback(), () => callback(missing()));
  }

  compareAndSet(id: string, expectedGeneration: string, session: Session, callback: (error?: Error) => void) {
    this.persistence.updateSession(id, expectedGeneration, this.serialize(id, session))
      .then((changed) => callback(changed ? undefined : missing()), () => callback(missing()));
  }

  get(id: string, callback: (error: Error | null, session?: Session | null) => void) {
    this.persistence.readSession(id).then((record) => {
      if (!record) return callback(null, null);
      const { cookie, __fastifySessionMetadata: metadata, playerIdentityId } = record.data;
      if (typeof cookie !== "object" || cookie === null ||
          typeof metadata !== "object" || metadata === null || !("generation" in metadata) || metadata.generation !== record.generation ||
          (playerIdentityId ?? null) !== record.identityId) return callback(null, null);
      callback(null, { ...record.data, cookie: { ...cookie, originalMaxAge: null, expires: record.expiresAt } } as Session);
    }, () => callback(new Error("Session store unavailable")));
  }

  destroy(id: string, callback: (error?: Error) => void) {
    this.persistence.revokeSession(id).then(() => callback(), () => callback(new Error("Session store unavailable")));
  }
}
