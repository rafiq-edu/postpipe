import { decryptToken } from "../crypto/tokens";
import { createServiceClient } from "../db/client";
import type { TablesUpdate } from "../db/types";
import { logger } from "../log/logger";
import { signWebhook } from "./sign";
import { assertPublicUrl } from "./url-guard";

export const RETRY_LADDER_SECONDS = [60, 300, 1800, 7200, 21600];
export const MAX_ATTEMPTS = 6;

export async function runWebhookTick(
  opts: { now?: Date; fetchImpl?: typeof fetch; limit?: number } = {},
): Promise<{
  claimed: number;
  delivered: number;
  failed: number;
  dead: number;
}> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const db = await createServiceClient();
  const { data: rows, error } = await db.rpc("claim_webhook_deliveries", {
    p_limit: opts.limit ?? 20,
    p_now: now.toISOString(),
  });
  if (error) throw error;
  const out = { claimed: rows.length, delivered: 0, failed: 0, dead: 0 };

  for (const row of rows) {
    const { data: ep, error: epError } = await db
      .from("webhook_endpoints")
      .select("url, secret_enc, enabled")
      .eq("id", row.endpoint_id)
      .maybeSingle();
    if (epError) throw epError;
    let update: TablesUpdate<"webhook_deliveries">;
    let attempt = row.attempt;
    let code: number | null = null;
    if (!ep?.enabled) {
      update = { status: "dead", response_code: null };
      out.dead++;
    } else {
      attempt = row.attempt + 1;
      try {
        const body = JSON.stringify(row.payload);
        await assertPublicUrl(ep.url);
        const res = await fetchImpl(ep.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "PostPipe-Webhooks/1.0",
            "PostPipe-Signature": signWebhook(
              await decryptToken(ep.secret_enc),
              body,
              Math.floor(Date.now() / 1000),
            ),
            "PostPipe-Delivery-Id": row.id,
            "PostPipe-Event": row.event,
          },
          body,
          redirect: "manual", // a 3xx is a failed attempt, never followed
          signal: AbortSignal.timeout(10_000),
        });
        code = res.status;
      } catch {
        code = null;
      }
      if (code !== null && code >= 200 && code < 300) {
        update = {
          status: "delivered",
          attempt,
          response_code: code,
          delivered_at: now.toISOString(),
        };
        out.delivered++;
      } else if (attempt >= MAX_ATTEMPTS) {
        update = { status: "dead", attempt, response_code: code };
        out.dead++;
      } else {
        const secs = RETRY_LADDER_SECONDS[Math.min(attempt - 1, 4)];
        update = {
          status: "pending",
          attempt,
          response_code: code,
          next_attempt_at: new Date(now.getTime() + secs * 1000).toISOString(),
        };
        out.failed++;
      }
    }
    const { error: ue } = await db
      .from("webhook_deliveries")
      .update(update)
      .eq("id", row.id);
    if (ue) throw ue;
    logger.info("webhook.delivery", {
      id: row.id,
      event: row.event,
      status: update.status,
      attempt,
      response_code: code,
    });
  }
  return out;
}
