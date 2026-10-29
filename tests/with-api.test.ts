import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApiKey } from "../lib/api/auth";
import { requestHash } from "../lib/api/idempotency";
import { withApi } from "../lib/api/with-api";
import { hasDb, testDb } from "./db";

async function mkOrg() {
  const db = await testDb();
  const { data: org, error } = await db
    .from("organizations")
    .insert({ name: "t8", plan: "free" })
    .select("id")
    .single();
  if (error) throw error;
  const k = generateApiKey("test");
  const { error: e2 } = await db.from("api_keys").insert({
    org_id: org.id,
    name: "t",
    key_hash: k.hash,
    key_prefix: k.prefix,
    last4: k.last4,
    mode: "test",
  });
  if (e2) throw e2;
  return { orgId: org.id, plaintext: k.plaintext };
}

describe.skipIf(!hasDb)("withApi", () => {
  const orgs: string[] = [];
  let a: Awaited<ReturnType<typeof mkOrg>>;
  let b: Awaited<ReturnType<typeof mkOrg>>;
  let calls = 0;
  let seenParams: Record<string, string> = {};
  const route = withApi(
    async (ctx) => {
      seenParams = ctx.params;
      return Response.json({ n: ++calls, body: ctx.body });
    },
    { idempotent: true },
  );
  const post = (
    token: string,
    body: string,
    headers: Record<string, string> = {},
  ) =>
    new Request("http://localhost/api/x", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...headers,
      },
      body,
    });

  beforeAll(async () => {
    a = await mkOrg();
    b = await mkOrg();
    orgs.push(a.orgId, b.orgId);
  });
  afterAll(async () => {
    const db = await testDb();
    for (const id of orgs) await db.from("organizations").delete().eq("id", id);
  });

  it("401 without auth", async () => {
    const res = await route(
      new Request("http://localhost/api/x", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("missing_api_key");
  });

  it("replays same key and body", async () => {
    const h = { "Idempotency-Key": "k-replay" };
    const r1 = await route(post(a.plaintext, '{"a":1}', h));
    const before = calls;
    const r2 = await route(post(a.plaintext, '{"a":1}', h));
    const first = await r1.text();
    expect(await r2.text()).toBe(first);
    expect(r2.headers.get("Idempotent-Replayed")).toBe("true");
    expect(calls).toBe(before);
    const db = await testDb();
    const { data } = await db
      .from("idempotency_keys")
      .select("response")
      .eq("org_id", a.orgId)
      .eq("key", "k-replay")
      .single();
    const stored = (data as { response: { body: string } }).response.body;
    expect(stored).not.toBe(first);
    expect(stored).toMatch(/^v\d+\./);
  });

  it("422 on same key, different body", async () => {
    const h = { "Idempotency-Key": "k-reuse" };
    await route(post(a.plaintext, '{"a":1}', h));
    const res = await route(post(a.plaintext, '{"a":2}', h));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("idempotency_key_reused");
  });

  it("does not replay an expired key", async () => {
    const db = await testDb();
    const raw = '{"a":3}';
    await db.from("idempotency_keys").insert({
      org_id: a.orgId,
      key: "k-old",
      request_hash: requestHash("POST", "/api/x", "test", raw),
      response: { status: 200, headers: {}, body: '{"n":-1}' },
      expires_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    const res = await route(
      post(a.plaintext, raw, { "Idempotency-Key": "k-old" }),
    );
    expect(res.headers.get("Idempotent-Replayed")).toBeNull();
    expect((await res.json()).n).toBeGreaterThan(0);
  });

  it("runs the handler once for concurrent same-key requests", async () => {
    const before = calls;
    const h = { "Idempotency-Key": "k-race" };
    const rs = await Promise.all([
      route(post(a.plaintext, '{"r":1}', h)),
      route(post(a.plaintext, '{"r":1}', h)),
    ]);
    expect(calls).toBe(before + 1);
    expect(rs.some((r) => r.status === 200)).toBe(true);
    for (const r of rs.filter((r) => r.status !== 200)) {
      expect(r.status).toBe(409);
      expect((await r.json()).code).toBe("idempotency_key_in_use");
    }
  });

  it("removes the reservation when the handler returns 500", async () => {
    let n = 0;
    const flaky = withApi(
      async () => {
        n++;
        return n === 1
          ? new Response("{}", { status: 500 })
          : Response.json({ ok: true });
      },
      { idempotent: true },
    );
    const h = { "Idempotency-Key": "k-500" };
    expect((await flaky(post(a.plaintext, "{}", h))).status).toBe(500);
    const res = await flaky(post(a.plaintext, "{}", h));
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });

  it("an expired reservation does not block", async () => {
    const db = await testDb();
    const raw = '{"a":4}';
    await db.from("idempotency_keys").insert({
      org_id: a.orgId,
      key: "k-stale",
      request_hash: requestHash("POST", "/api/x", "test", raw),
      response: null,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await route(
      post(a.plaintext, raw, { "Idempotency-Key": "k-stale" }),
    );
    expect(res.status).toBe(200);
  });

  it("400 on invalid JSON", async () => {
    const res = await route(post(a.plaintext, "{nope"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("exposes route params", async () => {
    await route(post(a.plaintext, "{}"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(seenParams.id).toBe("abc");
  });

  it("429 after 30 requests on free", async () => {
    for (let i = 1; i <= 30; i++) {
      const res = await route(post(b.plaintext, "{}"));
      expect(res.status).toBe(200);
      expect(res.headers.get("RateLimit-Remaining")).toBe(String(30 - i));
    }
    const res = await route(post(b.plaintext, "{}"));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("rate_limited");
    const ra = Number(res.headers.get("Retry-After"));
    expect(ra).toBeGreaterThanOrEqual(1);
    expect(ra).toBeLessThanOrEqual(60);
    expect(res.headers.get("RateLimit-Remaining")).toBe("0");
  });
});
