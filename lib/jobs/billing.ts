import { billingProvider } from "../billing/provider";
import { computeOverage } from "../billing/usage";
import { createServiceClient } from "../db/client";
import { logger } from "../log/logger";

export async function runBillingDaily(
  now: Date,
): Promise<{ downgraded: number; reported: number }> {
  const db = await createServiceClient();
  let reported = 0;
  const prev = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const month = prev.toISOString().slice(0, 7);
  const { data: orgs, error: e2 } = await db
    .from("organizations")
    .select("id")
    .in("plan", ["builder", "scale"]);
  if (e2) throw e2;
  for (const org of orgs) {
    // one failing org (e.g. deleted mid-run) must not stop billing for the rest
    const o = await computeOverage(org.id, month).catch((err) => {
      logger.error("billing.overage_failed", {
        org_id: org.id,
        error: err instanceof Error ? err.message : "unknown",
      });
      return null;
    });
    if (!o) continue;
    if (o.posts === 0) continue;
    const eventId = `overage:${org.id}:${month}`;
    const { error } = await db
      .from("billing_events")
      .insert({ event_id: eventId, type: "usage.reported" });
    if (error) {
      if (error.code === "23505") continue;
      throw error;
    }
    try {
      await billingProvider().reportUsage(org.id, o.posts, month);
      reported++;
    } catch (err) {
      await db.from("billing_events").delete().eq("event_id", eventId);
      logger.error("billing.usage_report_failed", {
        org_id: org.id,
        month,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  // Report before downgrade: the downgrade drops the plan the overage is billed on.
  const { data: down, error: e1 } = await db
    .from("organizations")
    .update({ plan: "free", plan_ends_at: null, polar_subscription_id: null })
    .lte("plan_ends_at", now.toISOString())
    .select("id");
  if (e1) throw e1;

  return { downgraded: down.length, reported };
}
