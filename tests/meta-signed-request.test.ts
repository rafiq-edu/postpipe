import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { appSecretName, parseSignedRequest } from "../lib/meta/signed-request";

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const payload = b64(
  JSON.stringify({
    algorithm: "HMAC-SHA256",
    user_id: "123",
    issued_at: 1700000000,
  }),
);
const sign = (p: string, secret: string) =>
  createHmac("sha256", secret).update(p).digest("base64url");

test("valid signature parses", () => {
  expect(parseSignedRequest(`${sign(payload, "s")}.${payload}`, "s")).toEqual({
    user_id: "123",
    issued_at: 1700000000,
  });
});

test("tampered payload returns null", () => {
  const other = b64(
    JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: "999",
      issued_at: 1700000000,
    }),
  );
  expect(parseSignedRequest(`${sign(payload, "s")}.${other}`, "s")).toBeNull();
});

test("wrong secret and garbage return null", () => {
  expect(
    parseSignedRequest(`${sign(payload, "s")}.${payload}`, "x"),
  ).toBeNull();
  expect(parseSignedRequest("garbage", "s")).toBeNull();
  expect(parseSignedRequest("a.b.c", "s")).toBeNull();
});

test("appSecretName", () => {
  expect(appSecretName("threads")).toBe("THREADS_APP_SECRET");
  expect(appSecretName(null)).toBe("META_APP_SECRET");
});
