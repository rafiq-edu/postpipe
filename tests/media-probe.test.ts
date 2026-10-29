import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findMoovInTail,
  parseDimensions,
  parseMp4Duration,
  probeMedia,
} from "../lib/media/probe";
import { hasDb, testDb } from "./db";
import { jpeg, mp4, png } from "./fixtures/media";

describe("probe parsers", () => {
  it("reads JPEG and PNG dimensions", () => {
    expect(parseDimensions("image/jpeg", jpeg(6, 4))).toEqual({
      width: 6,
      height: 4,
    });
    expect(parseDimensions("image/png", png(2, 3))).toEqual({
      width: 2,
      height: 3,
    });
  });

  it("reads MP4 duration with moov first", () => {
    const f = mp4({
      timescaleMs: 1000,
      durationMs: 2500,
      moovAtEnd: false,
      mdatBytes: 100,
    });
    expect(parseMp4Duration(f)).toBe(2500);
  });

  it("reads MP4 duration with moov at the end via the tail chunk", () => {
    const f = mp4({
      timescaleMs: 1000,
      durationMs: 2500,
      moovAtEnd: true,
      mdatBytes: 1_500_000,
    });
    expect(parseMp4Duration(f.subarray(0, 1_048_576))).toBeUndefined();
    expect(findMoovInTail(f.subarray(f.length - 1_048_576))).toBe(2500);
  });
});

describe.skipIf(!hasDb)("probeMedia", () => {
  const body = png(2, 3);
  const server = setupServer(
    http.head(
      "http://localhost:4566/*",
      () =>
        new HttpResponse(null, {
          headers: {
            "content-length": String(body.length),
            "content-type": "image/png",
          },
        }),
    ),
    http.get(
      "http://localhost:4566/*",
      () => new HttpResponse(body, { status: 206 }),
    ),
  );
  let orgId = "";
  beforeAll(async () => {
    process.env.AWS_ENDPOINT_URL = "http://localhost:4566";
    process.env.AWS_ACCESS_KEY_ID = "test";
    process.env.AWS_SECRET_ACCESS_KEY = "test";
    process.env.MEDIA_BUCKET = "postpipe-media-local";
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    server.listen();
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t10p", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    server.close();
    await (await testDb()).from("organizations").delete().eq("id", orgId);
  });

  it("validates the row and returns a signed URL", async () => {
    const db = await testDb();
    const { data, error } = await db
      .from("media")
      .insert({
        org_id: orgId,
        mode: "test",
        storage_path: `${orgId}/test/x`,
        mime: "image/png",
        bytes: body.length,
        status: "uploaded",
      })
      .select("id")
      .single();
    if (error) throw error;
    const info = await probeMedia(data.id);
    expect(
      info.signedUrl.startsWith("http://localhost:4566/postpipe-media-local/"),
    ).toBe(true);
    const { data: row } = await db
      .from("media")
      .select("*")
      .eq("id", data.id)
      .single();
    expect(row?.status).toBe("validated");
    expect([row?.width, row?.height]).toEqual([2, 3]);
  });
});
