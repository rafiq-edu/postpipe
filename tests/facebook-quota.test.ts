import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../lib/platforms/types";

let fake: PlatformAdapter;
vi.mock("../lib/platforms/registry", async (orig) => {
  const m = await orig<typeof import("../lib/platforms/registry")>();
  return { ...m, adapterFor: () => fake };
});

import { encryptToken } from "../lib/crypto/tokens";
import { facebookAdapter } from "../lib/platforms/facebook/adapter";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { precheck, utcDay } from "../lib/publish/quotas";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

// Facebook's quota rule with a scripted publish step: only the quota path is under test.
fake = {
  ...mockAdapter,
  refreshWindowMs: undefined,
  quota: facebookAdapter.quota,
  publishStep: async () => ({
    result: { ok: true, platformPostId: "p1" },
  }),
} as PlatformAdapter;

describe.skipIf(!hasDb)("facebook Reel quota", () => {
  let orgId = "";
  const day = Date.UTC(2091, 5, 1); // far future: no other test's worker tick claims these rows
  let n = 0;

  async function mk(reel: boolean, used: number) {
    const db = await testDb();
    const when = new Date(day + ++n * 86_400_000);
    const { data: a, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "facebook",
        external_id: randomUUID(),
        platform_user_id: randomUUID(),
        status: "connected",
        access_token_enc: await encryptToken("page-token"),
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
        scheduled_at: when.toISOString(),
        social_account_ids: [a.id],
        media: [] as never,
        platform_configurations: { facebook: reel ? { reel: true } : {} },
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
        platform: "facebook",
        status: "pending",
        next_attempt_at: when.toISOString(),
      } as never)
      .select()
      .single();
    const scope = `account:${a.id}`;
    if (used)
      await db
        .from("platform_quotas")
        .insert({ scope, day: utcDay(when), count: used });
    const row = async () =>
      (
        await db
          .from("social_post_targets")
          .select("*")
          .eq("id", target?.id as string)
          .single()
      ).data;
    const count = async () =>
      (
        await db
          .from("platform_quotas")
          .select("count")
          .eq("scope", scope)
          .eq("day", utcDay(when))
          .maybeSingle()
      ).data?.count ?? 0;
    return { when, acc: a.id as string, target: target as never, row, count };
  }

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "fb-quota", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("31st Reel is deferred, a plain post at the same count publishes and takes no quota", async () => {
    const reel = await mk(true, 30);
    await publishTarget(reel.target, { now: reel.when });
    const r = await reel.row();
    expect([r?.status, r?.error_code, r?.attempts]).toEqual([
      "pending",
      "daily_quota_reached",
      0,
    ]);
    expect(await reel.count()).toBe(30);

    const plain = await mk(false, 30);
    await publishTarget(plain.target, { now: plain.when });
    expect((await plain.row())?.status).toBe("success");
    expect(await plain.count()).toBe(30);
  });

  it("the 30th Reel takes quota", async () => {
    const reel = await mk(true, 29);
    await publishTarget(reel.target, { now: reel.when });
    expect((await reel.row())?.status).toBe("success");
    expect(await reel.count()).toBe(30);
  });

  it("precheck: Reel blocked at 30, plain post allowed; other adapters unaffected", async () => {
    const db = await testDb();
    const acc = randomUUID();
    const scope = `account:${acc}`;
    const d = utcDay(new Date());
    await db.from("platform_quotas").insert({ scope, day: d, count: 100 });
    const reel = await precheck(facebookAdapter, acc, null, {
      config: { reel: true },
    });
    expect(reel.ok).toBe(false);
    expect(await precheck(facebookAdapter, acc, null, { config: {} })).toEqual({
      ok: true,
    });
    // An adapter with no appliesTo (the mock, cap 100) is still capped whatever the config.
    const other = await precheck(mockAdapter, acc, null, { config: {} });
    expect(other.ok).toBe(false);
    await db.from("platform_quotas").delete().eq("scope", scope);
  });
});
