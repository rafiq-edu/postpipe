import { PICKED_OR } from "../connect/unpicked";
import { createServiceClient } from "../db/client";
import { PLANS, planOf } from "./plans";

export async function monthlyPostCount(
  orgId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<number> {
  const db = await createServiceClient();
  const { count, error } = await db
    .from("social_post_targets")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("mode", "live")
    .eq("status", "success")
    .gte("published_at", monthStart.toISOString())
    .lt("published_at", monthEnd.toISOString());
  if (error) throw error;
  return count ?? 0;
}

/** month is 'YYYY-MM', UTC. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

export async function computeOverage(
  orgId: string,
  month: string,
): Promise<{ posts: number; amountCents: number }> {
  const db = await createServiceClient();
  const { data: org, error } = await db
    .from("organizations")
    .select("plan")
    .eq("id", orgId)
    .single();
  if (error) throw error;
  const plan = PLANS[planOf(org.plan)];
  if (plan.overagePerPost === null) return { posts: 0, amountCents: 0 };
  const { start, end } = monthRange(month);
  const posts = Math.max(
    0,
    (await monthlyPostCount(orgId, start, end)) - plan.postsPerMonth,
  );
  return { posts, amountCents: Math.round(posts * plan.overagePerPost * 100) };
}

export async function checkPlanAllows(
  orgId: string,
  what: "post" | "account",
  excludeAccountId?: string,
): Promise<
  | { ok: true }
  | { ok: false; code: "plan_limit_reached" | "account_limit_reached" }
> {
  const db = await createServiceClient();
  const { data: org, error: e0 } = await db
    .from("organizations")
    .select("plan")
    .eq("id", orgId)
    .single();
  if (e0) throw e0;
  const plan = PLANS[planOf(org.plan)];

  if (what === "post") {
    if (plan.overagePerPost !== null) return { ok: true };
    const { start, end } = monthRange(new Date().toISOString().slice(0, 7));
    const count = await monthlyPostCount(orgId, start, end);
    return count >= plan.postsPerMonth
      ? { ok: false, code: "plan_limit_reached" }
      : { ok: true };
  }

  if (plan.accountsMax === null) return { ok: true };
  let q = db
    .from("social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("mode", "live")
    .eq("status", "connected")
    .or(PICKED_OR);
  if (excludeAccountId) q = q.neq("id", excludeAccountId); // the temporary connection row of a picker flow
  const { count, error } = await q;
  if (error) throw error;
  return (count ?? 0) >= plan.accountsMax
    ? { ok: false, code: "account_limit_reached" }
    : { ok: true };
}

export async function recordUsage(
  orgId: string,
  targetId: string,
  kind: "post_success" | "x_post" | "x_post_with_url",
): Promise<void> {
  const db = await createServiceClient();
  const { data: t, error: e0 } = await db
    .from("social_post_targets")
    .select("mode")
    .eq("id", targetId)
    .single();
  if (e0) throw e0;
  if (t.mode === "test") return;
  const { error } = await db
    .from("usage_events")
    .upsert(
      { org_id: orgId, mode: "live", target_id: targetId, kind, quantity: 1 },
      { onConflict: "target_id,kind", ignoreDuplicates: true },
    );
  if (error) throw error;
}
