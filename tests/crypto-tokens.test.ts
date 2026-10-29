import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";

beforeEach(() => {
  process.env.SECRETS_SOURCE = "env";
  process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
  process.env.TOKEN_KEY_V2 = randomBytes(32).toString("base64");
  process.env.CURRENT_TOKEN_KEY_VERSION = "1";
});

describe("token crypto", () => {
  it("roundtrips and has v1 + 4 base64url parts", async () => {
    const blob = await encryptToken("hello");
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob.split(".")).toHaveLength(4);
    expect(blob).toMatch(/^v1\.[\w-]+\.[\w-]*\.[\w-]+$/);
    expect(await decryptToken(blob)).toBe("hello");
  });
  it("uses a random iv", async () => {
    expect(await encryptToken("a")).not.toBe(await encryptToken("a"));
  });
  it("old v1 blob decrypts while current is v2", async () => {
    const old = await encryptToken("x");
    process.env.CURRENT_TOKEN_KEY_VERSION = "2";
    expect((await encryptToken("y")).startsWith("v2.")).toBe(true);
    expect(await decryptToken(old)).toBe("x");
  });
  it("tampered tag throws", async () => {
    const p = (await encryptToken("x")).split(".");
    p[3] = (p[3][0] === "A" ? "B" : "A") + p[3].slice(1);
    await expect(decryptToken(p.join("."))).rejects.toThrow(
      "token decrypt failed",
    );
  });
  it("unknown key version throws", async () => {
    const p = (await encryptToken("x")).split(".");
    p[0] = "v9";
    await expect(decryptToken(p.join("."))).rejects.toThrow(
      "token decrypt failed",
    );
  });
  it("short key throws", async () => {
    process.env.TOKEN_KEY_V1 = randomBytes(16).toString("base64");
    await expect(encryptToken("x")).rejects.toThrow(
      "TOKEN_KEY_V1 must be 32 bytes base64",
    );
  });
});
