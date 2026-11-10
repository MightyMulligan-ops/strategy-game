import { MovementQueueEntrySchema } from "@strategy-game/shared-types";
import type { MovementQueueEntry } from "@strategy-game/shared-types";
import { FrozenPlayerOrderListSchema, SeedSchema } from "@strategy-game/shared-types/server";
import { compareIds } from "./determinism.js";

export const SEEDED_MOVEMENT_POLICY = "seeded-shuffle-v1";
export type MovementTieBreaker = (
  moves: readonly MovementQueueEntry[], seed: number
) => readonly MovementQueueEntry[];
export type MovementOrderGroup = Readonly<{
  moveNumber: number;
  moves: readonly MovementQueueEntry[];
}>;

// Provisional Fisher-Yates permutation using a specified 32-bit LCG and
// rejection sampling. Separate streams per move number; not a security RNG.
export const seededSequentialPrecedence: MovementTieBreaker = (moves, seed) => {
  const ordered = [...moves].sort((a, b) => compareIds(a.playerId, b.playerId));
  let state = (seed ^ Math.imul(moves[0]?.moveNumber ?? 0, 0x9e3779b9)) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  for (let index = ordered.length - 1; index > 0; index--) {
    const span = index + 1;
    const limit = Math.floor(0x1_0000_0000 / span) * span;
    let draw: number;
    do { draw = next(); } while (draw >= limit);
    const selected = draw % span;
    const current = ordered[index];
    const replacement = ordered[selected];
    if (!current || !replacement) throw new Error("Invalid permutation index");
    ordered[index] = replacement;
    ordered[selected] = current;
  }
  return Object.freeze(ordered);
};

// Pure planning helper only: it does not decide eligibility, execute movement,
// or assign attacks a phase. A replacement policy must return a permutation.
export function groupMovementOrders(
  playerOrdersInput: unknown,
  seedInput: unknown,
  tieBreaker: MovementTieBreaker = seededSequentialPrecedence
): readonly MovementOrderGroup[] {
  const playerOrders = FrozenPlayerOrderListSchema.parse(playerOrdersInput);
  const seed = SeedSchema.parse(seedInput);
  const groups = new Map<number, MovementQueueEntry[]>();
  for (const player of [...playerOrders].sort((a, b) => compareIds(a.playerId, b.playerId))) {
    let moveNumber = 0;
    for (const order of player.orders) {
      if (order.type !== "move") continue;
      moveNumber++;
      const group = groups.get(moveNumber) ?? [];
      group.push(MovementQueueEntrySchema.parse({ playerId: player.playerId, moveNumber, order }));
      groups.set(moveNumber, group);
    }
  }
  return Object.freeze([...groups].sort(([a], [b]) => a - b).map(([moveNumber, moves]) => {
    const ordered = tieBreaker(Object.freeze(moves), seed);
    if (ordered.length !== moves.length || new Set(ordered).size !== moves.length ||
        ordered.some((entry) => !moves.includes(entry))) {
      throw new Error("A movement tie-breaker must return exactly the original entries");
    }
    return Object.freeze({ moveNumber, moves: Object.freeze([...ordered]) });
  }));
}
