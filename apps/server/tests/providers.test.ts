import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { calculatePKCECodeChallenge } from "openid-client";
import { createOAuthClient } from "../src/auth/providers.js";
import { readAuthConfig } from "../src/auth/config.js";

const config = readAuthConfig({ AUTH_ENABLED: "true", AUTH_ORIGIN: "http://127.0.0.1:5173",
  SESSION_SECRET: "unit-test-session-secret-with-sufficient-length", GOOGLE_CLIENT_ID: "google-client", GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-client", DISCORD_CLIENT_SECRET: "discord-secret" })!;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let badKeys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => { keys = await generateKeyPair("RS256"); badKeys = await generateKeyPair("RS256"); });

describe("established OAuth/OIDC client with mocked HTTPS provider responses", () => {
  it.each(["valid", "nonce", "audience", "issuer", "expired", "signature"])("validates Google OIDC including %s claims/signatures", async (variant) => {
    let nonce: string | null = null;
    let verifier = "";
    const transport = vi.fn<typeof fetch>(async (input, options) => {
      const url = input.toString();
      if (url === "https://accounts.google.com/.well-known/openid-configuration") return Response.json({
        issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token", jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"]
      });
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [{ ...await exportJWK(keys.publicKey), kid: "test-key", alg: "RS256", use: "sig" }] });
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(options?.body));
        expect(body.get("code_verifier")).toBe(verifier);
        expect(body.get("client_secret")).toBe("google-secret");
        const token = await new SignJWT({ nonce: variant === "nonce" ? "wrong" : nonce, email: "unused@example.test" })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer(variant === "issuer" ? "https://evil.example" : "https://accounts.google.com")
          .setAudience(variant === "audience" ? "another-client" : "google-client")
          .setSubject("stable-google-subject").setIssuedAt()
          .setExpirationTime(variant === "expired" ? Math.floor(Date.now() / 1_000) - 600 : "5m")
          .sign(variant === "signature" ? badKeys.privateKey : keys.privateKey);
        return Response.json({ access_token: "private-access-token", refresh_token: "private-refresh-token", token_type: "Bearer", id_token: token });
      }
      throw new Error("Unexpected provider request");
    });
    const client = createOAuthClient(config, transport);
    const flow = await client.begin("google"); nonce = flow.nonce; verifier = flow.codeVerifier;
    const authorize = new URL(flow.authorizationUrl);
    expect(authorize.searchParams.get("scope")).toBe("openid");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toBe(await calculatePKCECodeChallenge(verifier));
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${config.origin}/auth/callback/google`);
    expect(authorize.searchParams.get("client_secret")).toBeNull();
    const attempt = { ...flow, provider: "google" as const, sessionBinding: "browser", targetIdentityId: null, expiresAt: new Date(Date.now() + 60_000) };
    const result = client.complete("google", new URL(`${config.origin}/auth/callback/google?state=${flow.state}&code=private-code`), attempt);
    if (variant === "valid") await expect(result).resolves.toBe("stable-google-subject");
    else await expect(result).rejects.toThrow();
  });

  it("requests only Discord identify with PKCE and discards all profile data except the stable ID", async () => {
    let verifier = "";
    const transport = vi.fn<typeof fetch>(async (input, options) => {
      if (input.toString() === "https://discord.com/api/oauth2/token") {
        expect(new URLSearchParams(String(options?.body)).get("code_verifier")).toBe(verifier);
        return Response.json({ access_token: "private-token", token_type: "Bearer", refresh_token: "private-refresh" });
      }
      expect(input.toString()).toBe("https://discord.com/api/users/@me");
      expect(new Headers(options?.headers).get("authorization")).toBe("Bearer private-token");
      return Response.json({ id: "1234567890", email: "unused@example.test", username: "not-the-game-name" });
    });
    const client = createOAuthClient(config, transport);
    const flow = await client.begin("discord"); verifier = flow.codeVerifier;
    const url = new URL(flow.authorizationUrl);
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const attempt = { ...flow, provider: "discord" as const, sessionBinding: "browser", targetIdentityId: null, expiresAt: new Date(Date.now() + 60_000) };
    await expect(client.complete("discord", new URL(`${config.origin}/auth/callback/discord?state=${flow.state}&code=private-code`), attempt)).resolves.toBe("1234567890");
    await expect(client.complete("discord", new URL(`${config.origin}/auth/callback/discord?state=wrong&code=private-code`), attempt)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("fail-closed server configuration", () => {
  it("defaults to disabled rather than falling back to insecure sessions", () => {
    expect(readAuthConfig({})).toBeUndefined();
    expect(() => readAuthConfig({ AUTH_ENABLED: "true" })).toThrow("SESSION_SECRET");
  });
  it.each(["http://game.example", "https://game.example/path", "https://user:password@game.example"])("rejects unsafe origin %s", (origin) => {
    expect(() => readAuthConfig({ AUTH_ENABLED: "true", AUTH_ORIGIN: origin,
      SESSION_SECRET: "unit-test-session-secret-with-sufficient-length", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })).toThrow("AUTH_ORIGIN");
  });
  it("requires production HTTPS and complete provider credentials", () => {
    const environment = { AUTH_ENABLED: "true", AUTH_ORIGIN: config.origin, SESSION_SECRET: config.sessionSecret };
    expect(() => readAuthConfig({ ...environment, NODE_ENV: "production" })).toThrow("HTTPS");
    expect(() => readAuthConfig({ ...environment, GOOGLE_CLIENT_ID: "id" })).toThrow("both");
  });
});
