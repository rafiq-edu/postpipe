import { randomBytes, randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let resolved = "93.184.216.34";
vi.mock("node:dns", () => ({
  promises: { lookup: async () => [{ address: resolved, family: 4 }] },
}));

import { createEndpoint, replayDelivery } from "../lib/db/queries/webhooks";
import { RETRY_LADDER_SECONDS, runWebhookTick } from "../lib/webhooks/deliver";
import { EVENT_SCHEMAS, emit, type WebhookEvent } from "../lib/webhooks/events";
import { verifyWebhook } from "../lib/webhooks/sign";
import { hasDb, testDb } from "./db";

const uuid = () => randomUUID();
const iso = "2026-01-01T00:00:00.000Z";
const account = {
  id: uuid(),
  platform: "bluesky",
  external_id: "u1",
  platform_user_id: "did:x",
  username: "a",
  display_name: null,
  avatar_url: null,
  status: "connected",
  token_expires_at: null,
  created_at: iso,
};
const SAMPLES: Record<WebhookEvent, object> = {
  "social.post.created": {
    post_id: uuid(),
    external_id: null,
    status: "scheduled",
    scheduled_at: iso,
    social_accounts: [uuid()],
  },
  "social.post.result.created": {
    post_id: uuid(),
    result: {
      id: uuid(),
      post_id: uuid(),
      social_account_id: uuid(),
      platform: "bluesky",
      status: "success",
      platform_post_id: "p",
      platform_post_url: null,
      error_code: null,
      error_message: null,
      attempts: 1,
      published_at: iso,
      approval_limited: false,
    },
  },
  "social.account.created": { account },
  "social.account.disconnected": {
    account_id: uuid(),
    platform: "bluesky",
    external_id: "u1",
  },
  "social.account.token_expiring": {
    account_id: uuid(),
    platform: "bluesky",
    external_id: "u1",
    expires_at: iso,
    connect_url: "https://app.example.com/connect/t",
  },
};

// The tick claims due rows of every org, 20 at a time by default. Other test files leave due rows behind, which would crowd ours out.
const LIMIT = 10_000;

type Rec = { url: string; body: string; sig: string };
function fake(codes: number[]) {
  const calls: Rec[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    calls.push({ url, body: String(init.body), sig: h["PostPipe-Signature"] });
    return new Response(null, {
      status: codes[Math.min(calls.length - 1, codes.length - 1)],
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("webhook event schemas", () => {
  it("samples parse and never leak token fields", () => {
    for (const [ev, sample] of Object.entries(SAMPLES)) {
      expect(() =>
        EVENT_SCHEMAS[ev as WebhookEvent].parse(sample),
      ).not.toThrow();
      expect(JSON.stringify(sample)).not.toMatch(
        /_enc|access_token|refresh_token/i,
      );
    }
  });
});

describe.skipIf(!hasDb)("webhook delivery", () => {
  let orgId = "";
  let live: Awaited<ReturnType<typeof createEndpoint>>;
  let test: Awaited<ReturnType<typeof createEndpoint>>;
  const EV = "social.account.created";

  const deliveriesOf = async (endpointId: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("webhook_deliveries")
      .select("*")
      .eq("endpoint_id", endpointId)
      .order("created_at");
    if (error) throw error;
    return data;
  };
  const reset = async () => {
    const db = await testDb();
    await db.from("webhook_deliveries").delete().eq("org_id", orgId);
  };

  // A failed test must not leave rows that break the next one.
  beforeEach(reset);

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t16", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    live = await createEndpoint(orgId, "live", "https://example.com/live", [
      EV,
    ]);
    test = await createEndpoint(orgId, "test", "http://hooks.example.com/t", [
      EV,
    ]);
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("emit fans out by mode and validates", async () => {
    await emit(orgId, "live", EV, SAMPLES[EV] as never);
    expect(await deliveriesOf(live.id)).toHaveLength(1);
    expect(await deliveriesOf(test.id)).toHaveLength(0);
    await emit(orgId, "test", EV, SAMPLES[EV] as never);
    expect(await deliveriesOf(test.id)).toHaveLength(1);
    await expect(emit(orgId, "live", EV, { bad: 1 })).rejects.toThrow();
    await reset();
  });

  it("500 then 200 delivers on attempt 2 with a valid signature", async () => {
    await emit(orgId, "live", EV, SAMPLES[EV] as never);
    const f = fake([500, 200]);
    // emit stamps real now; use a clock after that.
    const base = Date.now() + 1000;
    const n0 = new Date(base);
    await runWebhookTick({
      limit: LIMIT,
      now: n0,
      fetchImpl: f.impl,
    });
    let [d] = await deliveriesOf(live.id);
    expect(d.status).toBe("pending");
    expect(d.attempt).toBe(1);
    expect(new Date(d.next_attempt_at as string).getTime()).toBe(base + 60_000);
    const n1 = new Date(base + 61_000);
    await runWebhookTick({
      limit: LIMIT,
      now: n1,
      fetchImpl: f.impl,
    });
    [d] = await deliveriesOf(live.id);
    expect(d.status).toBe("delivered");
    expect(d.attempt).toBe(2);
    expect(d.response_code).toBe(200);
    const last = f.calls[1];
    expect(
      verifyWebhook(
        last.body,
        last.sig,
        live.secret,
        300,
        Math.floor(n1.getTime() / 1000),
      ),
    ).toBe(true);
    expect(last.body).toBe(JSON.stringify(d.payload));
    await reset();
  });

  it("six failures end dead on the ladder; replay delivers", async () => {
    await emit(orgId, "live", EV, SAMPLES[EV] as never);
    const f = fake([500]);
    const base = Date.now() + 1000;
    const offs = [0, 61, 362, 2200, 9500, 32000];
    for (let i = 0; i < 6; i++) {
      const now = new Date(base + offs[i] * 1000);
      await runWebhookTick({
        limit: LIMIT,
        now,
        fetchImpl: f.impl,
      });
      const [d] = await deliveriesOf(live.id);
      expect(d.attempt).toBe(i + 1);
      if (i < 5) {
        expect(d.status).toBe("pending");
        expect(new Date(d.next_attempt_at as string).getTime()).toBe(
          now.getTime() + RETRY_LADDER_SECONDS[i] * 1000,
        );
      } else expect(d.status).toBe("dead");
    }
    const [dead] = await deliveriesOf(live.id);
    const newId = await replayDelivery(orgId, dead.id);
    const g = fake([200]);
    await runWebhookTick({
      limit: LIMIT,
      now: new Date(base + 40_000 * 1000),
      fetchImpl: g.impl,
    });
    const all = await deliveriesOf(live.id);
    const re = all.find((x) => x.id === newId);
    expect(re?.status).toBe("delivered");
    expect(re?.payload).toEqual(dead.payload);
    await reset();
  });

  it("disabled endpoint delivery is dead without a fetch", async () => {
    const db = await testDb();
    await emit(orgId, "test", EV, SAMPLES[EV] as never);
    await db
      .from("webhook_endpoints")
      .update({ enabled: false })
      .eq("id", test.id);
    const f = fake([200]);
    await runWebhookTick({
      limit: LIMIT,
      now: new Date(Date.now() + 1000),
      fetchImpl: f.impl,
    });
    const [d] = await deliveriesOf(test.id);
    expect(d.status).toBe("dead");
    expect(f.calls).toHaveLength(0);
  });

  it("private resolution makes no request and counts as a failed attempt", async () => {
    await emit(orgId, "live", EV, SAMPLES[EV] as never);
    resolved = "10.0.0.5";
    try {
      const f = fake([200]);
      await runWebhookTick({
        limit: LIMIT,
        now: new Date(Date.now() + 1000),
        fetchImpl: f.impl,
      });
      const [d] = await deliveriesOf(live.id);
      expect(f.calls).toHaveLength(0);
      expect(d.status).toBe("pending");
      expect(d.attempt).toBe(1);
    } finally {
      resolved = "93.184.216.34";
      await reset();
    }
  });

  it("signature time is the send time, not the tick time", async () => {
    await emit(orgId, "live", EV, SAMPLES[EV] as never);
    const f = fake([200]);
    // tick clock is 10 minutes off from real time
    await runWebhookTick({
      limit: LIMIT,
      now: new Date(Date.now() + 600_000),
      fetchImpl: f.impl,
    });
    const t = Number(/t=(\d+)/.exec(f.calls[0].sig)?.[1]);
    expect(Math.abs(t - Date.now() / 1000)).toBeLessThan(5);
    await reset();
  });
});
