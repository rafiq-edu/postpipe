import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/billing/plans";
import { PLAN_IDS, planCard } from "@/lib/marketing/plan-card";

describe("planCard", () => {
  it("renders prices and limits from PLANS", () => {
    expect(PLAN_IDS.map((id) => planCard(id).price)).toEqual([
      "$0",
      "$12",
      "$59",
    ]);
    expect(planCard("builder").posts).toBe(`1,500 posts per month`);
    expect(planCard("builder").overage).toBe(
      `Overage $${PLANS.builder.overagePerPost} per post`,
    );
    expect(planCard("scale").rate).toContain("600");
    expect(planCard("free").accounts).toBe("5 connected accounts");
  });
});
