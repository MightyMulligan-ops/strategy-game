import { z } from "zod";

export const OAuthProviderSchema = z.enum(["discord", "google"]);
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;

// Owner-approved initial username policy. Username changes are not exposed.
// The final assertion requires the actual end, including rejection of a trailing newline.
export const UsernameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{2,23}(?![\s\S])/);
export const UsernameSelectionSchema = z.strictObject({ username: UsernameSchema });
export const AuthenticatedPlayerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  username: UsernameSchema.nullable(),
  linkedProviders: z.array(OAuthProviderSchema).readonly()
}).readonly();
export type AuthenticatedPlayer = z.infer<typeof AuthenticatedPlayerSchema>;
