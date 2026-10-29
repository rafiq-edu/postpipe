import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:dns", () => ({
  promises: {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  },
}));

import { DELETE } from "../app/api/v1/webhooks/[id]/route";
import { GET, POST } from "../app/api/v1/webhooks/route";
import { generateApiKey } from "../lib/api/auth";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("/v1/webhooks", () => {
  let orgId = "";
  const keys = {} as Record<"live" | "test", string>;
  const req = (
    mode: "live" | "test",
    method: string,
    body?: unknown,
    path = "",
  ) =>
    new Request(`http://localhost/api/v1/webhooks${path}`, {
      method,
      headers: {
        authorization: `Bearer ${keys[mode]}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const payload = {
    url: "http://hooks.example.com/hook",
    events: ["social.post.created"],
  };

  beforeAll(async () => {
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t16r", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    for (const mode of ["live", "test"] as const) {
      const k = generateApiKey(mode);
      keys[mode] = k.plaintext;
      const { error: e } = await db.from("api_keys").insert({
        org_id: orgId,
        name: "t",
        key_hash: k.hash,
        key_prefix: k.prefix,
        last4: k.last4,
        mode,
      });
      if (e) throw e;
    }
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("401 without auth", async () => {
    const res = await POST(
      new Request("http://localhost/api/v1/webhooks", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("422 on invalid body", async () => {
    expect(
      (await POST(req("test", "POST", { url: "nope", events: [] }))).status,
    ).toBe(422);
  });

  it("create, list, delete", async () => {
    const res = await POST(req("test", "POST", payload));
    expect(res.status).toBe(201);
    const ep = await res.json();
    expect(ep.secret).toMatch(/^whsec_/);

    const list = await (await GET(req("test", "GET"))).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].secret).toBeUndefined();
    expect(JSON.stringify(list)).not.toMatch(/_enc/);

    const del = await DELETE(req("test", "DELETE"), {
      params: Promise.resolve({ id: ep.id }),
    });
    expect(del.status).toBe(204);
    expect((await (await GET(req("test", "GET"))).json()).data).toEqual([]);
  });

  it("422 for http url in live mode", async () => {
    expect((await POST(req("live", "POST", payload))).status).toBe(422);
  });

  it("400 for urls that are not public", async () => {
    for (const url of [
      "http://127.0.0.1/h",
      "http://169.254.169.254/h",
      "http://localhost/h",
    ]) {
      const res = await POST(req("test", "POST", { ...payload, url }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("validation_failed");
    }
  });

  it("404 for unknown id", async () => {
    const res = await DELETE(req("test", "DELETE"), {
      params: Promise.resolve({ id: crypto.randomUUID() }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });
});
