import { createVerify, generateKeyPairSync } from "node:crypto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cloudfrontSignedUrl,
  getRange,
  headObject,
  presignPut,
} from "../lib/media/s3";
import { PublishError } from "../lib/platforms/types";

const data = Buffer.from("0123456789");
const server = setupServer(
  http.get("http://localhost:4566/*", ({ request }) => {
    const m = /bytes=(\d+)-(\d+)/.exec(request.headers.get("range") ?? "");
    if (!m) return new HttpResponse(data);
    return new HttpResponse(data.subarray(Number(m[1]), Number(m[2]) + 1), {
      status: 206,
    });
  }),
  http.head(
    "http://localhost:4566/*/missing",
    () => new HttpResponse(null, { status: 404 }),
  ),
);

beforeAll(() => {
  process.env.AWS_ENDPOINT_URL = "http://localhost:4566";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.MEDIA_BUCKET = "postpipe-media-local";
  server.listen();
});
afterAll(() => server.close());

describe("media s3", () => {
  it("presigns PUT with bucket and 900s expiry", async () => {
    const url = await presignPut("org/test/abc", "image/png", 10);
    expect(url).toContain("/postpipe-media-local/org/test/abc");
    expect(url).toContain("X-Amz-Expires=900");
  });

  it("getRange returns the requested slice", async () => {
    const out = await getRange("k", 2, 4);
    expect(Buffer.from(out).toString()).toBe("234");
  });

  it("headObject 404 is permanent media_unreachable", async () => {
    const e = await headObject("missing").catch((x) => x);
    expect(e).toBeInstanceOf(PublishError);
    expect(e.code).toBe("media_unreachable");
    expect(e.kind).toBe("permanent");
  });

  it("CloudFront signed URL verifies with the public key", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    process.env.CLOUDFRONT_KEY_PAIR_ID = "K2TESTKEY";
    process.env.MEDIA_CDN_HOST = "media.postpipe.com";
    process.env.SECRETS_SOURCE = "env";
    process.env.CLOUDFRONT_PRIVATE_KEY = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const base = "https://media.postpipe.com/org/test/abc";
    const signed = await cloudfrontSignedUrl(base, 60);
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    const u = new URL(signed);
    expect(u.searchParams.get("Key-Pair-Id")).toBe("K2TESTKEY");
    const expires = u.searchParams.get("Expires");
    expect(expires).toBeTruthy();
    const sig = Buffer.from(
      (u.searchParams.get("Signature") ?? "")
        .replace(/-/g, "+")
        .replace(/_/g, "=")
        .replace(/~/g, "/"),
      "base64",
    );
    const policy = `{"Statement":[{"Resource":"${base}","Condition":{"DateLessThan":{"AWS:EpochTime":${expires}}}}]}`;
    expect(createVerify("RSA-SHA1").update(policy).verify(publicKey, sig)).toBe(
      true,
    );
  });
});
