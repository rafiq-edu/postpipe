import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "../app/api/v1/social-post-results/route";
import { generateApiKey } from "../lib/api/auth";
import { encryptToken } from "../lib/crypto/tokens";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("/v1/social-post-results", () => {
  const orgs: string[] = [];
  let key = "";
  const ids = {} as Record<"tt" | "bs" | "post1" | "post2", string>;

  const mkOrg = async (name: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name, plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgs.push(data.id);
    return data.id;
  };
  const mkAccount = async (orgId: string, platform: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform,
        external_id: `r-${platform}`,
        platform_user_id: `pu-${platform}`,
        username: "n",
        display_name: "N",
        access_token_enc: await encryptToken("a"),
        status: "connected",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const mkPost = async (orgId: string, accounts: string[]) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "test",
        caption: "c",
        status: "completed",
        social_account_ids: accounts,
        media: [],
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const mkTarget = async (
    orgId: string,
    postId: string,
    accountId: string,
    platform: string,
  ) => {
    const db = await testDb();
    const { error } = await db.from("social_post_targets").insert({
      org_id: orgId,
      mode: "test",
      post_id: postId,
      social_account_id: accountId,
      platform,
      status: "success",
    } as never);
    if (error) throw error;
  };
  const get = async (qs = "") => {
    const res = await GET(
      new Request(`http://localhost/api/v1/social-post-results${qs}`, {
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      data: { id: string; platform: string; approval_limited: boolean }[];
      next_cursor: string | null;
    };
  };

  beforeAll(async () => {
    const a = await mkOrg("t17ra");
    const b = await mkOrg("t17rb");
    const db = await testDb();
    const k = generateApiKey("test");
    const { error } = await db.from("api_keys").insert({
      org_id: a,
      name: "t",
      key_hash: k.hash,
      key_prefix: k.prefix,
      last4: k.last4,
      mode: "test",
    });
    if (error) throw error;
    key = k.plaintext;
    ids.tt = await mkAccount(a, "tiktok");
    ids.bs = await mkAccount(a, "bluesky");
    ids.post1 = await mkPost(a, [ids.tt, ids.bs]);
    ids.post2 = await mkPost(a, [ids.tt]);
    await mkTarget(a, ids.post1, ids.tt, "tiktok");
    await mkTarget(a, ids.post1, ids.bs, "bluesky");
    await mkTarget(a, ids.post2, ids.tt, "tiktok");
    const other = await mkAccount(b, "tiktok");
    const otherPost = await mkPost(b, [other]);
    await mkTarget(b, otherPost, other, "tiktok");
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().in("id", orgs);
  });

  it("lists own results with approval_limited", async () => {
    const r = await get();
    expect(r.data).toHaveLength(3);
    for (const x of r.data)
      expect(x.approval_limited).toBe(x.platform === "tiktok");
  });
  it("filters by post_id and social_account_id", async () => {
    expect((await get(`?post_id=${ids.post1}`)).data).toHaveLength(2);
    expect((await get(`?social_account_id=${ids.bs}`)).data).toHaveLength(1);
  });
  it("pages with a cursor", async () => {
    const p1 = await get("?limit=1");
    expect(p1.next_cursor).not.toBeNull();
    const p2 = await get(`?limit=1&cursor=${p1.next_cursor}`);
    expect(p2.data[0]?.id).not.toBe(p1.data[0]?.id);
  });
});
