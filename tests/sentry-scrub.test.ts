import { describe, expect, it } from "vitest";
import { scrubEvent } from "../lib/observability/sentry";

describe("scrubEvent", () => {
  it("removes headers, cookies, body and query, keeps the rest", () => {
    const out = scrubEvent({
      type: undefined,
      message: "boom",
      request: {
        url: "https://x.test/api/v1/posts",
        method: "POST",
        headers: { authorization: "Bearer pp_live_x" },
        cookies: { sb: "1" },
        data: { token: "t" },
        query_string: "a=b",
      },
      breadcrumbs: [
        {
          category: "http",
          data: { url: "https://graph.x/me?access_token=t" },
        },
      ],
    });
    expect(out.request).toEqual({
      url: "https://x.test/api/v1/posts",
      method: "POST",
    });
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.message).toBe("boom");
  });
  it("accepts an event without a request", () => {
    expect(scrubEvent({ type: undefined, message: "m" })).toEqual({
      type: undefined,
      message: "m",
    });
  });
});
