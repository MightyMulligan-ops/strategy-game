import {
  GameConfigSchema,
  GamePlayerSchema,
  TurnCommandSchema,
  TurnRecordSchema
} from "@strategy-game/shared-types";
import type { GameConfig, GamePlayer, Order, TurnRecord } from "@strategy-game/shared-types";

export type PlayerTurnDraft = Readonly<{
  playerId: string;
  revision: number;
  ready: boolean;
  orders: readonly Order[];
}>;

// Server-only orchestration state. Never serialize this object to a player.
// There is deliberately no authoritative world state in this draft lifecycle.
export type TurnState = Readonly<{
  config: GameConfig;
  players: readonly GamePlayer[];
  turn: TurnRecord;
  drafts: readonly PlayerTurnDraft[];
  lastObservedAtMs: number;
}>;

type Rejection = "invalid_command" | "turn_closed" | "wrong_turn" |
  "inactive_player" | "stale_revision" | "order_not_found" | "revision_exhausted";
export type TurnCommandResult =
  | Readonly<{ accepted: true; state: TurnState }>
  | Readonly<{ accepted: false; state: TurnState; reason: Rejection }>;

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function checkTime(state: TurnState, serverNowMs: number): void {
  if (!Number.isSafeInteger(serverNowMs) || serverNowMs < state.lastObservedAtMs) {
    throw new RangeError("Server observation time must be a nondecreasing safe integer");
  }
}

function openRecord(config: GameConfig, turnNumber: number, openedAtMs: number): TurnRecord {
  return TurnRecordSchema.parse({
    schemaVersion: 1,
    gameId: config.gameId,
    turnNumber,
    openedAtMs,
    deadlineAtMs: openedAtMs + config.turnDurationMs,
    status: "open"
  });
}

function emptyDrafts(players: readonly GamePlayer[]): readonly PlayerTurnDraft[] {
  return players.filter((player) => player.active).map((player) => ({
    playerId: player.playerId, revision: 0, ready: false, orders: []
  }));
}

export function createTurn(configInput: unknown, playersInput: readonly unknown[], openedAtMs: number): TurnState {
  const config = GameConfigSchema.parse(configInput);
  const players = playersInput.map((player) => GamePlayerSchema.parse(player));
  if (players.some((player) => player.gameId !== config.gameId) ||
      new Set(players.map((player) => player.playerId)).size !== players.length ||
      !players.some((player) => player.active)) {
    throw new Error("A turn needs unique same-game players and a nonempty active roster");
  }
  // Canonical roster order is for reproducibility, not gameplay initiative.
  players.sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);
  return freeze({
    config, players, turn: openRecord(config, 1, openedAtMs),
    drafts: emptyDrafts(players), lastObservedAtMs: openedAtMs
  });
}

function close(state: TurnState, closedAtMs: number, closeReason: "deadline" | "all_ready"): TurnState {
  return freeze({
    ...state,
    turn: TurnRecordSchema.parse({ ...state.turn, status: "closed", closedAtMs, closeReason })
  });
}

// A pure observation, not a timer or scheduler. Late observation records the
// actual deadline as closure time; it does not extend the submission window.
export function observeDeadline(state: TurnState, serverNowMs: number): TurnState {
  checkTime(state, serverNowMs);
  const observed = freeze({ ...state, lastObservedAtMs: serverNowMs });
  return observed.turn.status === "open" && serverNowMs >= observed.turn.deadlineAtMs
    ? close(observed, observed.turn.deadlineAtMs, "deadline")
    : observed;
}

export function applyTurnCommand(
  state: TurnState,
  actingPlayerId: string,
  input: unknown,
  serverNowMs: number
): TurnCommandResult {
  const observed = observeDeadline(state, serverNowMs);
  const reject = (reason: Rejection): TurnCommandResult => ({ accepted: false, state: observed, reason });
  if (observed.turn.status !== "open") return reject("turn_closed");
  const parsed = TurnCommandSchema.safeParse(input);
  if (!parsed.success) return reject("invalid_command");
  const command = parsed.data;
  if (command.gameId !== observed.config.gameId || command.turnNumber !== observed.turn.turnNumber) {
    return reject("wrong_turn");
  }
  const draft = observed.drafts.find((item) => item.playerId === actingPlayerId);
  if (!draft) return reject("inactive_player");
  if (command.expectedRevision !== draft.revision) return reject("stale_revision");
  if (draft.revision === Number.MAX_SAFE_INTEGER) return reject("revision_exhausted");

  let orders = draft.orders;
  let ready = draft.ready;
  switch (command.kind) {
    case "replace_orders":
      orders = command.orders;
      ready = false;
      break;
    case "cancel_order":
      if (!orders.some((order) => order.orderId === command.orderId)) return reject("order_not_found");
      orders = orders.filter((order) => order.orderId !== command.orderId);
      ready = false;
      break;
    case "set_ready":
      ready = command.ready;
      break;
  }

  const updated = freeze({
    ...observed,
    drafts: observed.drafts.map((item) => item.playerId === actingPlayerId
      ? { ...item, orders, ready, revision: item.revision + 1 }
      : item)
  });
  return {
    accepted: true,
    state: updated.drafts.every((item) => item.ready)
      ? close(updated, serverNowMs, "all_ready")
      : updated
  };
}

// These transitions record lifecycle only. No gameplay is executed and callers
// must not interpret "resolved" as a persisted or gameplay-resolved result yet.
export function transitionResolution(
  state: TurnState,
  action: "begin_resolution" | "complete_resolution",
  serverNowMs: number
): TurnState {
  const expectedStatus = action === "begin_resolution" ? "closed" : "resolving";
  if (state.turn.status !== expectedStatus) throw new Error("Invalid resolution transition");
  const observed = observeDeadline(state, serverNowMs);
  return freeze({
    ...observed,
    turn: TurnRecordSchema.parse({
      ...observed.turn,
      status: action === "begin_resolution" ? "resolving" : "resolved"
    })
  });
}

// The next record always reuses the match's fixed config. No duration-update
// command exists. Roster changes and automatic next-turn timing are out of scope.
export function openNextTurn(state: TurnState, openedAtMs: number): TurnState {
  checkTime(state, openedAtMs);
  if (state.turn.status !== "resolved") throw new Error("Previous turn must be resolved");
  return freeze({
    ...state,
    turn: openRecord(state.config, state.turn.turnNumber + 1, openedAtMs),
    drafts: emptyDrafts(state.players),
    lastObservedAtMs: openedAtMs
  });
}
