import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("polar webhook", () => {
  let orgId = "";
  let POST: (req: Request) => Promise<Response>;
  let runBillingDaily: (now: Date) => Promise<unknown>;
  let secret = "";

  const sign = (id: string, ts: string, body: string) =>
    `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
      .update(`${id}.${ts}.${body}`)
      .digest("base64")}`;
  const signed = (payload: unknown, id: string = randomUUID()) => {
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    return new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": ts,
        "webhook-signature": sign(id, ts, body),
      },
      body,
    });
  };
  const periodEnd = "2026-12-01T00:00:00.000Z";
  const sub = (type: string, extra: Record<string, unknown> = {}) => ({
    type,
    timestamp: new Date().toISOString(),
    data: {
      id: "sub_1",
      customer_id: "cus_1",
      product_id: "prod_builder",
      current_period_end: periodEnd,
      metadata: {},
      customer: { id: "cus_1", external_id: orgId },
      ...extra,
    },
  });
  const org = async () => {
    const db = await testDb();
    const { data } = await db
      .from("organizations")
      .select("plan, plan_ends_at, polar_subscription_id")
      .eq("id", orgId)
      .single();
    return data;
  };

  beforeAll(async () => {
    secret = `whsec_${randomBytes(32).toString("base64")}`;
    process.env.POLAR_WEBHOOK_SECRET = secret;
    process.env.POLAR_PRODUCT_BUILDER = "prod_builder";
    process.env.POLAR_PRODUCT_SCALE = "prod_scale";
    process.env.POLAR_ACCESS_TOKEN = "test";
    process.env.POLAR_SERVER = "sandbox";
    ({ POST } = await import("../app/api/billing/webhook/route"));
    ({ runBillingDaily } = await import("../lib/jobs/billing"));
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t18w", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("bad signature gives 400", async () => {
    const req = signed(sub("subscription.active"));
    req.headers.set("webhook-signature", "v1,AAAA");
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("active upgrades once, replay is a no-op", async () => {
    const id = randomUUID();
    expect((await POST(signed(sub("subscription.active"), id))).status).toBe(
      200,
    );
    expect(await org()).toMatchObject({
      plan: "builder",
      polar_subscription_id: "sub_1",
    });
    const again = await POST(signed(sub("subscription.active"), id));
    expect(await again.json()).toEqual({ replayed: true });
    const db = await testDb();
    const { count } = await db
      .from("billing_events")
      .select("event_id", { count: "exact", head: true })
      .eq("event_id", id);
    expect(count).toBe(1);
  });

  it("canceled schedules downgrade, daily job applies it", async () => {
    await POST(signed(sub("subscription.canceled")));
    const o = await org();
    expect(o?.plan).toBe("builder");
    expect(new Date(o?.plan_ends_at as string).toISOString()).toBe(periodEnd);
    await runBillingDaily(new Date(Date.parse(periodEnd) + 3600_000));
    expect((await org())?.plan).toBe("free");
  });

  it("revoked sets free", async () => {
    await POST(signed(sub("subscription.active")));
    expect((await org())?.plan).toBe("builder");
    await POST(signed(sub("subscription.revoked")));
    expect((await org())?.plan).toBe("free");
  });

  it("cancel and revoke of an old subscription are ignored", async () => {
    await POST(
      signed(
        sub("subscription.active", { id: "sub_2", product_id: "prod_scale" }),
      ),
    );
    await POST(signed(sub("subscription.canceled")));
    expect((await org())?.plan_ends_at).toBeNull();
    await POST(signed(sub("subscription.revoked")));
    expect(await org()).toMatchObject({
      plan: "scale",
      polar_subscription_id: "sub_2",
    });
  });

  it("uncanceled clears the scheduled downgrade", async () => {
    const cur = { id: "sub_2", product_id: "prod_scale" };
    await POST(signed(sub("subscription.canceled", cur)));
    expect((await org())?.plan_ends_at).not.toBeNull();
    await POST(signed(sub("subscription.uncanceled", cur)));
    expect(await org()).toMatchObject({ plan: "scale", plan_ends_at: null });
  });

  it("unknown type is ignored", async () => {
    const before = await org();
    const res = await POST(signed({ ...sub("something.else") }));
    expect(res.status).toBe(200);
    expect(await org()).toEqual(before);
  });
});
