import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import { isDeepStrictEqual as same, types } from "node:util";
import { GameConfigSchema } from "@strategy-game/shared-types";
import { MOVEMENT_RESOLUTION_RUNTIME_PROFILE } from "@strategy-game/shared-types/server";
import type { MovementInitialSnapshot, MovementResolutionResult, PinnedRuleset } from "@strategy-game/shared-types/server";
import { validateMovementInitialSnapshot, freezeMovementInput, resolveMovement, createTurn } from "@strategy-game/game-engine";
import type { TurnState } from "@strategy-game/game-engine";
import type { StoredTurnRow } from "./turn-storage.js";
import { restoreClosureDrafts } from "./closure-storage.js";
import { restoreWorldArchive } from "./world-repository.js";
import { restoreTurnRecord, json, safeNumber } from "./mappings.js";
import { PersistenceError } from "./errors.js";

export type MovementAggregate = {
  kind: "movement_resolution"; row: StoredTurnRow; snapshot: MovementInitialSnapshot;
  state: TurnState; pinned: PinnedRuleset; result: MovementResolutionResult | null;
};
type VerifiedMovement = Omit<MovementAggregate, "row">;
const cache = new Map<string, { value: VerifiedMovement; bytes: number }>();
const maxEntries = 4, maxBytes = 32 * 1024 * 1024;
let cachedBytes = 0;

/** Read only own data descriptors, never input accessors or Proxy traps. */
function dataField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !Object.hasOwn(field, "value") || !field.enumerable) return invalid();
  return field.value;
}
/** Internal early dispatch: do not read a new-runtime header through getters. */
export function isMovementResolutionRow(row: StoredTurnRow) {
  const configuration = dataField(dataField(row, "match"), "configuration");
  if (configuration === null) return false;
  const simulation = dataField(configuration, "simulationVersion");
  if (simulation !== null && typeof simulation !== "string") return invalid();
  return simulation === "movement-resolution-v1";
}

/** Complete typed encoding of fetched data. JSON.stringify is used only for
 * primitive strings/numbers; no input object, getter, coercion or toJSON runs.
 * Descriptors/prototypes are checked before validation or a cache lookup. */
function fingerprint(row: StoredTurnRow) {
  const hash = createHash("sha256"), active = new WeakSet<object>(), names = new Map<string, string>();
  let parts: string[] = [], length = 0;
  const emit = (text: string) => {
    parts.push(text); length += text.length;
    if (length >= 65536 || parts.length >= 4096) { hash.update(parts.join("")); parts = []; length = 0; }
  };
  function visit(value: unknown): void {
    if (value === null) { emit("n;"); return; }
    switch (typeof value) {
      case "string": emit("s" + JSON.stringify(value)); return;
      case "bigint": emit("i" + String(value) + ";"); return;
      case "boolean": emit(value ? "b1;" : "b0;"); return;
      case "number":
        if (!Number.isFinite(value)) return invalid();
        emit("f" + (Object.is(value, -0) ? "-0" : JSON.stringify(value)) + ";"); return;
      case "object": break;
      default: return invalid();
    }
    if (types.isProxy(value) || active.has(value)) return invalid();
    const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if (types.isDate(value)) {
      if (prototype !== Date.prototype || keys.length) return invalid();
      emit("d" + JSON.stringify(Date.prototype.toISOString.call(value))); return;
    }
    // Native internal brands survive prototype reassignment. They must not
    // masquerade as ordinary records merely by changing their prototype.
    if (types.isBoxedPrimitive(value) || types.isMap(value) || types.isSet(value) || types.isRegExp(value) ||
        types.isNativeError(value) || types.isAnyArrayBuffer(value) || types.isArrayBufferView(value) ||
        types.isKeyObject(value) || types.isCryptoKey(value)) return invalid();
    const array = Array.isArray(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalid();
    active.add(value);
    if (array) {
      const size = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
      if (keys.length !== size + 1) return invalid(); // Dense data indices plus native length only.
      emit("a[");
      for (let i = 0; i < size; i++) {
        const field = Object.getOwnPropertyDescriptor(value, String(i));
        if (!field || !Object.hasOwn(field, "value") || !field.enumerable) return invalid();
        if (i) emit(","); visit(field.value);
      }
      emit("]");
    } else {
      emit(prototype === null ? "z{" : "o{");
      let first = true;
      for (const key of keys) {
        if (typeof key !== "string") return invalid();
        const field = Object.getOwnPropertyDescriptor(value, key)!;
        if (!Object.hasOwn(field, "value") || !field.enumerable) return invalid();
        if (!first) emit(","); first = false;
        let encoded = names.get(key);
        if (encoded === undefined) { encoded = JSON.stringify(key); names.set(key, encoded); }
        emit(encoded + ":"); visit(field.value);
      }
      emit("}");
    }
    active.delete(value);
  }
  visit(row);
  // Preserve the baseline's native cloneability admission after hook-free
  // inspection (V8 serialize alone admits some objects structuredClone rejects,
  // e.g. URL). Discard this temporary clone; never reconstruct historical state
  // or derive the cache key from it. Unsupported native slots cannot hit cache.
  structuredClone(row);
  hash.update(parts.join("")); return hash.digest("hex");
}
function immutable(value: unknown, seen = new WeakSet<object>()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) immutable(child, seen);
  Object.freeze(value);
}
/** Internal lifecycle/test hook; eviction always restores full validation. */
export function clearMovementRestorationCache() { cache.clear(); cachedBytes = 0; }
function remember(key: string, value: VerifiedMovement) {
  const bytes = serialize(value).byteLength;
  if (bytes > maxBytes) return;
  immutable(value);
  while (cache.size >= maxEntries || cachedBytes + bytes > maxBytes) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cachedBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
  }
  cache.set(key, { value, bytes }); cachedBytes += bytes;
}
function invalid(): never { throw new PersistenceError("invalid_storage", "Movement resolution storage is inconsistent"); }

/** Validate this cohort directly. Historical validators remain unchanged; their
 * draft semantics are reused once against the already validated initial army. */
function restore(row: StoredTurnRow): VerifiedMovement {
  if (!row.match.world || !row.match.configuration) return invalid();
  const configuration = row.match.configuration, config = GameConfigSchema.parse(configuration.config);
  const profile = MOVEMENT_RESOLUTION_RUNTIME_PROFILE;
  if (configuration.matchId !== row.matchId || configuration.schemaVersion !== 1 || config.gameId !== row.matchId ||
      configuration.turnDurationMs !== BigInt(config.turnDurationMs) || configuration.rulesetId !== profile.ruleset.rulesetId ||
      configuration.rulesetVersion !== profile.ruleset.version || configuration.simulationVersion !== profile.simulationVersion) return invalid();
  const archive = restoreWorldArchive(row.match.world);
  const snapshot = validateMovementInitialSnapshot(row.startingSnapshot.payload, archive, row.match.configuration.pinnedRuleset);
  const resolved = row.status === "RESOLVED";
  const players = [...row.players].sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);
  const roster = players.map(p => ({ schemaVersion: 1, gameId: row.matchId, playerId: p.playerId, active: p.active }));
  const activeIds = row.match.participants.map(p => p.playerId).sort();
  if ((row.status !== "OPEN" && row.status !== "CLOSED" && !resolved) ||
      row.match.id !== row.matchId || row.match.status !== "RUNNING" ||
      row.match.currentStateVersion !== (resolved ? 1n : 0n) || row.number !== 1n || row.startingStateVersion !== 0n ||
      row.startingSnapshot.matchId !== row.matchId || row.startingSnapshot.stateVersion !== 0n ||
      row.startingSnapshot.completedTurnNumber !== 0n || row.startingSnapshot.snapshotId !== snapshot.snapshotId ||
      !same(snapshot.config, row.match.configuration.config) || !same(snapshot.players, roster) ||
      !same(activeIds, roster.map(p => p.playerId)) || row.match.participants.some(p => !p.active || p.matchId !== row.matchId)) return invalid();

  const expected = createTurn(snapshot.config, snapshot.players, safeNumber(row.openedAtMs));
  const turn = restoreTurnRecord(row);
  const closedTurn = turn.status === "resolved" ? { ...turn, status: "closed" as const } : turn;
  if (closedTurn.status !== "open" && closedTurn.status !== "closed") return invalid();
  if (closedTurn.openedAtMs !== expected.turn.openedAtMs || closedTurn.deadlineAtMs !== expected.turn.deadlineAtMs ||
      row.lastObservedAtMs < row.openedAtMs || (row.status === "OPEN" && row.lastObservedAtMs >= row.deadlineAtMs) ||
      (closedTurn.status === "closed" && (closedTurn.closedAtMs > safeNumber(row.lastObservedAtMs) ||
        (closedTurn.closeReason === "all_ready" && row.lastObservedAtMs >= row.deadlineAtMs)))) return invalid();
  const state = Object.freeze({ ...expected, turn: closedTurn, lastObservedAtMs: safeNumber(row.lastObservedAtMs),
    drafts: restoreClosureDrafts(row, snapshot, archive) });
  if (closedTurn.status === "open") {
    if (row.frozenInput !== null || state.drafts.every(d => d.ready)) return invalid();
  } else {
    const frozen = freezeMovementInput(state, snapshot, archive);
    if (!row.frozenInput || row.frozenInput.seed !== BigInt(frozen.resolutionSeed) || !same(row.frozenInput.payload, json(frozen))) return invalid();
  }
  let result: MovementResolutionResult | null = null;
  if (resolved) {
    if (!row.resolution || !row.frozenInput) return invalid();
    result = resolveMovement(snapshot, row.frozenInput.payload, archive);
    if (row.resolution.resolutionId !== result.resolutionId || row.resolution.nextStateVersion !== 1n ||
        !same(row.resolution.payload, json(result))) return invalid();
  } else if (row.resolution) return invalid();
  return { kind: "movement_resolution", snapshot, state: Object.freeze({ ...state, turn }),
    pinned: MOVEMENT_RESOLUTION_RUNTIME_PROFILE, result };
}

export function restoreMovementResolution(row: StoredTurnRow): MovementAggregate {
  // Inspect all values before even reading status. OPEN never reuses validation.
  const content = fingerprint(row);
  const key = row.status === "CLOSED" || row.status === "RESOLVED" ? content : null;
  if (key) {
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return { ...hit.value, row }; }
  }
  const value = restore(row);
  if (key) remember(key, value);
  return { ...value, row };
}
