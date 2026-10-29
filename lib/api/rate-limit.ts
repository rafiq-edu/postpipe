import { createServiceClient } from "../db/client";

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export async function rateLimit(
  apiKeyId: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const start = Math.floor(now / 60000) * 60000;
  const db = await createServiceClient();
  const { data, error } = await db.rpc("increment_rate_limit", {
    p_api_key_id: apiKeyId,
    p_minute: new Date(start).toISOString(),
  });
  if (error) throw error;
  const count = data as number;
  return {
    ok: count <= limitPerMinute,
    limit: limitPerMinute,
    remaining: Math.max(0, limitPerMinute - count),
    resetSeconds: Math.max(1, Math.ceil((start + 60000 - now) / 1000)),
  };
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(r.resetSeconds),
  };
  if (!r.ok) h["Retry-After"] = h["RateLimit-Reset"];
  return h;
}
