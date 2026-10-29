import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET, HEAD } from "../app/media/[id]/[exp]/[sig]/route";
import { signPullPath } from "../lib/media/pull-url";
import { hasDb, testDb } from "./db";

const BYTES = new Uint8Array([1, 2, 3, 4, 5]);
const h = vi.hoisted(() => ({
  stream: undefined as undefined | (() => Promise<unknown>),
  row: undefined as undefined | (() => Promise<unknown>),
}));
vi.mock("../lib/media/s3", async (orig) => {
  const real = await orig<typeof import("../lib/media/s3")>();
  return {
    ...real,
    getMediaRow: (id: string) => (h.row ? h.row() : real.getMediaRow(id)),
    getObjectStream: () =>
      h.stream
        ? h.stream()
        : Promise.resolve({ body: new Response(BYTES).body, length: 5 }),
  };
});

describe.skipIf(!hasDb)("GET /media/[id]/[exp]/[sig]", () => {
  let orgId = "";
  const ids: Record<string, string> = {};
  const row = (
    mode: "live" | "test",
    mime: string,
    status: "validated" | "uploaded",
  ) => {
    const id = randomUUID();
    return {
      id,
      org_id: orgId,
      mode,
      storage_path: `${orgId}/${mode}/${id}`,
      mime,
      bytes: BYTES.length,
      status,
    };
  };
  beforeAll(async () => {
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t28b", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    const rows = {
      ok: row("live", "image/jpeg", "validated"),
      test: row("test", "image/jpeg", "validated"),
      video: row("live", "video/mp4", "validated"),
      pending: row("live", "image/jpeg", "uploaded"),
    };
    for (const [k, r] of Object.entries(rows)) ids[k] = r.id;
    const { error: e2 } = await db.from("media").insert(Object.values(rows));
    if (e2) throw e2;
  });
  beforeEach(() => {
    process.env.SECRETS_SOURCE = "env";
    process.env.MEDIA_URL_SIGNING_KEY = "test-signing-key";
    h.stream = undefined;
    h.row = undefined;
  });
  afterAll(async () => {
    await (await testDb()).from("organizations").delete().eq("id", orgId);
  });

  const now = () => Math.floor(Date.now() / 1000);
  const call = async (path: string, fn = GET) => {
    const [id, exp, sig] = path.split("/").slice(2);
    return fn(new Request(`http://localhost${path}`), {
      params: Promise.resolve({ id, exp, sig }),
    });
  };

  it("serves the bytes with exact headers", async () => {
    const res = await call(await signPullPath(ids.ok, now() + 600));
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "image/jpeg",
      "content-length": "5",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });
  it("HEAD returns the headers and no body", async () => {
    const res = await call(await signPullPath(ids.ok, now() + 600), HEAD);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("5");
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
  it("every failure is the same 404", async () => {
    const good = await signPullPath(ids.ok, now() + 600);
    const bodies = await Promise.all(
      [
        `${good.slice(0, -2)}xx`,
        await signPullPath(ids.ok, now() - 5),
        await signPullPath(randomUUID(), now() + 600),
        await signPullPath(ids.test, now() + 600),
        await signPullPath(ids.video, now() + 600),
        await signPullPath(ids.pending, now() + 600),
      ].map(async (p) => {
        const r = await call(p);
        expect(r.status).toBe(404);
        return r.text();
      }),
    );
    expect(new Set(bodies).size).toBe(1);
  });
  it("S3 failure after a valid signature is 503 with no detail", async () => {
    h.stream = async () => {
      throw new Error("secret detail");
    };
    const res = await call(await signPullPath(ids.ok, now() + 600));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Service Unavailable");
  });
  it("a non-PublishError from the media lookup is 503", async () => {
    h.row = async () => {
      throw new Error("db down");
    };
    const res = await call(await signPullPath(ids.ok, now() + 600));
    expect(res.status).toBe(503);
  });
  it("Content-Length comes from the S3 length", async () => {
    h.stream = async () => ({ body: new Response(BYTES).body, length: 5 });
    await testDb().then((db) =>
      db.from("media").update({ bytes: 99 }).eq("id", ids.ok),
    );
    const res = await call(await signPullPath(ids.ok, now() + 600));
    expect(res.headers.get("content-length")).toBe("5");
    await res.arrayBuffer();
  });
});
