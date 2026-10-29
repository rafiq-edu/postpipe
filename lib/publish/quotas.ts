import { createServiceClient } from "../db/client";
import type {
  PlatformAdapter,
  PublishInput,
  RuleViolation,
} from "../platforms/types";
import { nextMidnight, quotaDay } from "./quota-day";

/**
 * Project-wide caps belong to one developer app. An account connected through an org's own app
 * (platform_data.byo_client_id) counts under that app, not under PostPipe's.
 */
export function quotaScope(
  adapter: PlatformAdapter,
  accountId: string,
  platformData?: unknown,
): string | null {
  if (!adapter.quota) return null;
  if (adapter.quota.scope === "account") return `account:${accountId}`;
  const byo = (platformData as { byo_client_id?: unknown } | null | undefined)
    ?.byo_client_id;
  return typeof byo === "string" && byo !== ""
    ? `project:${adapter.platform}:${byo}`
    : `project:${adapter.platform}`;
}

export { nextMidnight, quotaDay } from "./quota-day";

export const utcDay = (d: Date): string => quotaDay(d);

export const nextUtcMidnight = (day: string): string => nextMidnight(day);

export interface QuotaViolation extends RuleViolation {
  code: "daily_quota_reached";
  earliest_at: string;
}

// Counts published posts only; scheduled posts are not reserved. The worker's consume (Task 15) enforces at publish time.
export async function precheck(
  adapter: PlatformAdapter,
  accountId: string,
  scheduledAt: Date | null,
  input?: Pick<PublishInput, "config">,
  platformData?: unknown,
): Promise<{ ok: true } | { ok: false; violation: QuotaViolation }> {
  const scope = quotaScope(adapter, accountId, platformData);
  if (!adapter.quota || !scope) return { ok: true };
  if (input && adapter.quota.appliesTo?.(input) === false) return { ok: true };
  const tz = adapter.quota.timeZone;
  const day = quotaDay(scheduledAt ?? new Date(), tz);
  const db = await createServiceClient();
  const { data, error } = await db
    .from("platform_quotas")
    .select("count")
    .eq("scope", scope)
    .eq("day", day)
    .maybeSingle();
  if (error) throw error;
  const { dailyCap, sourceLine } = adapter.quota;
  if ((data?.count ?? 0) < dailyCap) return { ok: true };
  return {
    ok: false,
    violation: {
      code: "daily_quota_reached",
      message: `Daily cap of ${dailyCap} posts reached for ${day} (${sourceLine})`,
      earliest_at: nextMidnight(day, tz),
    },
  };
}

/** Takes one unit of the daily cap. False when the cap is reached. */
export async function consume(
  scope: string,
  day: string,
  cap: number,
): Promise<boolean> {
  const db = await createServiceClient();
  const { data, error } = await db.rpc("consume_quota", {
    p_scope: scope,
    p_day: day,
    p_cap: cap,
  });
  if (error) throw error;
  return data;
}

/**
 * Raises today's stored count to the usage the platform reports (never lowers
 * it). Instagram reports content_publishing_limit; its window is a rolling 24
 * hours while ours is a UTC day, so the larger number wins. Not called by the
 * worker yet: the caller must fetch the usage with the account token.
 */
export async function recordReportedUsage(
  scope: string,
  day: string,
  used: number,
): Promise<void> {
  const db = await createServiceClient();
  // Insert if missing, then raise only a smaller count: safe when two workers race.
  const ins = await db
    .from("platform_quotas")
    .upsert(
      { scope, day, count: used },
      { onConflict: "scope,day", ignoreDuplicates: true },
    );
  if (ins.error) throw ins.error;
  const upd = await db
    .from("platform_quotas")
    .update({ count: used })
    .eq("scope", scope)
    .eq("day", day)
    .lt("count", used);
  if (upd.error) throw upd.error;
}
