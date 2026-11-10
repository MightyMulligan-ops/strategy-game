import { z } from "zod";

export const version = z.literal(1);
export const identifier = z.string().min(1).refine(
  (value) => value.trim() === value,
  "Identifiers must not have surrounding whitespace"
);
export const nonnegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const positiveInteger = nonnegativeInteger.min(1);
