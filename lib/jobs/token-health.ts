import { appUrl, connectPageUrl } from "../connect/oauth";
import { PICKED_OR } from "../connect/unpicked";
import { createServiceClient } from "../db/client";
import { createConnectSession } from "../db/queries/connect-sessions";
import { overridesForAccount } from "../db/queries/platform-apps";
import { loadTokenSet, wipeStaleUnpicked } from "../db/queries/social-accounts";
import { logger } from "../log/logger";
import {
  LINKEDIN_VERSION,
  LINKEDIN_VERSION_SUNSET_ASSUMED,
  linkedinSunset,
} from "../platforms/linkedin/version";
import { getAdapter, hasAdapter } from "../platforms/registry";
import type { Platform } from "../platforms/types";
import { refreshIfNeeded, tokenNeedsRefresh } from "../publish/steps";
import { withSecretOverrides } from "../secrets";
import { emit } from "../webhooks/events";

const DAY_MS = 86_400_000;

function checkLinkedinSunset(now: Date): void {
  const s = linkedinSunset(now, LINKEDIN_VERSION_SUNSET_ASSUMED);
  const f = {
    version: LINKEDIN_VERSION,
    sunset: LINKEDIN_VERSION_SUNSET_ASSUMED,
    days_left: s.daysLeft,
  };
  if (s.state === "past") logger.error("linkedin.version_sunset_passed", f);
  else if (s.state === "soon") logger.warn("linkedin.version_sunset_soon", f);
}

export async function runTokenHealth(
  now: Date,
): Promise<{ notified: number; expired: number }> {
  const soon = new Date(now.getTime() + 7 * DAY_MS).toISOString();
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_accounts")
    .select("*")
    .eq("status", "connected")
    .is("deleted_at", null)
    .or(PICKED_OR)
    .or(`refresh_expires_at.lte.${soon},token_expires_at.lte.${soon}`);
  if (error) throw error;
  const wiped = await wipeStaleUnpicked(now);
  let notified = 0;
  let expired = 0;
  for (const row of data) {
    try {
      // Adapters with a refresh window (Threads) refresh here, under the refresh lock. A failure falls through to the reconnect notice.
      if (row.mode === "live" && hasAdapter(row.platform as Platform)) {
        const adapter = getAdapter(row.platform as Platform);
        const byAccess =
          !!adapter.refreshWindowMs &&
          tokenNeedsRefresh(adapter, await loadTokenSet(row), now);
        // Idle accounts: a refresh token that expires within 7 days is refreshed now (Pinterest, TikTok, Bluesky rotate or extend it).
        const byRefresh =
          !!row.refresh_token_enc &&
          !!row.refresh_expires_at &&
          new Date(row.refresh_expires_at) > now &&
          new Date(row.refresh_expires_at) <= new Date(soon);
        if (byAccess || byRefresh) {
          try {
            await withSecretOverrides(
              await overridesForAccount(
                row.org_id,
                row.platform,
                row.platform_data,
              ),
              () =>
                refreshIfNeeded(
                  row,
                  adapter,
                  now,
                  byAccess ? undefined : 7 * DAY_MS,
                ),
            );
            continue;
          } catch {
            // keep going: notice path below
          }
        }
      }
      // A refresh token with no known expiry never expires here.
      const deadline = row.refresh_token_enc
        ? row.refresh_expires_at
        : row.token_expires_at;
      if (!deadline) continue;
      const platform = row.platform as Platform;
      const mode = row.mode as "live" | "test";
      if (new Date(deadline) <= now) {
        const { data: done, error: e } = await db
          .from("social_accounts")
          .update({ status: "expired" })
          .eq("id", row.id)
          .eq("status", "connected")
          .select("id");
        if (e) throw e;
        if (done.length) {
          expired++;
          await emit(row.org_id, mode, "social.account.disconnected", {
            account_id: row.id,
            platform,
            external_id: row.external_id,
          });
        }
      } else if (
        new Date(deadline) <= new Date(soon) &&
        !row.expiring_notified_at
      ) {
        const s = await createConnectSession({
          orgId: row.org_id,
          mode,
          platform,
          externalId: row.external_id,
          redirectUrl: `${appUrl()}/dashboard`,
          platformData: {},
        });
        await emit(row.org_id, mode, "social.account.token_expiring", {
          account_id: row.id,
          platform,
          external_id: row.external_id,
          expires_at: deadline,
          connect_url: connectPageUrl(s.token),
        });
        const { error: e } = await db
          .from("social_accounts")
          .update({ expiring_notified_at: now.toISOString() })
          .eq("id", row.id);
        if (e) throw e;
        notified++;
      }
    } catch (e) {
      logger.error("token_health.account_failed", {
        account_id: row.id,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }
  checkLinkedinSunset(now);
  logger.info("token_health.run", { notified, expired, wiped });
  return { notified, expired };
}
