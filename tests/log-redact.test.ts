import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/log/logger";
import { redact } from "@/lib/log/redact";

const KEY = `pp_test_${"a".repeat(32)}`;

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("redacts nested secret keys", () => {
    expect(redact({ a: { access_token: "x" } })).toEqual({
      a: { access_token: "[redacted]" },
    });
  });
  it("redacts authorization key and bearer value", () => {
    expect(redact({ Authorization: "Bearer abc", h: "Bearer abc" })).toEqual({
      Authorization: "[redacted]",
      h: "[redacted]",
    });
  });
  it("redacts Threads tokens but not THREADS_API codes", () => {
    const tok = `THQVJ${"a1".repeat(15)}`;
    expect(redact(`bad token ${tok} here`)).toBe("bad token [redacted] here");
    expect(redact("THREADS_API__LINK_LIMIT_EXCEEDED")).toBe(
      "THREADS_API__LINK_LIMIT_EXCEEDED",
    );
  });
  it("redacts Instagram tokens but not snake_case codes", () => {
    const tok = `IGAAR${"a1".repeat(15)}`;
    expect(redact(`bad token ${tok} here`)).toBe("bad token [redacted] here");
    expect(redact("image_not_jpeg")).toBe("image_not_jpeg");
    expect(redact("IGNORE_THIS_CODE")).toBe("IGNORE_THIS_CODE");
  });
  it("handles arrays of objects", () => {
    expect(redact([{ secret: 1 }, { ok: 1 }])).toEqual([
      { secret: "[redacted]" },
      { ok: 1 },
    ]);
  });
  it("redacts token-shaped values under normal keys", () => {
    expect(redact({ note: KEY })).toEqual({ note: "[redacted]" });
    expect(
      redact({ note: `${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}` }),
    ).toEqual({
      note: "[redacted]",
    });
  });
  it("redacts secrets inside longer strings and Error text", () => {
    const tok = `EAA${"x1".repeat(20)}`;
    const msg = `401 for https://x/me?access_token=${tok}&a=1 and Bearer eyJhbGciOi.abc`;
    const out = redact(msg) as string;
    expect(out).not.toContain(tok);
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).toContain("401 for https://x/me?access_token=");
    const e = redact(new Error(msg)) as { message: string; stack: string };
    expect(e.message).not.toContain(tok);
    expect(e.stack).not.toContain(tok);
    expect(e.stack).not.toContain("eyJhbGciOi");
  });
  it("keeps normal values and does not mutate", () => {
    const input = { s: "hello", n: 3, token: "t" };
    expect(redact(input)).toEqual({ s: "hello", n: 3, token: "[redacted]" });
    expect(input.token).toBe("t");
  });
  it("keeps Error name", () => {
    expect((redact(new TypeError("boom")) as { name: string }).name).toBe(
      "TypeError",
    );
  });
});

describe("logger", () => {
  it("writes redacted JSON line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("hi", { token: KEY, user: "u1", note: KEY });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    const o = JSON.parse(line);
    expect([o.level, o.msg, o.user]).toEqual(["info", "hi", "u1"]);
    expect(line).not.toContain(KEY);
  });
  it("child warn goes to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.child({ org: "o1" }).warn("w");
    expect(JSON.parse(String(spy.mock.calls[0][0])).org).toBe("o1");
  });
});
