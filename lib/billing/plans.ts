export const PLANS = {
  free: {
    monthlyUsd: 0,
    postsPerMonth: 50,
    accountsMax: 5,
    ratePerMinute: 30,
    overagePerPost: null,
  },
  builder: {
    monthlyUsd: 12,
    postsPerMonth: 1500,
    accountsMax: null,
    ratePerMinute: 120,
    overagePerPost: 0.005,
  },
  scale: {
    monthlyUsd: 59,
    postsPerMonth: 15000,
    accountsMax: null,
    ratePerMinute: 600,
    overagePerPost: 0.003,
  },
} satisfies Record<
  "free" | "builder" | "scale",
  {
    monthlyUsd: 0 | 12 | 59;
    postsPerMonth: number;
    accountsMax: number | null;
    ratePerMinute: number;
    overagePerPost: number | null;
  }
>;
export type PlanId = keyof typeof PLANS;

export function planOf(value: string | null | undefined): PlanId {
  return value && Object.hasOwn(PLANS, value) ? (value as PlanId) : "free";
}
