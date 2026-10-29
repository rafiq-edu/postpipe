import { randomBytes, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { encryptToken } from "../lib/crypto/tokens";
import { findAccountById } from "../lib/db/queries/social-accounts";
import { createEndpoint } from "../lib/db/queries/webhooks";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { PublishError } from "../lib/platforms/types";
import { claimDue } from "../lib/publish/lock";
import { nextUtcMidnight, quotaScope, utcDay } from "../lib/publish/quotas";
import { refreshIfNeeded } from "../lib/publish/steps";
import { runDailyJobs, runPublishTick } from "../lib/publish/worker";
import { hasDb, testDb } from "./db";

const T = 20_000;
const ms = (iso: string | null) => new Date(iso as string).getTime();

describe.skipIf(!hasDb)("publish worker", () => {
  let orgId = "";
  let day = 0;
  const jobNames: string[] = [];

  // Each test gets its own fake day in 2020 so it never claims rows of other tests.
  const newClock = () => ({
    now: new Date(Date.UTC(2020, 0, 1) + day++ * 86_400_000),
  });

  async function mkAccount(
    clock: { now: Date },
    over: Record<string, unknown> = {},
  ) {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "tiktok",
        external_id: "ext",
        platform_user_id: randomUUID(),
        status: "connected",
        access_token_enc: await encryptToken("access-1"),
        refresh_token_enc: await encryptToken("refresh-1"),
        token_expires_at: new Date(
          clock.now.getTime() + 3_600_000,
        ).toISOString(),
        ...over,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function mkTarget(
    clock: { now: Date },
    accountId: string,
    caption: string,
    over: Record<string, unknown> = {},
    media: unknown[] = [],
  ) {
    const db = await testDb();
    const at = clock.now.toISOString();
    const { data: post, error } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "test",
        caption,
        status: "scheduled",
        scheduled_at: at,
        social_account_ids: [accountId],
        media: media as never,
      })
      .select()
      .single();
    if (error) throw error;
    const { data: target, error: e2 } = await db
      .from("social_post_targets")
      .insert({
        org_id: orgId,
        mode: "test",
        post_id: post.id,
        social_account_id: accountId,
        platform: "tiktok",
        status: "pending",
        next_attempt_at: at,
        ...over,
      } as never)
      .select()
      .single();
    if (e2) throw e2;
    return { post, target };
  }

  const targetOf = async (id: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_post_targets")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  };
  const postOf = async (id: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_posts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  };
  const runsOf = async (targetId: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("publish_runs")
      .select("*")
      .eq("target_id", targetId)
      .order("started_at");
    if (error) throw error;
    return data;
  };
  const deliveries = async (event: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("webhook_deliveries")
      .select("id")
      .eq("org_id", orgId)
      .eq("event", event);
    if (error) throw error;
    return data.length;
  };

  async function runToCompletion(postId: string, clock: { now: Date }) {
    const db = await testDb();
    for (let i = 0; i < 50; i++) {
      await runPublishTick({ now: clock.now, limit: 10 });
      const { data, error } = await db
        .from("social_post_targets")
        .select("status, next_attempt_at")
        .eq("post_id", postId);
      if (error) throw error;
      const open = data.filter(
        (t) => t.status === "pending" || t.status === "running",
      );
      if (!open.length) return;
      const next = Math.min(...open.map((t) => ms(t.next_attempt_at)));
      clock.now = new Date(Math.max(clock.now.getTime(), next));
    }
    throw new Error("runToCompletion did not finish");
  }

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t15", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
    for (const n of jobNames)
      await db.from("scheduled_jobs").delete().eq("name", n);
  });

  it(
    "publishes, records the run and emits the result event",
    async () => {
      const clock = newClock();
      const db = await testDb();
      await createEndpoint(orgId, "test", "http://localhost:9/t", [
        "social.post.result.created",
      ]);
      const a = await mkAccount(clock);
      const { post, target } = await mkTarget(clock, a.id, "hello");
      await runToCompletion(post.id, clock);
      const t = await targetOf(target.id);
      expect(t.status).toBe("success");
      expect(t.platform_post_id).toBeTruthy();
      expect(t.attempts).toBe(1);
      expect((await postOf(post.id)).status).toBe("completed");
      const runs = await runsOf(target.id);
      expect(runs.map((r) => r.status)).toEqual(["success"]);
      const { data: usage } = await db
        .from("usage_events")
        .select("id")
        .eq("target_id", target.id);
      expect(usage).toHaveLength(0);
      expect(await deliveries("social.post.result.created")).toBe(1);
    },
    T,
  );

  it(
    "retries along the ladder, then errors with attempts 6",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const { post, target } = await mkTarget(clock, a.id, "FAIL_RETRYABLE");
      await runToCompletion(post.id, clock);
      const t = await targetOf(target.id);
      expect(t.status).toBe("error");
      expect(t.attempts).toBe(6);
      const runs = await runsOf(target.id);
      expect(runs).toHaveLength(6);
      const gaps = runs
        .slice(1)
        .map((r, i) => (ms(r.started_at) - ms(runs[i].started_at)) / 1000);
      expect(gaps).toEqual([30, 120, 600, 1800, 7200]);
      expect((await postOf(post.id)).status).toBe("failed");
    },
    T,
  );

  it(
    "honours retryAfterMs when larger than the ladder",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const { post, target } = await mkTarget(clock, a.id, "RETRY_AFTER_10M");
      await runToCompletion(post.id, clock);
      const runs = await runsOf(target.id);
      expect((ms(runs[1].started_at) - ms(runs[0].started_at)) / 1000).toBe(
        600,
      );
    },
    T,
  );

  it(
    "records a permanent error after one attempt",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const { post, target } = await mkTarget(clock, a.id, "FAIL_PERMANENT");
      await runToCompletion(post.id, clock);
      const t = await targetOf(target.id);
      expect([t.status, t.attempts]).toEqual(["error", 1]);
      expect((await postOf(post.id)).status).toBe("failed");
    },
    T,
  );

  it(
    "expires the account on auth failure, emitting one disconnected event",
    async () => {
      const clock = newClock();
      await createEndpoint(orgId, "test", "http://localhost:9/d", [
        "social.account.disconnected",
      ]);
      const a = await mkAccount(clock);
      const one = await mkTarget(clock, a.id, "FAIL_AUTH");
      const two = await mkTarget(clock, a.id, "FAIL_AUTH");
      await runToCompletion(one.post.id, clock);
      await runToCompletion(two.post.id, clock);
      expect((await findAccountById(orgId, a.id))?.status).toBe("expired");
      for (const { target } of [one, two]) {
        const t = await targetOf(target.id);
        expect([t.status, t.error_code]).toEqual([
          "error",
          "account_reauth_required",
        ]);
      }
      expect(await deliveries("social.account.disconnected")).toBe(1);
    },
    T,
  );

  it(
    "fails unreachable media before publishStep",
    async () => {
      const clock = newClock();
      const spy = vi.spyOn(mockAdapter, "publishStep");
      const a = await mkAccount(clock);
      const missing = randomUUID();
      const { post, target } = await mkTarget(clock, a.id, "hello", {}, [
        { media_id: missing, url: `http://localhost:3000/media/${missing}` },
      ]);
      await runToCompletion(post.id, clock);
      const t = await targetOf(target.id);
      expect([t.status, t.error_code, t.attempts]).toEqual([
        "error",
        "media_unreachable",
        1,
      ]);
      expect(spy).not.toHaveBeenCalled();
    },
    T,
  );

  it(
    "two concurrent claimDue calls return each row once",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const x = await mkTarget(clock, a.id, "hello");
      const y = await mkTarget(clock, a.id, "hello");
      const [r1, r2] = await Promise.all([
        claimDue(10, clock.now),
        claimDue(10, clock.now),
      ]);
      const ids = [...r1, ...r2].map((r) => r.id).sort();
      expect(ids).toEqual([x.target.id, y.target.id].sort());
      // claimed but never run: cancel them so later fake days do not reclaim them
      const db = await testDb();
      await db
        .from("social_post_targets")
        .update({ status: "cancelled" })
        .in("id", ids);
    },
    T,
  );

  it(
    "resumes a multi-step publish from publish_state without a new attempt",
    async () => {
      const clock = newClock();
      const spy = vi.spyOn(mockAdapter, "publishStep");
      const a = await mkAccount(clock);
      const { post, target } = await mkTarget(clock, a.id, "MULTI_STEP", {
        publish_state: { stage: "uploaded", data: { steps: 1 } },
        attempts: 1,
      });
      await runToCompletion(post.id, clock);
      const t = await targetOf(target.id);
      expect([t.status, t.attempts]).toEqual(["success", 1]);
      expect(spy).toHaveBeenCalledTimes(2);
    },
    T,
  );

  it(
    "waits, saves state, then finishes on the next tick",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const { post, target } = await mkTarget(clock, a.id, "SLOW_30S");
      await runPublishTick({ now: clock.now, limit: 10 });
      const t = await targetOf(target.id);
      expect(t.status).toBe("pending");
      expect(t.locked_at).toBeNull();
      expect((t.publish_state as { stage: string }).stage).toBe("waiting");
      expect(ms(t.next_attempt_at)).toBe(clock.now.getTime() + 30_000);
      expect(t.attempts).toBe(1);
      await runToCompletion(post.id, clock);
      const done = await targetOf(target.id);
      expect([done.status, done.attempts]).toEqual(["success", 1]);
    },
    T,
  );

  it(
    "never claims cancelled targets or cancelled posts",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const x = await mkTarget(clock, a.id, "hello", { status: "cancelled" });
      const y = await mkTarget(clock, a.id, "hello");
      const db = await testDb();
      await db
        .from("social_posts")
        .update({ status: "cancelled" })
        .eq("id", y.post.id);
      const rows = await claimDue(10, clock.now);
      expect(rows.map((r) => r.id)).not.toContain(x.target.id);
      expect(rows.map((r) => r.id)).not.toContain(y.target.id);
    },
    T,
  );

  it(
    "reclaims a stale running target and resumes it",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const { post, target } = await mkTarget(clock, a.id, "MULTI_STEP", {
        status: "running",
        publish_state: { stage: "uploaded", data: { steps: 1 } },
        attempts: 1,
        locked_at: new Date(clock.now.getTime() - 31 * 60_000).toISOString(),
      });
      await runToCompletion(post.id, clock);
      const t = await targetOf(target.id);
      expect([t.status, t.attempts]).toEqual(["success", 2]);
    },
    T,
  );

  it(
    "does not claim a recently locked running target",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const { target } = await mkTarget(clock, a.id, "MULTI_STEP", {
        status: "running",
        publish_state: { stage: "uploaded", data: { steps: 1 } },
        attempts: 1,
        locked_at: new Date(clock.now.getTime() - 5 * 60_000).toISOString(),
      });
      const rows = await claimDue(10, clock.now);
      expect(rows.map((r) => r.id)).not.toContain(target.id);
      const db = await testDb();
      await db
        .from("social_post_targets")
        .update({ status: "cancelled" })
        .eq("id", target.id);
    },
    T,
  );

  it(
    "refreshes a near-expiry token once for concurrent callers",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock, {
        token_expires_at: new Date(
          clock.now.getTime() + 5 * 60_000,
        ).toISOString(),
        expiring_notified_at: clock.now.toISOString(),
      });
      let calls = 0;
      const wrapped = {
        ...mockAdapter,
        refreshToken: async (
          t: Parameters<typeof mockAdapter.refreshToken>[0],
        ) => {
          calls++;
          return mockAdapter.refreshToken(t);
        },
      };
      const [r1, r2] = await Promise.all([
        refreshIfNeeded(a, wrapped, clock.now),
        refreshIfNeeded(a, wrapped, clock.now),
      ]);
      expect(calls).toBe(1);
      expect(r1.accessToken).toBe(r2.accessToken);
      expect(r1.accessToken).not.toBe("access-1");
      const row = await findAccountById(orgId, a.id);
      expect(ms(row?.token_expires_at ?? null)).toBeGreaterThan(
        ms(a.token_expires_at),
      );
      expect(row?.refresh_lock_at).toBeNull();
      expect(row?.expiring_notified_at).toBeNull();
    },
    T,
  );

  it(
    "defers with daily_quota_reached when the cap is used up",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const db = await testDb();
      await db.from("platform_quotas").insert({
        scope: quotaScope(mockAdapter, a.id) as string,
        day: utcDay(clock.now),
        count: 100,
      });
      const { target } = await mkTarget(clock, a.id, "hello");
      await runPublishTick({ now: clock.now, limit: 10 });
      const t = await targetOf(target.id);
      expect([t.status, t.error_code, t.attempts]).toEqual([
        "pending",
        "daily_quota_reached",
        0,
      ]);
      expect(ms(t.next_attempt_at)).toBe(
        ms(nextUtcMidnight(utcDay(clock.now))),
      );
    },
    T,
  );

  it(
    "runs a daily job once across two workers",
    async () => {
      const clock = newClock();
      const name = `test-job-${randomUUID()}`;
      jobNames.push(name);
      let runs = 0;
      const jobs = {
        [name]: async () => {
          runs++;
        },
      };
      await Promise.all([
        runDailyJobs(clock.now, jobs),
        runDailyJobs(clock.now, jobs),
      ]);
      expect(runs).toBe(1);
      await runDailyJobs(new Date(clock.now.getTime() + 25 * 3_600_000), jobs);
      expect(runs).toBe(2);
    },
    T,
  );

  it(
    "a retryable token refresh error retries and keeps the account connected",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock, {
        token_expires_at: new Date(
          clock.now.getTime() + 5 * 60_000,
        ).toISOString(),
      });
      vi.spyOn(mockAdapter, "refreshToken").mockRejectedValue(
        new PublishError("rate_limited", "retryable", "slow down"),
      );
      const { target } = await mkTarget(clock, a.id, "hello");
      await runPublishTick({ now: clock.now, limit: 10 });
      const t = await targetOf(target.id);
      expect([t.status, t.error_code]).toEqual(["pending", "rate_limited"]);
      expect((await findAccountById(orgId, a.id))?.status).toBe("connected");
    },
    T,
  );

  it(
    "a crash-looping target ends with max_attempts_exceeded",
    async () => {
      const clock = newClock();
      const a = await mkAccount(clock);
      const { post, target } = await mkTarget(clock, a.id, "MULTI_STEP", {
        status: "running",
        publish_state: { stage: "uploaded", data: { steps: 1 } },
        attempts: 6,
        locked_at: new Date(clock.now.getTime() - 31 * 60_000).toISOString(),
      });
      await runPublishTick({ now: clock.now, limit: 10 });
      const t = await targetOf(target.id);
      expect([t.status, t.error_code]).toEqual([
        "error",
        "max_attempts_exceeded",
      ]);
      expect((await postOf(post.id)).status).toBe("failed");
    },
    T,
  );
});
