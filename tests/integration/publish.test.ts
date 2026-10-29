// Needs `docker compose up --build --scale worker=2 -d` and local Supabase. Run: pnpm test:integration
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApiKey } from "../../lib/api/auth";
import { encryptToken } from "../../lib/crypto/tokens";
import { testDb } from "../db";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("publish pipeline (docker compose)", () => {
  let orgId = "";
  let accountId = "";
  let key = "";

  const api = (method: string, path: string, body?: unknown) =>
    fetch(`${BASE}/api/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const schedule = async (caption: string, inSeconds: number) => {
    const at = new Date(Date.now() + inSeconds * 1000);
    const r = await api("POST", "social-posts", {
      caption,
      social_accounts: [accountId],
      scheduled_at: at.toISOString(),
    });
    expect(r.status).toBe(201);
    return { id: ((await r.json()) as { id: string }).id, at };
  };
  const targetOf = async (postId: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_post_targets")
      .select("*")
      .eq("post_id", postId)
      .single();
    if (error) throw error;
    return data;
  };
  const postStatus = async (postId: string) => {
    const db = await testDb();
    const { data } = await db
      .from("social_posts")
      .select("status")
      .eq("id", postId)
      .single();
    return data?.status;
  };

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.CURRENT_TOKEN_KEY_VERSION ??= "1";
    process.env.TOKEN_KEY_V1 ??= randomBytes(32).toString("base64");
    const db = await testDb();
    const { data: org, error } = await db
      .from("organizations")
      .insert({ name: "t15-integration", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = org.id;
    const k = generateApiKey("test");
    await db.from("api_keys").insert({
      org_id: orgId,
      name: "t",
      key_hash: k.hash,
      key_prefix: k.prefix,
      last4: k.last4,
      mode: "test",
    });
    key = k.plaintext;
    const { data: acc, error: e2 } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "tiktok",
        external_id: "ext",
        platform_user_id: randomUUID(),
        status: "connected",
        access_token_enc: await encryptToken("access"),
        refresh_token_enc: await encryptToken("refresh"),
        token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .select("id")
      .single();
    if (e2) throw e2;
    accountId = acc.id;
  });

  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("publishes a scheduled post once, within 60 s of scheduled_at", async () => {
    const { id, at } = await schedule("hello", 20);
    const deadline = at.getTime() + 60_000;
    while (Date.now() < deadline && (await postStatus(id)) !== "completed")
      await sleep(1000);
    expect(await postStatus(id)).toBe("completed");
    const t = await targetOf(id);
    const db = await testDb();
    const { data: runs } = await db
      .from("publish_runs")
      .select("id")
      .eq("target_id", t.id);
    expect(runs).toHaveLength(1); // exactly once across two workers
    const lateness = Date.parse(t.started_at ?? "") - at.getTime();
    console.log(`lateness_ms=${lateness}`);
    expect(lateness).toBeLessThan(60_000);
  }, 120_000);

  it("keeps a post cancelled while waiting", async () => {
    const { id } = await schedule("hello", 60);
    await sleep(5000);
    expect((await api("DELETE", `social-posts/${id}`)).status).toBe(204);
    await sleep(70_000);
    expect(await postStatus(id)).toBe("cancelled");
    expect((await targetOf(id)).status).toBe("cancelled");
  }, 120_000);
});
