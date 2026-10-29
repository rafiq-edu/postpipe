import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DELETE,
  GET as getOne,
  PATCH,
} from "../app/api/v1/social-posts/[id]/route";
import { GET as list, POST } from "../app/api/v1/social-posts/route";
import { generateApiKey } from "../lib/api/auth";
import { encryptToken } from "../lib/crypto/tokens";
import { createEndpoint } from "../lib/db/queries/webhooks";
import { hasDb, testDb } from "./db";

const SECRET = /_enc|access_token|refresh_token/i;

describe.skipIf(!hasDb)("/v1/social-posts", () => {
  const orgs: string[] = [];
  let a = "";
  let b = "";
  let keyA = "";
  let liveKey = "";
  const id = {} as Record<
    | "acc1"
    | "acc2"
    | "accExpired"
    | "accLive"
    | "accB"
    | "img"
    | "vid3m"
    | "imgB",
    string
  >;
  const mediaUrl = (m: string) =>
    `${process.env.NEXT_PUBLIC_APP_URL}/media/${m}`;
  const hdr = (key: string) => ({
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  });

  const mkKey = async (orgId: string, mode: "live" | "test") => {
    const db = await testDb();
    const k = generateApiKey(mode);
    const { error } = await db.from("api_keys").insert({
      org_id: orgId,
      name: "t",
      key_hash: k.hash,
      key_prefix: k.prefix,
      last4: k.last4,
      mode,
    });
    if (error) throw error;
    return k.plaintext;
  };
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
  const mkAccount = async (
    orgId: string,
    mode: "live" | "test",
    status: "connected" | "expired",
  ) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode,
        platform: "mock",
        external_id: "e",
        platform_user_id: `pu-${Math.random()}`,
        username: "n",
        display_name: "N",
        access_token_enc: await encryptToken("a"),
        refresh_token_enc: await encryptToken("r"),
        status,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const mkMedia = async (
    orgId: string,
    mime: string,
    duration_ms: number | null,
  ) => {
    const db = await testDb();
    const { data, error } = await db
      .from("media")
      .insert({
        org_id: orgId,
        mode: "test",
        storage_path: `t/${Math.random()}`,
        mime,
        bytes: 1234,
        width: 100,
        height: 100,
        duration_ms,
        status: "validated",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  const call = async (res: Response) => {
    const text = await res.text();
    if (res.status < 300) expect(text).not.toMatch(SECRET);
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const create = async (key: string, body: unknown) =>
    call(
      await POST(
        new Request("http://localhost/api/v1/social-posts", {
          method: "POST",
          headers: hdr(key),
          body: JSON.stringify(body),
        }),
      ),
    );
  const route = (pid: string) => ({ params: Promise.resolve({ id: pid }) });
  const patch = async (key: string, pid: string, body: unknown) =>
    call(
      await PATCH(
        new Request("http://localhost/x", {
          method: "PATCH",
          headers: hdr(key),
          body: JSON.stringify(body),
        }),
        route(pid),
      ),
    );
  const del = async (key: string, pid: string) =>
    call(
      await DELETE(
        new Request("http://localhost/x", {
          method: "DELETE",
          headers: hdr(key),
        }),
        route(pid),
      ),
    );
  const get = async (key: string, pid: string) =>
    call(
      await getOne(
        new Request("http://localhost/x", { headers: hdr(key) }),
        route(pid),
      ),
    );
  const lst = async (key: string, query = "") =>
    call(
      await list(
        new Request(`http://localhost/api/v1/social-posts${query}`, {
          headers: hdr(key),
        }),
      ),
    );
  const targets = async (pid: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_post_targets")
      .select("*")
      .eq("post_id", pid);
    if (error) throw error;
    return data;
  };
  const deliveries = async () => {
    const db = await testDb();
    const { data, error } = await db
      .from("webhook_deliveries")
      .select("payload")
      .eq("org_id", a)
      .eq("event", "social.post.created");
    if (error) throw error;
    return data;
  };
  const postCount = async () => {
    const db = await testDb();
    const { count } = await db
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", a);
    return count;
  };

  // Each test that needs it uses its own account set via the shared accounts.
  beforeAll(async () => {
    a = await mkOrg("t14a");
    b = await mkOrg("t14b");
    keyA = await mkKey(a, "test");
    liveKey = await mkKey(a, "live");
    id.acc1 = await mkAccount(a, "test", "connected");
    id.acc2 = await mkAccount(a, "test", "connected");
    id.accExpired = await mkAccount(a, "test", "expired");
    id.accLive = await mkAccount(a, "live", "connected");
    id.accB = await mkAccount(b, "test", "connected");
    id.img = await mkMedia(a, "image/jpeg", null);
    id.vid3m = await mkMedia(a, "video/mp4", 180000);
    id.imgB = await mkMedia(b, "image/jpeg", null);
    await createEndpoint(a, "test", "https://example.com/hook", [
      "social.post.created",
    ]);
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().in("id", orgs);
  });

  it("creates one target per account and emits once", async () => {
    const r = await create(keyA, {
      caption: "hello",
      social_accounts: [id.acc1, id.acc2],
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("scheduled");
    expect(r.body.is_draft).toBe(false);
    expect(r.body.social_accounts).toEqual([id.acc1, id.acc2]);
    const t = await targets(r.body.id);
    expect(t).toHaveLength(2);
    for (const x of t) {
      expect(x.status).toBe("pending");
      expect(x.platform).toBe("mock");
      expect(
        Math.abs(Date.parse(x.next_attempt_at ?? "") - Date.now()),
      ).toBeLessThan(5000);
    }
    const d = (await deliveries()).filter(
      (x) =>
        (x.payload as { data: { post_id: string } }).data.post_id === r.body.id,
    );
    expect(d).toHaveLength(1);
    expect(
      (d[0].payload as { data: { social_accounts: string[] } }).data
        .social_accounts,
    ).toHaveLength(2);
  });

  it("uses scheduled_at for next_attempt_at", async () => {
    const at = new Date(Date.now() + 3_600_000);
    const r = await create(keyA, {
      caption: "later",
      social_accounts: [id.acc1, id.acc2],
      scheduled_at: at.toISOString(),
    });
    expect(r.status).toBe(201);
    for (const x of await targets(r.body.id))
      expect(Math.floor(Date.parse(x.next_attempt_at ?? "") / 1000)).toBe(
        Math.floor(at.getTime() / 1000),
      );
  });

  it("rejects unknown and expired accounts", async () => {
    let r = await create(keyA, { caption: "x", social_accounts: [id.accB] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("unknown_social_account");
    expect(r.body.social_account_ids).toEqual([id.accB]);
    r = await create(keyA, {
      caption: "x",
      social_accounts: [crypto.randomUUID()],
    });
    expect(r.body.code).toBe("unknown_social_account");
    r = await create(keyA, {
      caption: "x",
      social_accounts: [id.accExpired],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("account_reauth_required");
  });

  it("validates media", async () => {
    const before = await postCount();
    let r = await create(keyA, {
      social_accounts: [id.acc1],
      media: [{ url: mediaUrl(id.vid3m) }],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("validation_failed");
    expect(
      r.body.violations[id.acc1].map((v: { code: string }) => v.code),
    ).toContain("video_too_long");
    expect(await postCount()).toBe(before);

    r = await create(keyA, {
      social_accounts: [id.acc1],
      media: [{ url: "https://example.com/x.jpg" }],
    });
    expect(r.status).toBe(422);
    expect(r.body.errors[0].path).toBe("media.0.url");

    r = await create(keyA, {
      social_accounts: [id.acc1],
      media: [{ url: mediaUrl(id.imgB) }],
    });
    expect(r.status).toBe(422);
    expect(r.body.errors[0].message).toBe("media not found");

    r = await create(keyA, {
      social_accounts: [id.acc1],
      media: [{ url: mediaUrl(id.img), alt_text: "a" }],
    });
    expect(r.status).toBe(201);
    expect(r.body.media[0]).toEqual({ url: mediaUrl(id.img), alt_text: "a" });
    const db = await testDb();
    const { data } = await db
      .from("media")
      .select("last_used_at")
      .eq("id", id.img)
      .single();
    expect(data?.last_used_at).not.toBeNull();
    const { data: p } = await db
      .from("social_posts")
      .select("media_ids")
      .eq("id", r.body.id)
      .single();
    expect(p?.media_ids).toEqual([id.img]);
  });

  it("validates configurations", async () => {
    let r = await create(keyA, {
      caption: "x",
      social_accounts: [id.acc1],
      platform_configurations: { mock: { fail: true } },
    });
    expect(r.status).toBe(201);
    r = await create(keyA, {
      caption: "x",
      social_accounts: [id.acc1],
      platform_configurations: { mock: { nope: 1 } },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("validation_failed");
    r = await create(keyA, {
      caption: "x",
      social_accounts: [id.acc1],
      account_configurations: [
        { social_account_id: id.acc1, configuration: { delay_ms: 99999999 } },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.violations[id.acc1][0].code).toBe("invalid_configuration");
    r = await create(keyA, {
      caption: "x",
      social_accounts: [id.acc1],
      account_configurations: [
        { social_account_id: id.accB, configuration: {} },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.errors[0].path).toMatch(/^account_configurations\.0/);
  });

  it("rejects a long caption for every account", async () => {
    const r = await create(keyA, {
      caption: "x".repeat(501),
      social_accounts: [id.acc1, id.acc2],
    });
    expect(r.status).toBe(422);
    for (const acc of [id.acc1, id.acc2])
      expect(
        r.body.violations[acc].map((v: { code: string }) => v.code),
      ).toContain("caption_too_long");
  });

  it("drafts, patch, lock and delete", async () => {
    const d0 = (await deliveries()).length;
    let r = await create(keyA, {
      caption: "d",
      social_accounts: [id.acc1, id.acc2],
      is_draft: true,
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("draft");
    expect(await targets(r.body.id)).toHaveLength(0);
    expect(await deliveries()).toHaveLength(d0);
    const draftId = r.body.id;
    r = await patch(keyA, draftId, { is_draft: false });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("scheduled");
    const t = await targets(draftId);
    expect(t).toHaveLength(2);
    expect(t.every((x) => x.status === "pending")).toBe(true);
    expect(await deliveries()).toHaveLength(d0 + 1);

    r = await patch(keyA, draftId, { caption: "edited" });
    expect(r.status).toBe(200);
    expect(r.body.caption).toBe("edited");
    const t2 = await targets(draftId);
    expect(t2).toHaveLength(4);
    expect(t2.filter((x) => x.status === "cancelled")).toHaveLength(2);
    expect(t2.filter((x) => x.status === "pending")).toHaveLength(2);

    const db = await testDb();
    await db
      .from("social_post_targets")
      .update({ status: "running" })
      .eq("id", t2.find((x) => x.status === "pending")?.id ?? "");
    expect((await patch(keyA, draftId, { caption: "z" })).status).toBe(409);
    expect((await patch(keyA, draftId, { caption: "z" })).body.code).toBe(
      "post_locked",
    );
    expect((await del(keyA, draftId)).status).toBe(409);

    const fresh = await create(keyA, {
      caption: "del",
      social_accounts: [id.acc1, id.acc2],
    });
    expect((await del(keyA, fresh.body.id)).status).toBe(204);
    expect(
      (await targets(fresh.body.id)).every((x) => x.status === "cancelled"),
    ).toBe(true);
    expect((await get(keyA, fresh.body.id)).body.status).toBe("cancelled");
    expect((await del(keyA, fresh.body.id)).status).toBe(204);
    expect((await get(keyA, "not-a-uuid")).status).toBe(404);
  });

  it("enforces the plan limit in live mode only for non-drafts", async () => {
    const db = await testDb();
    const { data: post, error } = await db
      .from("social_posts")
      .insert({ org_id: a, mode: "live", caption: "old", status: "completed" })
      .select("id")
      .single();
    if (error) throw error;
    const { error: e2 } = await db.from("social_post_targets").insert(
      Array.from({ length: 50 }, () => ({
        org_id: a,
        mode: "live" as const,
        post_id: post.id,
        social_account_id: id.accLive,
        platform: "mock" as const,
        status: "success" as const,
        published_at: new Date().toISOString(),
      })),
    );
    if (e2) throw e2;
    let r = await create(liveKey, {
      caption: "x",
      social_accounts: [id.accLive],
    });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("plan_limit_reached");
    r = await create(liveKey, {
      caption: "x",
      social_accounts: [id.accLive],
      is_draft: true,
    });
    expect(r.status).toBe(201);
    r = await create(keyA, { caption: "x", social_accounts: [id.acc1] });
    expect(r.status).toBe(201);
  });

  it("checks the daily quota", async () => {
    const db = await testDb();
    const day = new Date().toISOString().slice(0, 10);
    await db
      .from("platform_quotas")
      .insert({ scope: `account:${id.acc1}`, day, count: 100 });
    const tomorrow = new Date(`${day}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    let r = await create(keyA, { caption: "q", social_accounts: [id.acc1] });
    expect(r.status).toBe(422);
    expect(r.body.violations[id.acc1][0].code).toBe("daily_quota_reached");
    expect(r.body.violations[id.acc1][0].earliest_at).toBe(
      tomorrow.toISOString(),
    );
    const noon = new Date(tomorrow.getTime() + 12 * 3_600_000);
    r = await create(keyA, {
      caption: "q",
      social_accounts: [id.acc1],
      scheduled_at: noon.toISOString(),
    });
    expect(r.status).toBe(201);
    await db.from("platform_quotas").delete().eq("scope", `account:${id.acc1}`);
  });

  it("lists with filters and cursor", async () => {
    const keyA = await mkKey(a, "test"); // fresh key: free plan rate limit is per key
    const page1 = await lst(keyA, "?limit=2");
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.next_cursor).toBeTruthy();
    const page2 = await lst(
      keyA,
      `?limit=100&cursor=${page1.body.next_cursor}`,
    );
    const ids1 = page1.body.data.map((p: { id: string }) => p.id);
    expect(
      page2.body.data.some((p: { id: string }) => ids1.includes(p.id)),
    ).toBe(false);
    await create(keyA, {
      caption: "dr",
      social_accounts: [id.acc2],
      is_draft: true,
    });
    const drafts = await lst(keyA, "?status=draft");
    expect(drafts.body.data.length).toBeGreaterThan(0);
    expect(
      drafts.body.data.every((p: { status: string }) => p.status === "draft"),
    ).toBe(true);
    const created = await create(keyA, {
      caption: "ext",
      social_accounts: [id.acc2],
      external_id: "ext-1",
    });
    const f = await lst(keyA, "?external_id=ext-1");
    expect(f.body.data.map((p: { id: string }) => p.id)).toEqual([
      created.body.id,
    ]);
  });
});
