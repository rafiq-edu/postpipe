import type { ReactNode } from "react";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { PLANS, planOf } from "@/lib/billing/plans";
import {
  computeOverage,
  monthlyPostCount,
  monthRange,
} from "@/lib/billing/usage";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { createServerSupabase } from "@/lib/db/server";
import { startCheckout } from "./actions";

const UPGRADES = [
  { id: "builder", label: "Builder ($12/month)" },
  { id: "scale", label: "Scale ($59/month)" },
] as const;

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const { orgId } = await getCurrentOrg();
  const supabase = await createServerSupabase();
  const { data: org } = await supabase
    .from("organizations")
    .select("plan, plan_ends_at")
    .eq("id", orgId)
    .single();
  const planId = planOf(org?.plan);
  const plan = PLANS[planId];
  const month = new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);
  const used = await monthlyPostCount(orgId, start, end);
  const overage =
    plan.overagePerPost === null ? null : await computeOverage(orgId, month);
  const rows: [string, ReactNode][] = [
    ["Plan", planId],
    ["Posts this month", `${used} of ${plan.postsPerMonth}`],
  ];
  if (overage)
    rows.push([
      "Overage so far",
      `${overage.posts} posts ($${(overage.amountCents / 100).toFixed(2)})`,
    ]);
  if (org?.plan_ends_at)
    rows.push([
      "Downgrades to Free on",
      <LocalTime key="ends" iso={org.plan_ends_at} short />,
    ]);
  return (
    <>
      <PageHeader title="Billing" summary="Your plan and usage this month." />
      {checkout === "success" && (
        <p role="status" className="rounded-md bg-muted p-3 text-sm">
          Payment received. Your plan updates within a minute.
        </p>
      )}
      <dl className="divide-y rounded-lg border">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]"
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular-nums capitalize">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        {UPGRADES.filter((u) => u.id !== planId).map((u) => (
          <form key={u.id} action={startCheckout}>
            <input type="hidden" name="plan" value={u.id} />
            <Button type="submit" variant="outline">
              Upgrade to {u.label}
            </Button>
          </form>
        ))}
      </div>
    </>
  );
}
