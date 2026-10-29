import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../lib/platforms/types";

let fake: PlatformAdapter;
vi.mock("../lib/platforms/registry", async (orig) => {
  const m = await orig<typeof import("../lib/platforms/registry")>();
  return { ...m, adapterFor: () => fake };
});

const emit = vi.hoisted(() => vi.fn());
vi.mock("../lib/webhooks/events", () => ({ emit }));

import { encryptToken } from "../lib/crypto/tokens";
import { mockAdapter } from "../lib/platforms/mock/adapter";

let failRunLog = false;
vi.mock("../lib/db/client", async (orig) => {
  const m = await orig<typeof import("../lib/db/client")>();
  return {
    ...m,
    createServiceClient: async () => {
      const real = await m.createServiceClient();
      return new Proxy(real, {
        get(t, k) {
          if (k !== "from") return Reflect.get(t, k);
          return (table: string) => {
            const q = t.from(table as never);
            if (!failRunLog || table !== "publish_runs") return q;
            return new Proxy(q, {
              get(qt, qk) {
                if (qk === "update")
                  return () => ({
                    eq: async () => ({ error: new Error("boom") }),
                  });
                return Reflect.get(qt, qk).bind(qt);
              },
            });
          };
        },
      });
    },
  };
});

import { PublishError } from "../lib/platforms/types";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

// YouTube's quota rule with a scripted publish step: only the quota path is under test.
let script: (n: number) => Promise<unknown> = async () => ({
  result: { ok: true, platformPostId: "p1" },
});
let calls = 0;
fake = {
  ...mockAdapter,
  refreshWindowMs: undefined,
  publishStep: async () => script(++calls),
} as PlatformAdapter;

describe.skipIf(!hasDb)("publish lease", () => {
  let orgId = "";
  const base = Date.UTC(2094, 2, 1); // far future

  async function mk(n: number) {
    const db = await testDb();
    const when = new Date(base + n * 86_400_000);
    const { data: a, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "mock",
        external_id: randomUUID(),
        platform_user_id: randomUUID(),
        status: "connected",
        access_token_enc: await encryptToken("tok"),
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
        platform: "mock",
        status: "pending",
        locked_at: when.toISOString(),
        next_attempt_at: when.toISOString(),
      } as never)
      .select()
      .single();
    const row = async () =>
      (
        await db
          .from("social_post_targets")
          .select("*")
          .eq("id", target?.id as string)
          .single()
      ).data;
    return { when, target: target as never, row, id: target?.id as string };
  }
  const next = (n: number) => ({ next: { stage: `s${n}`, data: {} } });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "lease", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("a multi-step run moves locked_at forward at every step", async () => {
    const t = await mk(1);
    const seen: (string | null | undefined)[] = [];
    calls = 0;
    script = async (n) => {
      await sleep(15);
      seen.push((await t.row())?.locked_at);
      return n < 4 ? next(n) : { result: { ok: true, platformPostId: "p" } };
    };
    await publishTarget(t.target, { now: t.when });
    expect((await t.row())?.status).toBe("success");
    const ms = seen.map((x) => Date.parse(x as string));
    expect(ms[0]).toBe(t.when.getTime()); // the claim's value
    expect(ms[1]).toBeGreaterThan(ms[0]);
    expect(ms[2]).toBeGreaterThan(ms[1]);
    expect(ms[3]).toBeGreaterThan(ms[2]);
  });

  it("a run whose row was re-claimed mid-run stops without writing", async () => {
    const t = await mk(2);
    const db = await testDb();
    const other = new Date(t.when.getTime() + 3_600_000).toISOString();
    calls = 0;
    script = async (n) => {
      if (n === 1) return next(1);
      if (n === 2) {
        // another worker re-claims: new lock stamp, back to pending
        await db
          .from("social_post_targets")
          .update({ locked_at: other, status: "pending" })
          .eq("id", t.id);
        return next(2);
      }
      throw new Error("must not run a third step");
    };
    const r = await publishTarget(t.target, { now: t.when });
    expect(r.outcome).toBe("skipped");
    expect(calls).toBe(2);
    const row = await t.row();
    expect(row?.status).toBe("pending");
    expect(Date.parse(row?.locked_at as string)).toBe(Date.parse(other));
    expect(row?.error_code).toBeNull();
    expect(row?.publish_state).toEqual({ stage: "s1", data: {} });
  });

  async function lose(t: Awaited<ReturnType<typeof mk>>) {
    const db = await testDb();
    const other = new Date(t.when.getTime() + 3_600_000).toISOString();
    await db
      .from("social_post_targets")
      .update({ locked_at: other, status: "pending" })
      .eq("id", t.id);
    return other;
  }

  it("a run that lost its lease and then gets success writes nothing and emits nothing", async () => {
    const t = await mk(3);
    emit.mockClear();
    calls = 0;
    script = async () => {
      await lose(t);
      return { result: { ok: true, platformPostId: "late" } };
    };
    const r = await publishTarget(t.target, { now: t.when });
    expect(r.outcome).toBe("skipped");
    const row = await t.row();
    expect([row?.status, row?.platform_post_id]).toEqual(["pending", null]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("a lost lease then a retryable or auth error: no write, no emit, account untouched", async () => {
    for (const [n, kind] of [
      [4, "retryable"],
      [5, "auth"],
      [6, "permanent"],
    ] as const) {
      const t = await mk(n);
      emit.mockClear();
      script = async () => {
        await lose(t);
        throw new PublishError("x", kind, "boom");
      };
      const r = await publishTarget(t.target, { now: t.when });
      expect(r.outcome).toBe("skipped");
      const row = await t.row();
      expect([row?.status, row?.error_code]).toEqual(["pending", null]);
      expect(emit).not.toHaveBeenCalled();
      const db = await testDb();
      const { data: acc } = await db
        .from("social_accounts")
        .select("status")
        .eq("id", row?.social_account_id as string)
        .single();
      expect(acc?.status).toBe("connected");
    }
  });

  it("a failing run-log write after the guard cannot strand the post", async () => {
    for (const [n, fail] of [
      [7, false],
      [8, true],
    ] as const) {
      const t = await mk(n);
      emit.mockClear();
      script = async () =>
        fail
          ? Promise.reject(new PublishError("x", "permanent", "boom"))
          : { result: { ok: true, platformPostId: "ok" } };
      failRunLog = true;
      let r: Awaited<ReturnType<typeof publishTarget>>;
      try {
        r = await publishTarget(t.target, { now: t.when });
      } finally {
        failRunLog = false;
      }
      expect(r.outcome).toBe(fail ? "error" : "success");
      expect(emit).toHaveBeenCalledTimes(1);
      const row = await t.row();
      expect(row?.status).toBe(fail ? "error" : "success");
      const db = await testDb();
      const { data: post } = await db
        .from("social_posts")
        .select("status")
        .eq("id", row?.post_id as string)
        .single();
      expect(post?.status).not.toBe("processing");
    }
  });
});
