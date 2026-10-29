import { PublishError } from "../platforms/types";

export const RETRY_LADDER_MS = [
  30_000, 120_000, 600_000, 1_800_000, 7_200_000,
] as const;
export const MAX_ATTEMPTS = 6;

/** Delay before the next attempt. `attempt` is the attempt that just failed (>= 1). */
export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  const step =
    RETRY_LADDER_MS[Math.min(attempt - 1, RETRY_LADDER_MS.length - 1)];
  return Math.max(step, retryAfterMs ?? 0);
}

export function toPublishError(e: unknown): PublishError {
  if (e instanceof PublishError) return e;
  if (e instanceof TypeError)
    return new PublishError("network_error", "retryable", e.message);
  return new PublishError(
    "internal_error",
    "retryable",
    e instanceof Error ? e.message : "unknown error",
  );
}
