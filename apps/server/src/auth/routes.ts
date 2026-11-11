import cookie from "@fastify/cookie";
import session from "@fastify/session";
import csrf from "@fastify/csrf-protection";
import rateLimit from "@fastify/rate-limit";
import { OAuthProviderSchema, UsernameSelectionSchema } from "@strategy-game/shared-types";
import { AuthError, isLocalTestIdentity, localTestIdentity } from "@strategy-game/database";
import type { AuthPersistence, LocalTestLoginPersistence, LocalTestPlayer } from "@strategy-game/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthConfig } from "./config.js";
import { createOAuthClient } from "./providers.js";
import type { OAuthClient } from "./providers.js";
import { PersistentSessionStore } from "./session-store.js";
import { privateResponseHeaders, sameOrigin, sessionPlayer } from "./security.js";

export type Authentication = Readonly<{ config: AuthConfig; persistence: AuthPersistence; oauth?: OAuthClient; localTestLogin?: LocalTestLoginPersistence }>;

export async function registerAuthentication(app: FastifyInstance, options: Authentication) {
  const { config, persistence } = options;
  const oauth = options.oauth ?? createOAuthClient(config);
  const cookieName = config.secureCookies ? "__Host-strategy_session" : "strategy_session";
  await app.register(cookie);
  await app.register(session, {
    secret: config.sessionSecret, cookieName, store: new PersistentSessionStore(persistence, config.sessionTtlMs, config.devLoginEnabled),
    saveUninitialized: false, rolling: false,
    cookie: { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/", maxAge: config.sessionTtlMs }
  });
  await app.register(csrf, {
    sessionPlugin: "@fastify/session",
    getToken: (request) => typeof request.headers["x-csrf-token"] === "string" ? request.headers["x-csrf-token"] : undefined,
    // The plugin logs fixed messages only. Use a standard logger method so
    // logger:false test/app instances also return 403 instead of a TypeError.
    logLevel: "debug"
  });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/auth/")) return;
    privateResponseHeaders(reply);
    if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request, config.origin)) {
      return reply.code(403).send({ error: "invalid_origin" });
    }
  });
  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!await sessionPlayer(request, persistence)) return reply.code(401).send({ error: "unauthorized" });
  };
  const mutation = { onRequest: [app.csrfProtection] };
  const authenticatedMutation = { onRequest: [requireUser, app.csrfProtection] };
  app.get("/auth/config", async () => ({ enabled: true, providers: Object.keys(config.providers), devLoginEnabled: config.devLoginEnabled }));
  app.get("/auth/csrf", async (_request, reply) => ({ csrfToken: reply.generateCsrf() }));
  app.get("/auth/me", { onRequest: requireUser }, async (request) => ({ user: await persistence.profile(request.session.playerIdentityId!) }));

  if (config.devLoginEnabled) app.post("/auth/dev-login", mutation, async (request, reply) => {
    if (request.session.playerIdentityId) return reply.code(409).send({ error: "already_authenticated" });
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !Object.hasOwn(body, "fixture") || !("fixture" in body) || !localTestIdentity(body.fixture)) return reply.code(400).send({ error: "invalid_fixture" });
    let user;
    try { user = await options.localTestLogin!.signInLocalTest(body.fixture as LocalTestPlayer); }
    catch (error) {
      if (error instanceof AuthError) return reply.code(409).send({ error: "fixture_unavailable" });
      throw error;
    }
    if (user.id !== localTestIdentity(body.fixture) || user.linkedProviders.length !== 0) {
      return reply.code(409).send({ error: "fixture_unavailable" });
    }
    await request.session.regenerate();
    request.session.playerIdentityId = user.id;
    await request.session.save();
    return { user };
  });

  async function begin(request: FastifyRequest, reply: FastifyReply, linking: boolean) {
    const parsed = OAuthProviderSchema.safeParse((request.params as { provider?: string }).provider);
    if (!parsed.success || !config.providers[parsed.data]) return reply.code(404).send({ error: "provider_unavailable" });
    if (!linking && request.session.playerIdentityId) return reply.code(409).send({ error: "use_account_linking" });
    if (linking && request.session.playerIdentityId && isLocalTestIdentity(request.session.playerIdentityId)) {
      return reply.code(409).send({ error: "fixture_unavailable" });
    }
    const flow = await oauth.begin(parsed.data);
    await request.session.save();
    await persistence.createAttempt({
      state: flow.state, provider: parsed.data, sessionBinding: request.session.sessionId,
      targetIdentityId: linking ? request.session.playerIdentityId! : null,
      codeVerifier: flow.codeVerifier, nonce: flow.nonce, expiresAt: new Date(Date.now() + 10 * 60_000)
    });
    return { authorizationUrl: flow.authorizationUrl };
  }
  app.post("/auth/login/:provider", mutation, (request, reply) => begin(request, reply, false));
  app.post("/auth/link/:provider", authenticatedMutation, (request, reply) => begin(request, reply, true));
  app.get("/auth/callback/:provider", async (request, reply) => {
    const provider = OAuthProviderSchema.safeParse((request.params as { provider?: string }).provider);
    const callback = new URL(request.url, config.origin);
    const states = callback.searchParams.getAll("state");
    if (!provider.success || !config.providers[provider.data] || states.length !== 1 || !states[0] ||
        callback.searchParams.getAll("code").length > 1) return reply.code(400).send({ error: "invalid_oauth_state" });
    const attempt = await persistence.consumeAttempt(states[0], provider.data, request.session.sessionId, request.session.playerIdentityId ?? null);
    if (!attempt) return reply.code(400).send({ error: "invalid_oauth_state" });
    try {
      const subject = await oauth.complete(provider.data, callback, attempt);
      const user = attempt.targetIdentityId
        ? await persistence.link(attempt.targetIdentityId, provider.data, subject)
        : await persistence.signIn(provider.data, subject);
      // Atomic generation replacement rejects concurrent logout/rotation.
      await request.session.regenerate();
      request.session.playerIdentityId = user.id;
      await request.session.save();
      return reply.code(303).redirect(`${config.origin}/`);
    } catch {
      // Never log provider errors, token responses, callback URLs, or codes.
      return reply.code(303).redirect(`${config.origin}/?authError=signin_failed`);
    }
  });
  app.post("/auth/username", authenticatedMutation, async (request, reply) => {
    const body = UsernameSelectionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_username" });
    try { return { user: await persistence.selectUsername(request.session.playerIdentityId!, body.data.username) }; }
    catch (error) {
      if (error instanceof AuthError) return reply.code(409).send({ error: error.code });
      throw error;
    }
  });
  async function logout(request: FastifyRequest, reply: FastifyReply, all: boolean) {
    if (all) await persistence.revokeAllSessions(request.session.playerIdentityId!);
    await request.session.destroy();
    reply.clearCookie(cookieName, { path: "/", httpOnly: true, secure: config.secureCookies, sameSite: "lax" });
    return reply.code(204).send();
  }
  app.post("/auth/logout", authenticatedMutation, (request, reply) => logout(request, reply, false));
  app.post("/auth/logout-all", authenticatedMutation, (request, reply) => logout(request, reply, true));
}
