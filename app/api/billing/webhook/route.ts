import { problem } from "@/lib/api/errors";
import { billingProvider } from "@/lib/billing/provider";
import { createServiceClient } from "@/lib/db/client";
import { logger } from "@/lib/log/logger";

// Public route: Polar has no API key. The signature is checked first.
export async function POST(req: Request): Promise<Response> {
  const ev = await billingProvider().handleWebhook(req);
  if (!ev)
    return problem(400, "validation_failed", "invalid webhook signature");

  const db = await createServiceClient();
  const { error: dup } = await db
    .from("billing_events")
    .insert({ event_id: ev.eventId, type: ev.type });
  if (dup) {
    if (dup.code === "23505") return Response.json({ replayed: true });
    throw dup;
  }
  logger.info("billing.webhook", {
    event_id: ev.eventId,
    type: ev.type,
    org_id: "orgId" in ev ? ev.orgId : null,
  });

  try {
    if (ev.kind !== "ignored") {
      const patch =
        ev.kind === "subscription_active"
          ? {
              plan: ev.plan,
              plan_ends_at: null,
              polar_subscription_id: ev.subscriptionId,
              billing_customer_id: ev.customerId,
            }
          : ev.kind === "subscription_canceled"
            ? { plan_ends_at: ev.endsAt }
            : {
                plan: "free",
                plan_ends_at: null,
                polar_subscription_id: null,
              };
      let q = db.from("organizations").update(patch).eq("id", ev.orgId);
      // Old or late events of a replaced subscription must not touch the org.
      if (ev.kind !== "subscription_active")
        q = q.eq("polar_subscription_id", ev.subscriptionId);
      const { error } = await q;
      if (error) throw error;
    }
  } catch {
    // Remove the marker so Polar's retry applies the event.
    await db.from("billing_events").delete().eq("event_id", ev.eventId);
    return new Response(null, { status: 500 });
  }
  return Response.json({ ok: true });
}
