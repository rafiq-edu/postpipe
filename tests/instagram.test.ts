import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  fetchPublishingUsage,
  instagramAdapter,
} from "../lib/platforms/instagram/adapter";
import longToken from "../lib/platforms/instagram/fixtures/long-token.json";
import profile from "../lib/platforms/instagram/fixtures/profile.json";
import token from "../lib/platforms/instagram/fixtures/token.json";
import { validatePost } from "../lib/platforms/instagram/rules";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import type {
  MediaInfo,
  PublishInput,
  PublishState,
  TokenSet,
} from "../lib/platforms/types";
import {
  precheck,
  quotaScope,
  recordReportedUsage,
  utcDay,
} from "../lib/publish/quotas";
import { tokenNeedsRefresh } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

const G = "https://graph.instagram.com";
const A = `${G}/v26.0`;
const seen: { forms: URLSearchParams[]; urls: URL[] } = { forms: [], urls: [] };
let statuses: Record<string, unknown>[] = [];
let n = 0;

const server = setupServer(
  http.post(
    "https://api.instagram.com/oauth/access_token",
    async ({ request }) => {
      seen.forms.push(new URLSearchParams(await request.text()));
      return HttpResponse.json(token);
    },
  ),
  http.get(`${G}/access_token`, ({ request }) => {
    seen.urls.push(new URL(request.url));
    return HttpResponse.json(longToken);
  }),
  http.get(`${G}/refresh_access_token`, ({ request }) => {
    seen.urls.push(new URL(request.url));
    return HttpResponse.json({ access_token: "long-2", expires_in: 5183944 });
  }),
  http.get(`${A}/me`, () => HttpResponse.json(profile)),
  http.post(`${A}/:uid/media`, async ({ request }) => {
    seen.forms.push(new URLSearchParams(await request.text()));
    return HttpResponse.json({ id: `c${++n}` });
  }),
  http.post(`${A}/:uid/media_publish`, async ({ request }) => {
    seen.forms.push(new URLSearchParams(await request.text()));
    return HttpResponse.json({ id: "post-1" });
  }),
  http.get(`${A}/:uid/content_publishing_limit`, ({ request }) => {
    seen.urls.push(new URL(request.url));
    return HttpResponse.json({
      data: [{ quota_usage: 7, config: { quota_total: 50 } }],
    });
  }),
  http.get(`${A}/post-1`, () =>
    HttpResponse.json({ permalink: "https://www.instagram.com/p/abc/" }),
  ),
  http.get(`${A}/:cid`, () =>
    HttpResponse.json(statuses.shift() ?? { status_code: "FINISHED" }),
  ),
);
beforeAll(() => {
  server.listen();
});
beforeEach(() => {
  process.env.INSTAGRAM_APP_ID = "iid";
  process.env.INSTAGRAM_APP_SECRET = "isecret";
  process.env.SECRETS_SOURCE = "env";
});
afterEach(() => {
  server.resetHandlers();
  seen.forms = [];
  seen.urls = [];
  statuses = [];
  n = 0;
});
afterAll(() => server.close());

const tokens: TokenSet = { accessToken: "at-0", scopes: [] };
const start: PublishState = { stage: "start", data: {} };
const input = (o: Partial<PublishInput> = {}): PublishInput => ({
  caption: "hello",
  media: [],
  config: {},
  account: { platformUserId: "1234", platformData: {} },
  ...o,
});
const media = (
  mime: string,
  bytes: number,
  extra: Partial<MediaInfo> = {},
): MediaInfo => ({
  mediaId: "m1",
  signedUrl: "https://example.com/m?sig=abc",
  mime,
  bytes,
  ...extra,
});
const jpg = media("image/jpeg", 10);
const mp4 = media("video/mp4", 10);
const noRange = async () => new Uint8Array();
const codes = (i: PublishInput) => validatePost(i).map((v) => v.code);
const step = (s: PublishState, i: PublishInput, t = tokens) =>
  instagramAdapter.publishStep(s, i, t, noRange);

async function run(i: PublishInput) {
  const stages: string[] = [];
  const waits: (number | undefined)[] = [];
  let state = start;
  for (let k = 0; k < 40; k++) {
    const out = await step(state, i);
    if ("result" in out) return { out, stages, waits };
    stages.push(out.next.stage);
    waits.push(out.waitMs);
    const j = JSON.stringify(out.next);
    expect(j).not.toContain("at-0");
    expect(j).not.toContain("sig=abc"); // signed media URL stays out of state
    state = out.next;
  }
  throw new Error("no result");
}

describe("instagram rules", () => {
  it("PNG rejected image_not_jpeg, JPEG passes", () => {
    expect(codes(input({ media: [media("image/png", 10)] }))).toContain(
      "image_not_jpeg",
    );
    expect(codes(input({ media: [jpg] }))).toEqual([]);
  });
  it("2200 characters pass, 2201 fail", () => {
    expect(codes(input({ caption: "a".repeat(2200), media: [jpg] }))).toEqual(
      [],
    );
    expect(codes(input({ caption: "a".repeat(2201), media: [jpg] }))).toContain(
      "caption_too_long",
    );
  });
  it("30 hashtags pass, 31 fail", () => {
    const tags = (k: number) =>
      Array.from({ length: k }, (_, x) => `#t${x}`).join(" ");
    expect(codes(input({ caption: tags(30), media: [jpg] }))).toEqual([]);
    expect(codes(input({ caption: tags(31), media: [jpg] }))).toContain(
      "too_many_hashtags",
    );
  });
  it("21 carousel items rejected, 20 pass", () => {
    expect(codes(input({ media: Array(21).fill(jpg) }))).toContain(
      "too_many_media",
    );
    expect(codes(input({ media: Array(20).fill(jpg) }))).toEqual([]);
  });
  it("media rules: image 8 MB, Reel 300 MB and duration, Story, no media", () => {
    expect(codes(input({ media: [media("image/jpeg", 8_000_001)] }))).toContain(
      "image_too_large",
    );
    expect(
      codes(input({ media: [media("video/mp4", 300_000_001)] })),
    ).toContain("video_too_large");
    expect(codes(input({ media: [media("video/mp4", 300_000_000)] }))).toEqual(
      [],
    );
    expect(
      codes(input({ media: [media("video/mp4", 10, { durationMs: 2_000 })] })),
    ).toContain("video_duration");
    const story = (m: MediaInfo) =>
      codes(input({ media: [m], config: { media_type: "STORIES" } }));
    expect(story(media("video/mp4", 100_000_001))).toContain("video_too_large");
    expect(story(media("video/mp4", 10, { durationMs: 61_000 }))).toContain(
      "video_duration",
    );
    expect(story(jpg)).toEqual([]);
    expect(codes(input({ media: [media("video/avi", 10)] }))).toContain(
      "unsupported_media",
    );
    expect(codes(input())).toContain("media_required");
    expect(
      codes(input({ media: [jpg], config: { media_type: "REELS" } })),
    ).toContain("config_media_mismatch");
    expect(
      codes(input({ media: [jpg, jpg], config: { media_type: "STORIES" } })),
    ).toContain("config_media_mismatch");
  });
  it("config schema is strict", () => {
    expect(
      instagramAdapter.configSchema.safeParse({ media_type: "REELS" }).success,
    ).toBe(true);
    expect(instagramAdapter.configSchema.safeParse({ x: 1 }).success).toBe(
      false,
    );
  });
});

describe("instagram publish", () => {
  it("image: create, poll, publish, permalink; signed url goes only to Instagram", async () => {
    statuses = [{ status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }];
    const { out, stages, waits } = await run(input({ media: [jpg] }));
    expect(stages).toEqual(["status", "status", "publish"]);
    expect(waits[0]).toBe(60_000);
    expect(seen.forms[0]?.get("image_url")).toBe(
      "https://example.com/m?sig=abc",
    );
    expect(seen.forms[0]?.has("media_type")).toBe(false);
    expect(seen.forms[0]?.get("caption")).toBe("hello");
    expect(seen.forms[0]?.get("access_token")).toBe("at-0");
    expect(seen.forms[1]?.get("creation_id")).toBe("c1");
    expect("result" in out && out.result.ok && out.result.platformPostUrl).toBe(
      "https://www.instagram.com/p/abc/",
    );
  });
  it("Reel: media_type REELS with video_url", async () => {
    const { out } = await run(input({ media: [mp4] }));
    expect(seen.forms[0]?.get("media_type")).toBe("REELS");
    expect(seen.forms[0]?.get("video_url")).toBe(
      "https://example.com/m?sig=abc",
    );
    expect("result" in out && out.result.ok).toBe(true);
  });
  it("story: media_type STORIES for image and video", async () => {
    await run(input({ media: [jpg], config: { media_type: "STORIES" } }));
    expect(seen.forms[0]?.get("media_type")).toBe("STORIES");
    expect(seen.forms[0]?.get("image_url")).toBeTruthy();
    seen.forms = [];
    await run(input({ media: [mp4], config: { media_type: "STORIES" } }));
    expect(seen.forms[0]?.get("media_type")).toBe("STORIES");
    expect(seen.forms[0]?.get("video_url")).toBeTruthy();
  });
  it("carousel: children one per step, video child polled, parent, poll, publish", async () => {
    const a = { ...jpg, altText: "first" };
    const { stages } = await run(input({ media: [a, mp4, a] }));
    expect(stages).toEqual([
      "child",
      "child",
      "child",
      "child_status",
      "parent",
      "status",
      "publish",
    ]);
    expect(
      seen.forms.slice(0, 3).map((f) => f.get("is_carousel_item")),
    ).toEqual(["true", "true", "true"]);
    expect(seen.forms[1]?.get("media_type")).toBe("VIDEO");
    expect(seen.forms[0]?.get("alt_text")).toBe("first");
    expect(seen.forms[0]?.has("caption")).toBe(false);
    expect(seen.forms[3]?.get("media_type")).toBe("CAROUSEL");
    expect(seen.forms[3]?.get("children")).toBe("c1,c2,c3");
    expect(seen.forms[3]?.get("caption")).toBe("hello");
    expect(seen.forms[4]?.get("creation_id")).toBe("c4");
  });
  it("carousel: video child ERROR is permanent, parent never created", async () => {
    statuses = [{ status_code: "ERROR" }];
    const err = await run(input({ media: [mp4, jpg] })).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["media_failed", "permanent"]);
    expect(seen.forms.some((f) => f.get("media_type") === "CAROUSEL")).toBe(
      false,
    );
  });
  it("PUBLISHED container is post_outcome_unknown, media_publish never called", async () => {
    statuses = [{ status_code: "PUBLISHED" }];
    const err = await run(input({ media: [jpg] })).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
    expect(seen.forms.some((f) => f.has("creation_id"))).toBe(false);
  });
  it("ERROR is permanent with a capped, redacted message", async () => {
    statuses = [
      {
        status_code: "ERROR",
        status: `Error: bad Bearer abcdef123456 ${"x".repeat(400)}`,
      },
    ];
    const err = await run(input({ media: [jpg] })).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["media_failed", "permanent"]);
    expect(err.message).not.toContain("abcdef123456");
    expect(err.message.length).toBeLessThan(400);
  });
  it("ERROR text: URLs are replaced before redact and cap", async () => {
    statuses = [
      {
        status_code: "ERROR",
        status:
          "bad media at https://cdn.example.com/m.jpg?X-Amz-Signature=abc123 end",
      },
    ];
    const err = await run(input({ media: [jpg] })).catch((e) => e);
    expect(err.message).toContain("[url]");
    expect(err.message).not.toContain("X-Amz-Signature");
  });
  it("media_publish 200 with an unparsable body is post_outcome_unknown", async () => {
    server.use(
      http.post(`${A}/:uid/media_publish`, () => new HttpResponse("not json")),
    );
    const err = await step(
      { stage: "publish", data: { creation_id: "c1" } },
      input(),
    ).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
  });
  it("EXPIRED is retryable and a new attempt creates a fresh container", async () => {
    statuses = [{ status_code: "EXPIRED" }];
    const i = input({ media: [jpg] });
    const err = await run(i).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["container_expired", "retryable"]);
    const first = seen.forms.length;
    await run(i); // retry starts from a clean state
    expect(seen.forms.length).toBeGreaterThan(first);
    expect(seen.forms[first]?.has("image_url")).toBe(true);
  });
  it("poll: poll_until set on first poll, timeout past it", async () => {
    statuses = [{ status_code: "IN_PROGRESS" }];
    const s = { stage: "status", data: { creation_id: "c1" } };
    const i = input({ media: [jpg] });
    const out = await step(s, i);
    const left = Date.parse(
      "next" in out ? String(out.next.data.poll_until) : "",
    );
    expect(left - Date.now()).toBeGreaterThan(4 * 60_000);
    const err = await step(
      { ...s, data: { ...s.data, poll_until: "2000-01-01T00:00:00.000Z" } },
      i,
    ).catch((e) => e);
    expect([err.code, err.kind]).toEqual([
      "media_processing_timeout",
      "permanent",
    ]);
  });
  it("publish with empty creation_id is bad_state", async () => {
    const err = await step({ stage: "publish", data: {} }, input()).catch(
      (e) => e,
    );
    expect(err.code).toBe("bad_state");
  });
  it("lost response or 503 on publish is post_outcome_unknown; 429 retryable", async () => {
    const p = { stage: "publish", data: { creation_id: "c1" } };
    server.use(
      http.post(`${A}/:uid/media_publish`, () => HttpResponse.error()),
    );
    let err = await step(p, input()).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
    server.use(
      http.post(
        `${A}/:uid/media_publish`,
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    err = await step(p, input()).catch((e) => e);
    expect(err.code).toBe("post_outcome_unknown");
    server.use(
      http.post(
        `${A}/:uid/media_publish`,
        () => new HttpResponse(null, { status: 429 }),
      ),
    );
    err = await step(p, input()).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["rate_limited", "retryable"]);
  });
  it("HTTP errors: fixed messages, 401 and code 190 auth, rate codes retryable", async () => {
    const fail = async (status: number, body: unknown) => {
      server.use(
        http.post(`${A}/:uid/media`, () =>
          HttpResponse.json(body as object, { status }),
        ),
      );
      return step(start, input({ media: [jpg] })).catch((e) => e);
    };
    let err = await fail(422, { error: { message: "secret text" } });
    expect(err.code).toBe("http_422");
    expect(err.message).not.toContain("secret");
    err = await fail(400, { error: { code: 190 } });
    expect([err.code, err.kind]).toEqual(["account_reauth_required", "auth"]);
    err = await fail(401, {});
    expect([err.code, err.kind]).toEqual(["account_reauth_required", "auth"]);
    err = await fail(400, { error: { code: 80002 } });
    expect([err.code, err.kind]).toEqual(["rate_limited", "retryable"]);
  });
  it("expired token maps to account_reauth_required", async () => {
    const err = await step(start, input({ media: [jpg] }), {
      ...tokens,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["account_reauth_required", "auth"]);
  });
});

describe("instagram oauth", () => {
  it("auth url, exchange to long-lived, refresh, profile", async () => {
    const { url } = await instagramAdapter.getAuthUrl({
      state: "s",
      redirectUri: "https://x/cb",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://www.instagram.com/oauth/authorize",
    );
    expect(u.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_content_publish",
    );
    expect(u.searchParams.get("client_id")).toBe("iid");
    const t = await instagramAdapter.exchangeCode({
      code: "c#_",
      redirectUri: "https://x/cb",
    });
    expect(seen.forms[0]?.get("code")).toBe("c");
    expect(seen.forms[0]?.get("client_secret")).toBe("isecret");
    expect(seen.urls[0]?.searchParams.get("grant_type")).toBe(
      "ig_exchange_token",
    );
    expect(seen.urls[0]?.searchParams.get("access_token")).toBe("short-1");
    expect(t.accessToken).toBe("long-1");
    expect(Date.parse(t.expiresAt ?? "") - Date.now()).toBeGreaterThan(
      5_000_000_000,
    );
    const r = await instagramAdapter.refreshToken(t);
    expect(seen.urls[1]?.searchParams.get("grant_type")).toBe(
      "ig_refresh_token",
    );
    expect(r.accessToken).toBe("long-2");
    expect((await instagramAdapter.getProfile(r)).platformUserId).toBe("1234");
    await instagramAdapter.revoke(r);
  });
  it("accepts the data-array token response", async () => {
    server.use(
      http.post("https://api.instagram.com/oauth/access_token", () =>
        HttpResponse.json({ data: [{ access_token: "short-9", user_id: 1 }] }),
      ),
    );
    await instagramAdapter.exchangeCode({
      code: "c",
      redirectUri: "https://x/cb",
    });
    expect(seen.urls[0]?.searchParams.get("access_token")).toBe("short-9");
  });
});

describe("instagram refresh window", () => {
  const now = new Date("2026-10-29T00:00:00Z");
  const at = (ms: number) => ({
    ...tokens,
    expiresAt: new Date(now.getTime() + ms).toISOString(),
  });
  const day = 24 * 3_600_000;
  it("refreshes under 7 days, not at 8", () => {
    expect(tokenNeedsRefresh(instagramAdapter, at(6 * day), now)).toBe(true);
    expect(tokenNeedsRefresh(instagramAdapter, at(8 * day), now)).toBe(false);
    expect(tokenNeedsRefresh(mockAdapter, at(6 * day), now)).toBe(false);
  });
});

describe("instagram reported usage", () => {
  it("reads content_publishing_limit", async () => {
    const r = await fetchPublishingUsage(tokens, "1234");
    expect(r).toEqual({ used: 7, total: 50 });
    expect(seen.urls[0]?.searchParams.get("fields")).toBe("quota_usage,config");
  });
});

describe.skipIf(!hasDb)("instagram quota", () => {
  const acc = crypto.randomUUID();
  const scope = `account:${acc}`;
  it("51st post gets daily_quota_reached; reported usage raises, never lowers", async () => {
    const db = await testDb();
    const day = utcDay(new Date());
    await db.from("platform_quotas").delete().eq("scope", scope);
    expect(quotaScope(instagramAdapter, acc)).toBe(scope);
    expect(await precheck(instagramAdapter, acc, null)).toEqual({ ok: true });
    await recordReportedUsage(scope, day, 50);
    const r = await precheck(instagramAdapter, acc, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.code).toBe("daily_quota_reached");
    await recordReportedUsage(scope, day, 10);
    const row = await db
      .from("platform_quotas")
      .select("count")
      .eq("scope", scope)
      .eq("day", day)
      .single();
    expect(row.data?.count).toBe(50);
    await db.from("platform_quotas").delete().eq("scope", scope);
  });
});
