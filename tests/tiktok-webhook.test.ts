import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../lib/platforms/types";

let fake: PlatformAdapter;
vi.mock("../lib/platforms/registry", async (orig) => {
  const m = await orig<typeof import("../lib/platforms/registry")>();
  return { ...m, adapterFor: () => fake };
});

import { POST } from "../app/api/webhooks/tiktok/route";
import { encryptToken } from "../lib/crypto/tokens";
import { createEndpoint } from "../lib/db/queries/webhooks";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { verifySignature } from "../lib/platforms/tiktok/api";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

const SECRET = "tt-client-secret";
const sign = (raw: string, t = Math.floor(Date.now() / 1000), key = SECRET) =>
  `t=${t},s=${createHmac("sha256", key).update(`${t}.${raw}`).digest("hex")}`;

describe("tiktok signature", () => {
  const now = Date.now();
  const t = Math.floor(now / 1000);
  it("accepts a good signature", () => {
    expect(verifySignature("{}", sign("{}", t), SECRET, now)).toBe(true);
  });
  it("rejects a wrong key, a changed body, or a malformed header", () => {
    expect(verifySignature("{}", sign("{}", t, "other"), SECRET, now)).toBe(
      false,
    );
    expect(verifySignature("{ }", sign("{}", t), SECRET, now)).toBe(false);
    expect(verifySignature("{}", "garbage", SECRET, now)).toBe(false);
    expect(verifySignature("{}", null, SECRET, now)).toBe(false);
    expect(verifySignature("{}", `t=${t},s=ab`, SECRET, now)).toBe(false);
  });
  it("rejects a stale or future timestamp even with a valid MAC", () => {
    const old = t - 6 * 60;
    expect(verifySignature("{}", sign("{}", old), SECRET, now)).toBe(false);
    expect(verifySignature("{}", sign("{}", t + 6 * 60), SECRET, now)).toBe(
      false,
    );
    expect(verifySignature("{}", sign("{}", t - 4 * 60), SECRET, now)).toBe(
      true,
    );
  });
});

// The inbound event against real rows. Own far-future day (2095): no other test's worker claims these rows.
describe.skipIf(!hasDb)("tiktok inbound webhook", () => {
  let orgId = "";
  const NOW = new Date(Date.UTC(2095, 0, 1));
  // One account per publish id: (org, platform, platform_user_id) is unique.
  const openId = (publishId: string) => `open-${publishId}`;

  // Scripted adapter: the first step stores a publish id and waits, like TikTok's init.
  const script = (publishId: string) => {
    fake = {
      ...mockAdapter,
      refreshWindowMs: undefined,
      platform: "tiktok",
      quota: undefined,
      publishStep: async () => ({
        next: { stage: "status", data: { publish_id: publishId } },
        platformPublishId: publishId,
        waitMs: 600_000,
      }),
    } as PlatformAdapter;
  };

  async function mk(publishId: string) {
    const db = await testDb();
    const { data: a, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "tiktok",
        external_id: randomUUID(),
        platform_user_id: openId(publishId),
        status: "connected",
        access_token_enc: await encryptToken("tt-token"),
      })
      .select()
      .single();
    if (error) throw error;
    const { data: post } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "test",
        caption: "hi",
        status: "scheduled",
        scheduled_at: NOW.toISOString(),
        social_account_ids: [a.id],
        media: [] as never,
        platform_configurations: {},
      })
      .select()
      .single();
    const { data: target } = await db
      .from("social_post_targets")
      .insert({
        org_id: orgId,
        mode: "test",
        post_id: post?.id,
        social_account_id: a.id,
        platform: "tiktok",
        status: "pending",
        next_attempt_at: NOW.toISOString(),
      } as never)
      .select()
      .single();
    script(publishId);
    await publishTarget(target as never, { now: NOW });
    return target?.id as string;
  }
  const row = async (id: string) =>
    (
      await (
        await testDb()
      )
        .from("social_post_targets")
        .select("*")
        .eq("id", id)
        .single()
    ).data;
  const deliveries = async () =>
    (
      await (
        await testDb()
      )
        .from("webhook_deliveries")
        .select("id")
        .eq("org_id", orgId)
        .eq("event", "social.post.result.created")
    ).data?.length;
  const event = (
    publishId: string,
    postId = "7001",
    over: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      client_key: "ck",
      event: "post.publish.publicly_available",
      create_time: Math.floor(Date.now() / 1000),
      user_openid: openId(publishId),
      content: JSON.stringify({
        publish_id: publishId,
        post_id: postId,
        publish_type: "DIRECT_PUBLISH",
      }),
      ...over,
    });
  const send = (raw: string, sig = sign(raw)) =>
    POST(
      new Request("http://localhost/api/webhooks/tiktok", {
        method: "POST",
        headers: { "tiktok-signature": sig },
        body: raw,
      }),
    );

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TIKTOK_CLIENT_SECRET = SECRET;
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "tt-webhook", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    await createEndpoint(orgId, "test", "http://localhost:9/t", [
      "social.post.result.created",
    ]);
  });
  afterAll(async () => {
    await (await testDb()).from("organizations").delete().eq("id", orgId);
  });

  it("a publish step stores the platform publish id on the target", async () => {
    const id = await mk("pub-store");
    const t = await row(id);
    expect(t?.platform_publish_id).toBe("pub-store");
    expect(t?.status).toBe("pending");
  });

  it("bad signature: 401 problem, no DB change", async () => {
    const id = await mk("pub-bad");
    const raw = event("pub-bad");
    const res = await send(raw, sign(raw, undefined, "wrong"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_signature" });
    const t = await row(id);
    expect(t).toMatchObject({ status: "pending", platform_post_id: null });
  });

  it("stale timestamp: 401, no DB change", async () => {
    const id = await mk("pub-stale");
    const raw = event("pub-stale");
    const res = await send(
      raw,
      sign(raw, Math.floor(Date.now() / 1000) - 3600),
    );
    expect(res.status).toBe(401);
    expect((await row(id))?.status).toBe("pending");
  });

  it("good signature settles success with the post id; a duplicate changes nothing and emits nothing", async () => {
    const id = await mk("pub-good");
    const before = await deliveries();
    const res = await send(event("pub-good", "7777"));
    expect(res.status).toBe(200);
    const t = await row(id);
    expect(t).toMatchObject({
      status: "success",
      platform_post_id: "7777",
      publish_state: null,
    });
    expect(await deliveries()).toBe((before ?? 0) + 1);
    const again = await send(event("pub-good", "7777"));
    expect(again.status).toBe(200);
    // A different post id on a replay must not rewrite a settled target either.
    await send(event("pub-good", "9999"));
    expect((await row(id))?.platform_post_id).toBe("7777");
    expect(await deliveries()).toBe((before ?? 0) + 1);
  });

  it("an event for an unknown publish_id is a 200 no-op", async () => {
    const res = await send(event("pub-nobody"));
    expect(res.status).toBe(200);
  });

  it("an event for another TikTok user is a no-op", async () => {
    const id = await mk("pub-user");
    const res = await send(
      event("pub-user", "1", { user_openid: "someone-else" }),
    );
    expect(res.status).toBe(200);
    expect((await row(id))?.status).toBe("pending");
  });

  it("other event types are a 200 no-op", async () => {
    const id = await mk("pub-other");
    const res = await send(
      event("pub-other", "1", { event: "post.publish.complete" }),
    );
    expect(res.status).toBe(200);
    expect((await row(id))?.status).toBe("pending");
  });

  it("a target settled with the publish id as placeholder gets the real post id, silently", async () => {
    const id = await mk("pub-late");
    const db = await testDb();
    await db
      .from("social_post_targets")
      .update({ status: "success", platform_post_id: "pub-late" })
      .eq("id", id);
    const before = await deliveries();
    await send(event("pub-late", "8888"));
    expect((await row(id))?.platform_post_id).toBe("8888");
    expect(await deliveries()).toBe(before);
  });

  it("an event without user_openid is a no-op", async () => {
    const id = await mk("pub-nouser");
    const raw = JSON.stringify({
      event: "post.publish.publicly_available",
      content: JSON.stringify({ publish_id: "pub-nouser", post_id: "5" }),
    });
    expect((await send(raw)).status).toBe(200);
    expect((await row(id))?.status).toBe("pending");
  });

  it("a signed event settles a target that errored with post_outcome_unknown or media_processing_timeout, once", async () => {
    for (const code of ["post_outcome_unknown", "media_processing_timeout"]) {
      const pid = `pub-err-${code}`;
      const id = await mk(pid);
      await (await testDb())
        .from("social_post_targets")
        .update({ status: "error", error_code: code, error_message: "x" })
        .eq("id", id);
      const before = (await deliveries()) ?? 0;
      await send(event(pid, "4242"));
      expect(await row(id)).toMatchObject({
        status: "success",
        platform_post_id: "4242",
        error_code: null,
      });
      expect(await deliveries()).toBe(before + 1);
      await send(event(pid, "4242"));
      expect(await deliveries()).toBe(before + 1);
    }
  });

  it("a target with any other error code stays unchanged", async () => {
    const id = await mk("pub-err-other");
    await (await testDb())
      .from("social_post_targets")
      .update({ status: "error", error_code: "http_400", error_message: "x" })
      .eq("id", id);
    const before = await deliveries();
    await send(event("pub-err-other", "4243"));
    expect(await row(id)).toMatchObject({
      status: "error",
      platform_post_id: null,
      error_code: "http_400",
    });
    expect(await deliveries()).toBe(before);
  });

  it("an unsafe number or oversized post_id is not used", async () => {
    const id = await mk("pub-unsafe");
    const raw = JSON.stringify({
      event: "post.publish.publicly_available",
      user_openid: openId("pub-unsafe"),
      content: '{"publish_id":"pub-unsafe","post_id":7123456789012345678}',
    });
    expect((await send(raw)).status).toBe(200);
    expect((await row(id))?.status).toBe("pending");
    const long = event("pub-unsafe", "9".repeat(65));
    expect((await send(long)).status).toBe(200);
    expect((await row(id))?.status).toBe("pending");
    const num = JSON.stringify({
      event: "post.publish.publicly_available",
      user_openid: openId("pub-unsafe"),
      content: '{"publish_id":"pub-unsafe","post_id":123}',
    });
    await send(num);
    expect((await row(id))?.platform_post_id).toBe("123");
  });

  it("413 on a big content-length or a big streamed body, before any parse", async () => {
    const big = "x".repeat(70_000);
    const r1 = await POST(
      new Request("http://localhost/api/webhooks/tiktok", {
        method: "POST",
        headers: { "tiktok-signature": sign("{}"), "content-length": "70000" },
        body: "{}",
      }),
    );
    expect(r1.status).toBe(413);
    const r2 = await POST(
      new Request("http://localhost/api/webhooks/tiktok", {
        method: "POST",
        headers: { "tiktok-signature": sign(big) },
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(big));
            c.close();
          },
        }),
        // @ts-expect-error duplex is required for stream bodies in Node
        duplex: "half",
      }),
    );
    expect(r2.status).toBe(413);
    expect(await r2.json()).toMatchObject({ status: 413 });
  });

  it("a bad body with a good signature is 400", async () => {
    const res = await send("not json");
    expect(res.status).toBe(400);
  });
});
