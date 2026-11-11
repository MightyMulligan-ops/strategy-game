import type { OAuthProvider } from "@strategy-game/shared-types";

export type ProviderCredentials = Readonly<{ clientId: string; clientSecret: string }>;
export type AuthConfig = Readonly<{
  origin: string; sessionSecret: string; sessionTtlMs: number; secureCookies: boolean;
  providers: Partial<Record<OAuthProvider, ProviderCredentials>>;
  devLoginEnabled: boolean;
}>;

export function readAuthConfig(environment: NodeJS.ProcessEnv): AuthConfig | undefined {
  if (environment.AUTH_DEV_LOGIN_ENABLED !== undefined && !["true", "false"].includes(environment.AUTH_DEV_LOGIN_ENABLED)) {
    throw new Error("AUTH_DEV_LOGIN_ENABLED must be true or false");
  }
  const devLoginEnabled = environment.AUTH_DEV_LOGIN_ENABLED === "true";
  if (devLoginEnabled && (environment.AUTH_ENABLED !== "true" || environment.NODE_ENV !== "development" ||
      environment.AUTH_ORIGIN !== "http://127.0.0.1:5173" ||
      (environment.HOST !== undefined && environment.HOST !== "127.0.0.1") || Boolean(environment.AUTH_TRUST_PROXY))) {
    throw new Error("Local test login requires AUTH_ENABLED=true, NODE_ENV=development, AUTH_ORIGIN=http://127.0.0.1:5173, loopback HOST and no AUTH_TRUST_PROXY");
  }
  if (environment.AUTH_ENABLED !== undefined && !["true", "false"].includes(environment.AUTH_ENABLED)) {
    throw new Error("AUTH_ENABLED must be true or false");
  }
  if (environment.AUTH_ENABLED !== "true") return undefined;
  const secret = environment.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace_")) throw new Error("Configure a random SESSION_SECRET of at least 32 characters");
  let origin: URL;
  try { origin = new URL(environment.AUTH_ORIGIN ?? ""); } catch { throw new Error("Configure AUTH_ORIGIN"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" ||
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && local && environment.NODE_ENV !== "production"))) {
    throw new Error("AUTH_ORIGIN must be an HTTPS origin, or a local HTTP development origin");
  }
  const ttl = Number(environment.AUTH_SESSION_TTL_SECONDS ?? "86400");
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 2_592_000) throw new Error("AUTH_SESSION_TTL_SECONDS must be between 60 and 2592000");
  const providers: AuthConfig["providers"] = {};
  for (const provider of ["discord", "google"] as const) {
    const prefix = provider.toUpperCase();
    const clientId = environment[`${prefix}_CLIENT_ID`];
    const clientSecret = environment[`${prefix}_CLIENT_SECRET`];
    if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error(`Configure both ${prefix} client credentials`);
    if (clientId && clientSecret) providers[provider] = { clientId, clientSecret };
  }
  if (Object.keys(providers).length === 0 && !devLoginEnabled) throw new Error("Configure at least one OAuth provider");
  return { origin: origin.origin, sessionSecret: secret, sessionTtlMs: ttl * 1_000, secureCookies: origin.protocol === "https:", providers, devLoginEnabled };
}
