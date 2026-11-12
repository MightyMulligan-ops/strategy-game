// Server-only exports. The game engine and browser never depend on this package.
export { createDatabaseClient } from "./client.js";
export { testDatabaseUrl } from "./environment.js";
export { MatchRepository } from "./repository.js";
export type { StoredTurn } from "./turn-storage.js";
export { PersistenceError } from "./errors.js";
export { AuthRepository } from "./auth-repository.js";
export { AuthError } from "./auth-types.js";
export type { AuthPersistence, OAuthAttemptData, SessionWrite } from "./auth-types.js";
export { LobbyRepository, LobbyError } from "./lobby-repository.js";
export type { LobbyErrorCode } from "./lobby-repository.js";
export { WorldRepository, WorldError } from "./world-repository.js";
export { localTestIdentity, isLocalTestIdentity } from "./local-test-identities.js";
export type { LocalTestPlayer, LocalTestLoginPersistence } from "./local-test-identities.js";
