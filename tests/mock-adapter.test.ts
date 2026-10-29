import { describe, expect, it } from "vitest";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import type {
  PlatformAdapter,
  PublishInput,
  PublishState,
  RuleViolation,
} from "../lib/platforms/types";

// The mock validates synchronously; the interface also allows a promise.
const a = mockAdapter as Omit<PlatformAdapter, "validatePost"> & {
  validatePost(i: PublishInput): RuleViolation[];
};
const input = (caption: string, config: PublishInput["config"] = {}) =>
  ({
    caption,
    media: [],
    config,
    account: { platformUserId: "u", platformData: {} },
  }) satisfies PublishInput;
const start: PublishState = { stage: "start", data: {} };
const tokens = { accessToken: "t", scopes: [] };
const step = (s: PublishState, i: PublishInput) =>
  a.publishStep(s, i, tokens, async () => new Uint8Array());
const media = (mime: string, durationMs?: number) => ({
  mediaId: "m",
  signedUrl: "https://x",
  mime,
  bytes: 1,
  durationMs,
});

describe("mock adapter", () => {
  it("validatePost", () => {
    expect(a.validatePost(input("x".repeat(501))).map((v) => v.code)).toEqual([
      "caption_too_long",
    ]);
    expect(
      a
        .validatePost({
          ...input("hi"),
          media: Array.from({ length: 5 }, () => media("image/png")),
        })
        .map((v) => v.code),
    ).toEqual(["too_many_media"]);
    const v = a.validatePost({
      ...input("hi"),
      media: [media("video/mp4", 121_000)],
    });
    expect(v[0]).toMatchObject({ code: "video_too_long", field: "media[0]" });
    expect(
      a.validatePost({
        ...input("x".repeat(100)),
        media: [media("image/png")],
      }),
    ).toEqual([]);
  });

  it("success and hasUrl", async () => {
    const o = await step(start, input("see https://a.b"));
    if (!("result" in o) || !o.result.ok) throw new Error("expected success");
    expect(o.result.platformPostId).toMatch(/^mock-/);
    expect(o.result.meta?.hasUrl).toBe(true);
  });

  it("failures", async () => {
    const err = async (c: string, cfg = {}) => {
      const o = await step(start, input(c, cfg));
      if (!("result" in o) || o.result.ok) throw new Error("expected failure");
      return o.result.error;
    };
    expect((await err("FAIL_RETRYABLE")).kind).toBe("retryable");
    expect((await err("RETRY_AFTER_10M")).retryAfterMs).toBe(600000);
    expect((await err("FAIL_AUTH")).kind).toBe("auth");
    const c = await err("hi", { fail: true });
    expect([c.kind, c.code]).toEqual(["permanent", "mock_config_fail"]);
  });

  it("SLOW_30S waits once", async () => {
    const o = await step(start, input("SLOW_30S"));
    expect(o).toMatchObject({ waitMs: 30000, next: { stage: "waiting" } });
    const o2 = await step({ stage: "waiting", data: {} }, input("SLOW_30S"));
    expect("result" in o2 && o2.result.ok).toBe(true);
  });

  it("MULTI_STEP", async () => {
    const i = input("MULTI_STEP");
    const a1 = await step(start, i);
    expect(a1).toMatchObject({ next: { stage: "uploaded" } });
    const a2 = await step({ stage: "uploaded", data: {} }, i);
    expect(a2).toMatchObject({ next: { stage: "finalizing" } });
    const a3 = await step({ stage: "finalizing", data: {} }, i);
    expect("result" in a3 && a3.result.ok).toBe(true);
  });

  it("oauth", async () => {
    await expect(
      a.exchangeCode({ code: "bad", redirectUri: "x" }),
    ).rejects.toThrow();
    const { url } = await a.getAuthUrl({
      state: "s",
      redirectUri: "http://h/cb",
      platformData: { user_id: "alice" },
    });
    expect(url).toContain("code=mock.alice");
  });
});
