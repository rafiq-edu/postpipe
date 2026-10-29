import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../lib/platforms/types";
import { PublishError } from "../lib/platforms/types";

// Scripted adapter: tests set `script` before each publishTarget call.
const script: {
  usage: () => Promise<{ used: number; total: number }>;
  step: () => Promise<{ result: { ok: true; platformPostId: string } }>;
} = {
  usage: async () => ({ used: 0, total: 50 }),
  step: async () => ({ result: { ok: true, platformPostId: "p1" } }),
};
let fake: PlatformAdapter;
vi.mock("../lib/platforms/registry", async (orig) => {
  const m = await orig<typeof import("../lib/platforms/registry")>();
  return { ...m, adapterFor: () => fake };
});

import { encryptToken } from "../lib/crypto/tokens";
import type { Tables } from "../lib/db/types";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { recordReportedUsage, utcDay } from "../lib/publish/quotas";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

fake = {
  ...mockAdapter,
  refreshWindowMs: undefined,
  quota: { scope: "account", dailyCap: 50, sourceLine: "test" },
  reportedUsage: () => script.usage(),
  publishStep: () => script.step(),
} as PlatformAdapter;

describe.skipIf(!hasDb)("reported usage and quota on retry", () => {
  let orgId = "";
  const day = Date.UTC(2090, 5, 1); // far future: other files' worker ticks never claim these rows;
  let n = 0;

  async function mk() {
    const db = await testDb();
    const when = new Date(day + ++n * 86_400_000); // a fresh UTC day per test
    const { data: a, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "mock",
        external_id: randomUUID(),
        platform_user_id: randomUUID(),
        status: "connected",
        access_token_enc: await encryptToken("access-1"),
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
        platform: "mock",
        status: "pending",
        next_attempt_at: when.toISOString(),
      } as never)
      .select()
      .single();
    const scope = `account:${a.id}`;
    const row = (): PromiseLike<Tables<"social_post_targets">> =>
      db
        .from("social_post_targets")
        .select("*")
        .eq("id", target?.id as string)
        .single()
        .then((r) => r.data as Tables<"social_post_targets">);
    const count = async () =>
      (
        await db
          .from("platform_quotas")
          .select("count")
          .eq("scope", scope)
          .eq("day", utcDay(when))
          .maybeSingle()
      ).data?.count ?? 0;
    return { when, scope, row, count, target: target as never };
  }

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "reported-usage", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("recordReportedUsage raises, never lowers", async () => {
    const scope = `account:${randomUUID()}`;
    const db = await testDb();
    await recordReportedUsage(scope, "2018-01-01", 5);
    await recordReportedUsage(scope, "2018-01-01", 3);
    await recordReportedUsage(scope, "2018-01-01", 9);
    const r = await db
      .from("platform_quotas")
      .select("count")
      .eq("scope", scope)
      .single();
    expect(r.data?.count).toBe(9);
    await db.from("platform_quotas").delete().eq("scope", scope);
  });

  it("reported 50 of 50 gives retryable daily_quota_reached and raises the stored count", async () => {
    const t = await mk();
    script.usage = async () => ({ used: 50, total: 50 });
    await publishTarget(t.target, { now: t.when });
    const r = await t.row();
    expect([r.status, r.error_code]).toEqual([
      "pending",
      "daily_quota_reached",
    ]);
    expect(await t.count()).toBe(50);
  });

  it("a usage error fails open and the post publishes", async () => {
    const t = await mk();
    script.usage = async () => {
      throw new PublishError("http_500", "retryable", "x");
    };
    await publishTarget(t.target, { now: t.when });
    expect((await t.row()).status).toBe("success");
  });

  it("a retry after a retryable error does not consume quota again", async () => {
    const t = await mk();
    script.usage = async () => ({ used: 0, total: 50 });
    script.step = async () => {
      throw new PublishError("http_503", "retryable", "boom");
    };
    await publishTarget(t.target, { now: t.when });
    expect((await t.row()).status).toBe("pending");
    expect(await t.count()).toBe(1);
    script.step = async () => ({ result: { ok: true, platformPostId: "p1" } });
    await publishTarget((await t.row()) as never, {
      now: new Date(t.when.getTime() + 3_600_000),
    });
    expect((await t.row()).status).toBe("success");
    expect(await t.count()).toBe(1);
    script.step = async () => ({ result: { ok: true, platformPostId: "p1" } });
  });

  it("the 51st post is deferred by the worker consume path", async () => {
    const t = await mk();
    const db = await testDb();
    script.usage = async () => ({ used: 0, total: 50 });
    await db
      .from("platform_quotas")
      .insert({ scope: t.scope, day: utcDay(t.when), count: 50 });
    await publishTarget(t.target, { now: t.when });
    const r = await t.row();
    expect([r.status, r.error_code, r.attempts]).toEqual([
      "pending",
      "daily_quota_reached",
      0,
    ]);
    expect(await t.count()).toBe(50);
  });
});
