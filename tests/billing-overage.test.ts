import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computeOverage } from "../lib/billing/usage";
import { usageKinds } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

describe("usageKinds", () => {
  const ok = (hasUrl: boolean) => ({
    ok: true as const,
    platformPostId: "1",
    meta: { hasUrl },
  });
  it("maps platform and url", () => {
    expect(usageKinds("x", ok(true))).toEqual([
      "post_success",
      "x_post_with_url",
    ]);
    expect(usageKinds("x", ok(false))).toEqual(["post_success", "x_post"]);
    expect(usageKinds("bluesky", ok(true))).toEqual(["post_success"]);
  });
});

describe.skipIf(!hasDb)("computeOverage", () => {
  let org = "";
  const month = new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t18o", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    org = data.id;
    const { data: acc } = await db
      .from("social_accounts")
      .insert({
        org_id: org,
        mode: "live",
        platform: "bluesky",
        external_id: "o",
        platform_user_id: "o",
        status: "revoked",
      })
      .select("id")
      .single();
    const { data: p } = await db
      .from("social_posts")
      .insert({ org_id: org, mode: "live", caption: "x" })
      .select("id")
      .single();
    const row = {
      org_id: org,
      mode: "live",
      post_id: p?.id as string,
      social_account_id: acc?.id as string,
      platform: "bluesky",
      status: "success" as const,
      published_at: new Date().toISOString(),
    };
    for (let i = 0; i < 4; i++) {
      const { error: e } = await db
        .from("social_post_targets")
        .insert(Array.from({ length: 400 }, () => row));
      if (e) throw e;
    }
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", org);
  });

  const setPlan = async (plan: string) => {
    const db = await testDb();
    await db.from("organizations").update({ plan }).eq("id", org);
  };

  it("builder 1600 gives 100 posts, 50 cents", async () => {
    expect(await computeOverage(org, month)).toEqual({
      posts: 100,
      amountCents: 50,
    });
  });
  it("free has no overage", async () => {
    await setPlan("free");
    expect(await computeOverage(org, month)).toEqual({
      posts: 0,
      amountCents: 0,
    });
  });
  it("scale under quota has none", async () => {
    await setPlan("scale");
    expect(await computeOverage(org, month)).toEqual({
      posts: 0,
      amountCents: 0,
    });
  });
});

const reportUsage = vi.fn(async () => {});
vi.mock("../lib/billing/provider", () => ({
  billingProvider: () => ({ reportUsage }),
}));

describe.skipIf(!hasDb)("runBillingDaily overage", () => {
  let org = "";
  const now = new Date("2100-03-05T10:00:00Z");
  const mine = () =>
    reportUsage.mock.calls.filter((c) => (c as unknown[])[0] === org);

  beforeAll(async () => {
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({
        name: "t18d",
        plan: "builder",
        plan_ends_at: "2100-03-01T00:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw error;
    org = data.id;
    const { data: acc } = await db
      .from("social_accounts")
      .insert({
        org_id: org,
        mode: "live",
        platform: "bluesky",
        external_id: "d",
        platform_user_id: "d",
        status: "revoked",
      })
      .select("id")
      .single();
    const { data: p } = await db
      .from("social_posts")
      .insert({ org_id: org, mode: "live", caption: "x" })
      .select("id")
      .single();
    const row = {
      org_id: org,
      mode: "live",
      post_id: p?.id as string,
      social_account_id: acc?.id as string,
      platform: "bluesky",
      status: "success" as const,
      published_at: "2100-02-10T00:00:00Z",
    };
    for (let i = 0; i < 4; i++) {
      const { error: e } = await db
        .from("social_post_targets")
        .insert(Array.from({ length: 400 }, () => row));
      if (e) throw e;
    }
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", org);
  });

  it("reports previous month on day 5, once, then downgrades", async () => {
    const { runBillingDaily } = await import("../lib/jobs/billing");
    await runBillingDaily(now);
    expect(mine()).toEqual([[org, 100, "2100-02"]]);
    const db = await testDb();
    const { data } = await db
      .from("organizations")
      .select("plan")
      .eq("id", org)
      .single();
    expect(data?.plan).toBe("free");
    await runBillingDaily(now);
    expect(mine()).toHaveLength(1);
  });
});
