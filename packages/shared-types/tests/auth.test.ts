import { describe, expect, it } from "vitest";
import { AuthenticatedPlayerSchema, UsernameSelectionSchema } from "../src/index.js";

describe("public authentication contracts", () => {
  it("accepts only the approved username syntax and exact selection fields", () => {
    for (const username of ["Ada", "Captain_1", "A".repeat(24)]) {
      expect(UsernameSelectionSchema.safeParse({ username }).success).toBe(true);
    }
    for (const username of ["ab", "A".repeat(25), "1Captain", "_Captain", "Captain Name", "Captain-Name", "Äda", " Ada", "Ada\n"]) {
      expect(UsernameSelectionSchema.safeParse({ username }).success).toBe(false);
    }
    expect(UsernameSelectionSchema.safeParse({ username: "Captain", identityId: "other-player" }).success).toBe(false);
  });

  it("rejects private provider data and unsupported profile versions", () => {
    const profile = { schemaVersion: 1, id: "stable-player", username: null, linkedProviders: ["google", "discord"] };
    expect(AuthenticatedPlayerSchema.safeParse(profile).success).toBe(true);
    for (const extra of [{ accessToken: "private" }, { subject: "private" }, { email: "private@example.com" }, { schemaVersion: 2 }, { linkedProviders: ["unknown"] }]) {
      expect(AuthenticatedPlayerSchema.safeParse({ ...profile, ...extra }).success).toBe(false);
    }
  });
});
