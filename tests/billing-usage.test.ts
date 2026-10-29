import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPlanAllows, recordUsage } from "../lib/billing/usage";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("billing usage", () => {
  let org: string;
  let accountId: string;
  let postId: string;
  const ids: string[] = [];

  const addTargets = async (n: number, mode = "live") => {
    const db = await testDb();
    const rows = Array.from({ length: n }, () => ({
      org_id: org,
      mode,
      post_id: postId,
      social_account_id: accountId,
      platform: "bluesky",
      status: "success" as const,
      published_at: new Date().toISOString(),
    }));
    const { data, error } = await db
      .from("social_post_targets")
      .insert(rows)
      .select("id");
    if (error) throw error;
    return data.map((r) => r.id);
  };
  const addAccount = async (n: number, status: "connected" | "revoked") => {
    const db = await testDb();
    const { error } = await db.from("social_accounts").insert({
      org_id: org,
      mode: "live",
      platform: "bluesky",
      external_id: `e${n}${status}`,
      platform_user_id: `p${n}${status}`,
      status,
    });
    if (error) throw error;
  };

  beforeAll(async () => {
    const db = await testDb();
    const { data: o, error } = await db
      .from("organizations")
      .insert({ name: "t8b", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    org = o.id;
    const { data: acc } = await db
      .from("social_accounts")
      .insert({
        org_id: org,
        mode: "live",
        platform: "bluesky",
        external_id: "base",
        platform_user_id: "base",
        status: "revoked",
      })
      .select("id")
      .single();
    accountId = acc?.id as string;
    const { data: p } = await db
      .from("social_posts")
      .insert({ org_id: org, mode: "live", caption: "x" })
      .select("id")
      .single();
    postId = p?.id as string;
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", org);
  });

  it("post limit on free, ok on builder", async () => {
    const db = await testDb();
    ids.push(...(await addTargets(50)));
    expect(await checkPlanAllows(org, "post")).toEqual({
      ok: false,
      code: "plan_limit_reached",
    });
    await db.from("organizations").update({ plan: "builder" }).eq("id", org);
    expect(await checkPlanAllows(org, "post")).toEqual({ ok: true });
    await db.from("organizations").update({ plan: "free" }).eq("id", org);
    await db.from("social_post_targets").delete().eq("id", ids[0]);
    expect(await checkPlanAllows(org, "post")).toEqual({ ok: true });
  });

  it("account limit on free", async () => {
    for (let i = 0; i < 4; i++) await addAccount(i, "connected");
    await addAccount(9, "revoked");
    expect(await checkPlanAllows(org, "account")).toEqual({ ok: true });
    await addAccount(4, "connected");
    expect(await checkPlanAllows(org, "account")).toEqual({
      ok: false,
      code: "account_limit_reached",
    });
  });

  it("recordUsage is idempotent and skips test mode", async () => {
    const db = await testDb();
    await recordUsage(org, ids[1], "post_success");
    await recordUsage(org, ids[1], "post_success");
    const { count } = await db
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("target_id", ids[1]);
    expect(count).toBe(1);
    const [testTarget] = await addTargets(1, "test");
    await recordUsage(org, testTarget, "post_success");
    const { count: c2 } = await db
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("target_id", testTarget);
    expect(c2).toBe(0);
  });
});
