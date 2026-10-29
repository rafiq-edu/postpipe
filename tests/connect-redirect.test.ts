import { describe, expect, it } from "vitest";
import { cancelUrl, redirectUrlWith } from "../lib/connect/redirect";

describe("connect redirect urls", () => {
  it("cancel url uses status=error and reason=cancelled", () => {
    expect(cancelUrl("https://example.com/done")).toBe(
      "https://example.com/done?status=error&reason=cancelled",
    );
  });
  it("keeps an existing query string", () => {
    expect(cancelUrl("https://example.com/done?a=1")).toBe(
      "https://example.com/done?a=1&status=error&reason=cancelled",
    );
  });
  it("encodes values", () => {
    expect(redirectUrlWith("https://x.test", { a: "b c" })).toBe(
      "https://x.test/?a=b+c",
    );
  });
  it("puts params before the fragment", () => {
    expect(cancelUrl("https://app.example/back?x=1#frag")).toBe(
      "https://app.example/back?x=1&status=error&reason=cancelled#frag",
    );
  });
});
