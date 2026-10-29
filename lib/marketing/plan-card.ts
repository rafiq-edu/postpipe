import { PLANS, type PlanId } from "@/lib/billing/plans";

const NAMES: Record<PlanId, string> = {
  free: "Free",
  builder: "Builder",
  scale: "Scale",
};

const num = new Intl.NumberFormat("en-US");

// Every number shown on the pricing page comes from PLANS through here.
export function planCard(id: PlanId) {
  const p = PLANS[id];
  return {
    id,
    name: NAMES[id],
    price: `$${p.monthlyUsd}`,
    posts: `${num.format(p.postsPerMonth)} posts per month`,
    accounts:
      p.accountsMax === null
        ? "No limit on connected accounts"
        : `${p.accountsMax} connected accounts`,
    rate: `${num.format(p.ratePerMinute)} requests per minute`,
    overage:
      p.overagePerPost === null
        ? null
        : `Overage $${p.overagePerPost.toFixed(3)} per post`,
  };
}

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
