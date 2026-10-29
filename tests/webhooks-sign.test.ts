import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "../lib/webhooks/sign";

const now = 1_800_000_000;
describe("webhook signing", () => {
  const h = signWebhook("s", "{}", now);
  it("verifies", () =>
    expect(verifyWebhook("{}", h, "s", 300, now)).toBe(true));
  it("fails on changed body", () =>
    expect(verifyWebhook("{ }", h, "s", 300, now)).toBe(false));
  it("fails on wrong secret", () =>
    expect(verifyWebhook("{}", h, "x", 300, now)).toBe(false));
  it("fails on old timestamp unless tolerance is wider", () => {
    expect(verifyWebhook("{}", h, "s", 300, now + 400)).toBe(false);
    expect(verifyWebhook("{}", h, "s", 1000, now + 400)).toBe(true);
  });
  it("fails on malformed headers", () => {
    for (const bad of ["", "garbage", "t=abc,v1=zz", `t=${now}`, `v1=ab`])
      expect(verifyWebhook("{}", bad, "s", 300, now)).toBe(false);
  });
  it("accepts any matching v1", () => {
    const sig = h.split("v1=")[1];
    expect(
      verifyWebhook("{}", `t=${now},v1=00,v1=${sig},x=1`, "s", 300, now),
    ).toBe(true);
  });
});
