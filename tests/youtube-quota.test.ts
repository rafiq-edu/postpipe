import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../lib/platforms/types";

let fake: PlatformAdapter;
vi.mock("../lib/platforms/registry", async (orig) => {
  const m = await orig<typeof import("../lib/platforms/registry")>();
  return { ...m, adapterFor: () => fake };
});

import { encryptToken } from "../lib/crypto/tokens";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { youtubeAdapter } from "../lib/platforms/youtube/adapter";
import { nextMidnight, quotaDay } from "../lib/publish/quota-day";
import { precheck } from "../lib/publish/quotas";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

// YouTube's quota rule with a scripted publish step: only the quota path is under test.
fake = {
  ...mockAdapter,
  refreshWindowMs: undefined,
  platform: "youtube",
  quota: youtubeAdapter.quota,
  publishStep: async () => ({
    result: { ok: true, platformPostId: "p1" },
  }),
} as PlatformAdapter;

const LA = "America/Los_Angeles";
const SCOPE = "project:youtube";

describe.skipIf(!hasDb)("youtube upload quota", () => {
  let orgId = "";
  const accounts: string[] = [];
  const days: string[] = [];

  // Far-future dates: no other test's worker tick claims these rows. `at` is the "now" of the worker.
  async function mk(at: Date, used: number) {
    const db = await testDb();
    const { data: a, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "youtube",
        external_id: randomUUID(),
        platform_user_id: randomUUID(),
        status: "connected",
        access_token_enc: await encryptToken("yt-token"),
      })
      .select()
      .single();
    if (error) throw error;
    accounts.push(a.id);
    const { data: post } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "test",
        caption: "hi",
        status: "scheduled",
        scheduled_at: at.toISOString(),
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
        platform: "youtube",
        status: "pending",
        next_attempt_at: at.toISOString(),
      } as never)
      .select()
      .single();
    const day = quotaDay(at, LA);
    days.push(day);
    if (used) {
      const { error: e } = await db
        .from("platform_quotas")
        .insert({ scope: SCOPE, day, count: used });
      if (e) throw e;
    }
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
          .eq("scope", SCOPE)
          .eq("day", day)
          .maybeSingle()
      ).data?.count ?? 0;
    return { day, target: target as never, row, count };
  }
  const at = (iso: string) => new Date(iso);

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "yt-quota", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    const db = await testDb();
    await db
      .from("platform_quotas")
      .delete()
      .eq("scope", SCOPE)
      .in("day", days);
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("101st upload of the day is deferred to the next Pacific midnight (summer: 07:00Z)", async () => {
    const t = await mk(at("2093-07-10T20:00:00Z"), 100);
    await publishTarget(t.target, { now: at("2093-07-10T20:00:00Z") });
    const r = await t.row();
    expect([r?.status, r?.error_code, r?.attempts]).toEqual([
      "pending",
      "daily_quota_reached",
      0,
    ]);
    expect(
      r?.next_attempt_at && new Date(r.next_attempt_at).toISOString(),
    ).toBe("2093-07-11T07:00:00.000Z");
    expect(await t.count()).toBe(100);
  });

  it("winter: next midnight is 08:00Z; the Pacific day, not the UTC day, is the key", async () => {
    // 03:00Z is still the previous Pacific day
    const now = at("2093-01-15T03:00:00Z");
    const t = await mk(now, 100);
    expect(t.day).toBe("2093-01-14");
    await publishTarget(t.target, { now });
    const r = await t.row();
    expect(r?.error_code).toBe("daily_quota_reached");
    expect(
      r?.next_attempt_at && new Date(r.next_attempt_at).toISOString(),
    ).toBe("2093-01-15T08:00:00.000Z");
  });

  it("the 100th upload takes quota and publishes", async () => {
    const now = at("2093-08-10T20:00:00Z");
    const t = await mk(now, 99);
    await publishTarget(t.target, { now });
    expect((await t.row())?.status).toBe("success");
    expect(await t.count()).toBe(100);
  });

  it("precheck: earliest_at is the next Pacific midnight; a later day is allowed", async () => {
    const when = at("2093-03-10T18:00:00Z"); // after the 2093 spring-forward week; PDT
    const t = await mk(when, 100);
    const acc = accounts[accounts.length - 1];
    const r = await precheck(youtubeAdapter, acc, when);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violation.code).toBe("daily_quota_reached");
      expect(r.violation.earliest_at).toBe(nextMidnight(t.day, LA));
    }
    const next = new Date(nextMidnight(t.day, LA));
    expect(await precheck(youtubeAdapter, acc, next)).toEqual({ ok: true });
  });
});
