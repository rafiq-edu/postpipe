import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { API_KEY_RE, authenticate, generateApiKey } from "../lib/api/auth";
import { ApiError } from "../lib/api/errors";

const noop = async () => {};
const req = (key?: string) =>
  new Request("http://x", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
const testKey = generateApiKey("test").plaintext;
const row = (o: object = {}) => ({
  id: "k1",
  org_id: "o1",
  mode: "test" as const,
  revoked_at: null,
  ...o,
});
const rejects = async (p: Promise<unknown>, code: string) => {
  const e = (await p.catch((x) => x)) as ApiError;
  expect(e).toBeInstanceOf(ApiError);
  expect(e.status).toBe(401);
  expect(e.code).toBe(code);
};

test("generateApiKey format and hash", () => {
  const k = generateApiKey("live");
  expect(k.plaintext).toMatch(API_KEY_RE);
  expect(k.plaintext.startsWith("pp_live_")).toBe(true);
  expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(k.hash).toBe(createHash("sha256").update(k.plaintext).digest("hex"));
  expect(k.last4).toBe(k.plaintext.slice(-4));
});

test("authenticate rejects", async () => {
  await rejects(
    authenticate(req(), async () => null, noop),
    "missing_api_key",
  );
  await rejects(
    authenticate(req(testKey), async () => row({ revoked_at: "now" }), noop),
    "invalid_api_key",
  );
  await rejects(
    authenticate(req(testKey), async () => null, noop),
    "invalid_api_key",
  );
  await rejects(
    authenticate(req(testKey), async () => row({ mode: "live" }), noop),
    "invalid_api_key",
  );
});

test("authenticate resolves", async () => {
  expect(await authenticate(req(testKey), async () => row(), noop)).toEqual({
    orgId: "o1",
    apiKeyId: "k1",
    mode: "test",
  });
});
