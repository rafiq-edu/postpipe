import { createPolar, webhooks } from "@polar-sh/sdk/2026-10";
import { z } from "zod";
import { appUrl } from "../connect/oauth";
import { getSecret } from "../secrets";
import type { BillingEvent, BillingProvider } from "./provider";

type Paid = "builder" | "scale";

const PRODUCT_SECRET = {
  builder: "POLAR_PRODUCT_BUILDER",
  scale: "POLAR_PRODUCT_SCALE",
} as const;

async function client() {
  return createPolar({
    accessToken: await getSecret("POLAR_ACCESS_TOKEN"),
    environment:
      (await getSecret("POLAR_SERVER")) === "production"
        ? "production"
        : "sandbox",
  });
}

async function planForProduct(id: string): Promise<Paid | null> {
  for (const plan of ["builder", "scale"] as const)
    if (id === (await getSecret(PRODUCT_SECRET[plan]))) return plan;
  return null;
}

// Fields the mapper reads (SDK 1.0.2 payloads are snake_case). A shape change fails loudly.
const subscriptionData = z.object({
  id: z.string(),
  customer_id: z.string(),
  product_id: z.string(),
  current_period_end: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  customer: z.object({ external_id: z.string().nullish() }).nullish(),
});

function orgOf(d: z.infer<typeof subscriptionData>): string | null {
  const meta = d.metadata?.org_id;
  return d.customer?.external_id ?? (typeof meta === "string" ? meta : null);
}

export const polarProvider: BillingProvider = {
  async createCheckout(orgId, plan) {
    const polar = await client();
    const checkout = await polar.checkouts.create({
      products: [await getSecret(PRODUCT_SECRET[plan])],
      external_customer_id: orgId,
      success_url: `${appUrl()}/dashboard/billing?checkout=success`,
      metadata: { org_id: orgId, plan },
    });
    return { url: checkout.url };
  },

  async handleWebhook(req): Promise<BillingEvent | null> {
    const body = await req.text();
    const eventId = req.headers.get("webhook-id");
    if (!eventId) return null;
    let event: Awaited<ReturnType<typeof webhooks.validateEvent>>;
    try {
      event = await webhooks.validateEvent(
        body,
        Object.fromEntries(req.headers),
        await getSecret("POLAR_WEBHOOK_SECRET"),
      );
    } catch (e) {
      if (e instanceof webhooks.PolarWebhookVerificationError) return null;
      // Unknown event types are valid but unused.
      if (e instanceof webhooks.PolarWebhookUnknownTypeError)
        return { kind: "ignored", eventId, type: "unknown" };
      throw e;
    }
    const type = event.type;
    if (
      type !== "subscription.active" &&
      type !== "subscription.uncanceled" &&
      type !== "subscription.canceled" &&
      type !== "subscription.revoked"
    )
      return { kind: "ignored", eventId, type };

    const d = subscriptionData.parse(event.data);
    const orgId = orgOf(d);
    if (!orgId) return { kind: "ignored", eventId, type };
    if (type === "subscription.canceled")
      return {
        kind: "subscription_canceled",
        eventId,
        type,
        orgId,
        subscriptionId: d.id,
        endsAt: new Date(d.current_period_end).toISOString(),
      };
    if (type === "subscription.revoked")
      return {
        kind: "subscription_revoked",
        eventId,
        type,
        orgId,
        subscriptionId: d.id,
      };
    const plan = await planForProduct(d.product_id);
    if (!plan) return { kind: "ignored", eventId, type };
    return {
      kind: "subscription_active",
      eventId,
      type,
      orgId,
      plan,
      subscriptionId: d.id,
      customerId: d.customer_id,
    };
  },

  async reportUsage(orgId, posts, month) {
    const polar = await client();
    await polar.events.ingest({
      events: [
        {
          name: "overage_posts",
          external_customer_id: orgId,
          metadata: { posts, month },
        },
      ],
    });
  },
};
