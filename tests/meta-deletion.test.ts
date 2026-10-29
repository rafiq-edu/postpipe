import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as dataDeletion } from "../app/api/meta/data-deletion/route";
import { POST as deauthorize } from "../app/api/meta/deauthorize/route";
import { getDeletionRequest } from "../lib/meta/deletion";
import { hasDb, testDb } from "./db";

const SECRET = "test-secret";
const uid = `meta-${randomBytes(6).toString("hex")}`;
const payload = Buffer.from(
  JSON.stringify({ algorithm: "HMAC-SHA256", user_id: uid, issued_at: 1 }),
).toString("base64url");
const signed = `${createHmac("sha256", SECRET).update(payload).digest("base64url")}.${payload}`;
const call = (h: typeof dataDeletion) =>
  h(
    new Request("http://localhost/api/meta", {
      method: "POST",
      body: new URLSearchParams({ signed_request: signed }),
    }),
  );

describe.skipIf(!hasDb)("meta callbacks", () => {
  let orgId = "";
  const codes: string[] = [];
  const statuses = async (db: Awaited<ReturnType<typeof testDb>>) => {
    const { data } = await db
      .from("social_accounts")
      .select("platform, status")
      .eq("org_id", orgId);
    return Object.fromEntries((data ?? []).map((r) => [r.platform, r.status]));
  };

  beforeAll(async () => {
    process.env.META_APP_SECRET = SECRET;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const db = await testDb();
    const { data: org, error } = await db
      .from("organizations")
      .insert({ name: "t5-test" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = org.id;
    const { error: e2 } = await db.from("social_accounts").insert(
      ["instagram", "facebook", "threads", "bluesky"].map((platform) => ({
        org_id: orgId,
        mode: "test",
        platform,
        external_id: `${platform}-${uid}`,
        platform_user_id: uid,
      })),
    );
    if (e2) throw e2;
  });

  afterAll(async () => {
    const db = await testDb();
    if (codes.length)
      await db
        .from("meta_deletion_requests")
        .delete()
        .in("confirmation_code", codes);
    if (orgId) await db.from("organizations").delete().eq("id", orgId);
  });

  test("deauthorize revokes meta rows only", async () => {
    const res = await call(deauthorize);
    expect(res.status).toBe(200);
    expect(await statuses(await testDb())).toEqual({
      instagram: "revoked",
      facebook: "revoked",
      threads: "revoked",
      bluesky: "connected",
    });
  });

  test("data deletion removes meta rows and records request", async () => {
    const res = await call(dataDeletion);
    expect(res.status).toBe(200);
    const body = await res.json();
    codes.push(body.confirmation_code);
    expect(body.confirmation_code).toMatch(/^[0-9a-f]{16}$/);
    expect(body.url).toBe(
      `http://localhost:3000/data-deletion?code=${body.confirmation_code}`,
    );
    const db = await testDb();
    expect(await statuses(db)).toEqual({ bluesky: "connected" });
    expect((await getDeletionRequest(db, body.confirmation_code))?.status).toBe(
      "completed",
    );
  });

  test("bad signature is 400", async () => {
    const res = await dataDeletion(
      new Request("http://localhost/api/meta", {
        method: "POST",
        body: new URLSearchParams({ signed_request: "x.y" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
