import type { PlanId } from "./plans";
import { polarProvider } from "./polar";

export type BillingEvent =
  | {
      kind: "subscription_active";
      eventId: string;
      type: string;
      orgId: string;
      plan: Exclude<PlanId, "free">;
      subscriptionId: string;
      customerId: string;
    }
  | {
      kind: "subscription_canceled";
      eventId: string;
      type: string;
      orgId: string;
      subscriptionId: string;
      endsAt: string;
    }
  | {
      kind: "subscription_revoked";
      eventId: string;
      type: string;
      orgId: string;
      subscriptionId: string;
    }
  | { kind: "ignored"; eventId: string; type: string };

export interface BillingProvider {
  createCheckout(
    orgId: string,
    plan: Exclude<PlanId, "free">,
  ): Promise<{ url: string }>;
  /** null = signature invalid */
  handleWebhook(req: Request): Promise<BillingEvent | null>;
  /** month is 'YYYY-MM' */
  reportUsage(orgId: string, posts: number, month: string): Promise<void>;
}

/** Returns the Polar provider; a Stripe one replaces it later. */
export function billingProvider(): BillingProvider {
  return polarProvider;
}
