import { createServiceClient } from "../db/client";
import type { Tables } from "../db/types";

/** Claims up to `limit` due targets in one statement; concurrent callers never get the same row. */
export async function claimDue(
  limit: number,
  now: Date,
): Promise<Tables<"social_post_targets">[]> {
  const db = await createServiceClient();
  const { data, error } = await db.rpc("claim_due_targets", {
    p_limit: limit,
    p_now: now.toISOString(),
  });
  if (error) throw error;
  return data;
}
