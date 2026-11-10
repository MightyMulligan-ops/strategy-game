import * as oidc from "openid-client";
import type { OAuthProvider } from "@strategy-game/shared-types";
import type { OAuthAttemptData } from "@strategy-game/database";
import type { AuthConfig } from "./config.js";

export interface OAuthClient {
  begin(provider: OAuthProvider): Promise<{ authorizationUrl: string; state: string; codeVerifier: string; nonce: string | null }>;
  complete(provider: OAuthProvider, callback: URL, attempt: OAuthAttemptData): Promise<string>;
}

export function createOAuthClient(config: AuthConfig, fetchImplementation: typeof fetch = fetch): OAuthClient {
  const customFetch: oidc.CustomFetch = (url, options) => fetchImplementation(url,
    Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as RequestInit);
  const configurations = new Map<OAuthProvider, Promise<oidc.Configuration>>();
  async function configuration(provider: OAuthProvider): Promise<oidc.Configuration> {
    const credentials = config.providers[provider];
    if (!credentials) throw new Error("Provider unavailable");
    let pending = configurations.get(provider);
    if (!pending) {
      pending = provider === "google"
        ? oidc.discovery(new URL("https://accounts.google.com"), credentials.clientId, credentials.clientSecret,
          oidc.ClientSecretPost(credentials.clientSecret), {
            [oidc.customFetch]: customFetch, timeout: 10, execute: [oidc.enableNonRepudiationChecks]
          })
        : Promise.resolve(new oidc.Configuration({
          issuer: "https://discord.com", authorization_endpoint: "https://discord.com/oauth2/authorize",
          token_endpoint: "https://discord.com/api/oauth2/token", code_challenge_methods_supported: ["S256"]
        }, credentials.clientId, credentials.clientSecret, oidc.ClientSecretPost(credentials.clientSecret)));
      configurations.set(provider, pending);
      pending.catch(() => configurations.delete(provider));
    }
    const configured = await pending;
    configured[oidc.customFetch] = customFetch;
    configured.timeout = 10;
    return configured;
  }
  return {
    async begin(provider) {
      const configured = await configuration(provider);
      const state = oidc.randomState();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const nonce = provider === "google" ? oidc.randomNonce() : null;
      const parameters = {
        redirect_uri: `${config.origin}/auth/callback/${provider}`, response_type: "code",
        scope: provider === "google" ? "openid" : "identify", state,
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier), code_challenge_method: "S256",
        ...(nonce ? { nonce } : {})
      };
      return { authorizationUrl: oidc.buildAuthorizationUrl(configured, parameters).href, state, codeVerifier, nonce };
    },
    async complete(provider, callback, attempt) {
      const configured = await configuration(provider);
      if (provider === "google" && !attempt.nonce) throw new Error("Missing OIDC nonce");
      const tokens = await oidc.authorizationCodeGrant(configured, callback, {
        expectedState: attempt.state, pkceCodeVerifier: attempt.codeVerifier,
        ...(provider === "google" ? { expectedNonce: attempt.nonce!, idTokenExpected: true } : { idTokenExpected: false })
      });
      if (provider === "google") {
        const subject = tokens.claims()?.sub;
        if (typeof subject !== "string" || subject.length === 0) throw new Error("Missing validated subject");
        return subject;
      }
      const response = await oidc.fetchProtectedResource(configured, tokens.access_token,
        new URL("https://discord.com/api/users/@me"), "GET");
      if (!response.ok) throw new Error("Provider identity unavailable");
      const profile: unknown = await response.json();
      if (typeof profile !== "object" || profile === null || !("id" in profile) ||
          typeof profile.id !== "string" || !/^\d{1,32}(?![\s\S])/.test(profile.id)) throw new Error("Invalid provider identity");
      return profile.id;
    }
  };
}
