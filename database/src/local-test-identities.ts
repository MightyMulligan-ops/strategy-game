import type { AuthenticatedPlayer } from "@strategy-game/shared-types";

// Reserved server-only namespace: normal OAuth identities are random UUIDs.
// Never accept a caller-supplied database ID, provider subject, or username.
const identities = Object.freeze({
  "player-one": "sovereign:local-test:v1:player-one",
  "player-two": "sovereign:local-test:v1:player-two"
});
export type LocalTestPlayer = keyof typeof identities;
export function localTestIdentity(player: unknown): string | undefined {
  return typeof player === "string" && Object.hasOwn(identities, player) ? identities[player as LocalTestPlayer] : undefined;
}
export function isLocalTestIdentity(id: string): boolean { return id.startsWith("sovereign:local-test:"); }
export interface LocalTestLoginPersistence {
  signInLocalTest(player: LocalTestPlayer): Promise<AuthenticatedPlayer>;
}
