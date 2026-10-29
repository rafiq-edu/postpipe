import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMediaGc } from "../lib/jobs/media-gc";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("media gc", () => {
  let deletes = 0;
  const server = setupServer(
    http.delete("http://localhost:4566/*", () => {
      deletes++;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  let orgId = "";
  beforeAll(async () => {
    process.env.AWS_ENDPOINT_URL = "http://localhost:4566";
    process.env.AWS_ACCESS_KEY_ID = "test";
    process.env.AWS_SECRET_ACCESS_KEY = "test";
    process.env.MEDIA_BUCKET = "postpipe-media-local";
    server.listen();
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t10g", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    server.close();
    await (await testDb()).from("organizations").delete().eq("id", orgId);
  });

  it("deletes only eligible objects", async () => {
    const db = await testDb();
    const ago = (d: number) =>
      new Date(Date.now() - d * 86_400_000).toISOString();
    const mk = async (name: string, days: number) => {
      const { data, error } = await db
        .from("media")
        .insert({
          org_id: orgId,
          mode: "test",
          storage_path: `${orgId}/test/${name}`,
          mime: "image/png",
          bytes: 1,
          status: "uploaded",
          last_used_at: ago(days),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    };
    const a = await mk("a", 40);
    const b = await mk("b", 40);
    const c = await mk("c", 1);
    const { error } = await db.from("social_posts").insert({
      org_id: orgId,
      mode: "test",
      status: "scheduled",
      media_ids: [b],
    });
    if (error) throw error;

    const out = await runMediaGc();
    expect(out.deleted).toBe(1);
    expect(deletes).toBe(1);
    const { data } = await db.from("media").select("id").eq("org_id", orgId);
    expect(data?.map((r) => r.id).sort()).toEqual([b, c].sort());
    expect(data?.some((r) => r.id === a)).toBe(false);
  });
});
