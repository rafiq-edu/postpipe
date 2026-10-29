import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "../app/api/v1/media/create-upload-url/route";
import { generateApiKey } from "../lib/api/auth";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("POST /api/v1/media/create-upload-url", () => {
  let orgId = "";
  let token = "";
  beforeAll(async () => {
    process.env.AWS_ENDPOINT_URL = "http://localhost:4566";
    process.env.AWS_ACCESS_KEY_ID = "test";
    process.env.AWS_SECRET_ACCESS_KEY = "test";
    process.env.MEDIA_BUCKET = "postpipe-media-local";
    process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
    const db = await testDb();
    const { data: org, error } = await db
      .from("organizations")
      .insert({ name: "t10r", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = org.id;
    const k = generateApiKey("test");
    const { error: e2 } = await db.from("api_keys").insert({
      org_id: orgId,
      name: "t",
      key_hash: k.hash,
      key_prefix: k.prefix,
      last4: k.last4,
      mode: "test",
    });
    if (e2) throw e2;
    token = k.plaintext;
  });
  afterAll(async () => {
    await (await testDb()).from("organizations").delete().eq("id", orgId);
  });

  const call = (body: unknown, auth = true) =>
    POST(
      new Request("http://localhost/api/v1/media/create-upload-url", {
        method: "POST",
        headers: {
          ...(auth ? { authorization: `Bearer ${token}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );

  it("returns an upload URL", async () => {
    const res = await call({ mime: "image/png", bytes: 1234 });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.media_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(j.upload_url).toContain("postpipe-media-local");
    expect(j.upload_url).toContain("X-Amz-Expires=900");
    expect(j.media_url.endsWith(`/media/${j.media_id}`)).toBe(true);
  });

  it("422 when bytes is too large", async () => {
    const res = await call({ mime: "image/png", bytes: 2_000_000_000 });
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.code).toBe("validation_failed");
    expect(j.errors[0].path).toBe("bytes");
  });

  it("422 for a non-media mime", async () => {
    expect((await call({ mime: "text/plain", bytes: 1 })).status).toBe(422);
  });

  it("401 without auth", async () => {
    expect((await call({ mime: "image/png", bytes: 1 }, false)).status).toBe(
      401,
    );
  });
});
