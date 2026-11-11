import type { AuthPersistence } from "@strategy-game/database";
import type { FastifyReply, FastifyRequest } from "fastify";

export function privateResponseHeaders(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Content-Type-Options", "nosniff");
}

export function sameOrigin(request: FastifyRequest, origin: string): boolean {
  return request.headers.origin === origin;
}

/** The signed, persisted session is the only source of the acting identity. */
export async function sessionPlayer(request: FastifyRequest, persistence: AuthPersistence) {
  const id = request.session.playerIdentityId;
  return id ? persistence.profile(id) : null;
}
