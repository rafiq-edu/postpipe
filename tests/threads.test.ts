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
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { threadsAdapter } from "../lib/platforms/threads/adapter";
import longToken from "../lib/platforms/threads/fixtures/long-token.json";
import profile from "../lib/platforms/threads/fixtures/profile.json";
import token from "../lib/platforms/threads/fixtures/token.json";
import { validatePost } from "../lib/platforms/threads/rules";
import type {
  MediaInfo,
  PublishInput,
  PublishState,
  TokenSet,
} from "../lib/platforms/types";
import { precheck, utcDay } from "../lib/publish/quotas";
import { tokenNeedsRefresh } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

const G = "https://graph.threads.com";
const A = `${G}/v1.0`;
const seen: {
  forms: URLSearchParams[];
  urls: URL[];
  auth: (string | null)[];
} = { forms: [], urls: [], auth: [] };
let statuses: Record<string, unknown>[] = [];
let n = 0;

const server = setupServer(
  http.post(`${G}/oauth/access_token`, async ({ request }) => {
    seen.forms.push(new URLSearchParams(await request.text()));
    return HttpResponse.json(token);
  }),
  http.get(`${G}/access_token`, ({ request }) => {
    seen.urls.push(new URL(request.url));
    return HttpResponse.json(longToken);
  }),
  http.get(`${G}/refresh_access_token`, ({ request }) => {
    seen.urls.push(new URL(request.url));
    return HttpResponse.json({ access_token: "long-2", expires_in: 5183944 });
  }),
  http.get(`${A}/me`, () => HttpResponse.json(profile)),
  http.post(`${A}/:uid/threads`, async ({ request }) => {
    seen.auth.push(request.headers.get("authorization"));
    seen.forms.push(new URLSearchParams(await request.text()));
    return HttpResponse.json({ id: `c${++n}` });
  }),
  http.post(`${A}/:uid/threads_publish`, async ({ request }) => {
    seen.forms.push(new URLSearchParams(await request.text()));
    return HttpResponse.json({ id: "post-1" });
  }),
  http.get(`${A}/post-1`, () =>
    HttpResponse.json({ permalink: "https://www.threads.com/@alice/post/abc" }),
  ),
  http.get(`${A}/:cid`, () =>
    HttpResponse.json(statuses.shift() ?? { status: "FINISHED" }),
  ),
);
beforeAll(() => {
  server.listen();
});
beforeEach(() => {
  process.env.THREADS_APP_ID = "tid";
  process.env.THREADS_APP_SECRET = "tsecret";
  process.env.SECRETS_SOURCE = "env";
});
afterEach(() => {
  server.resetHandlers();
  seen.forms = [];
  seen.urls = [];
  seen.auth = [];
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
  signedUrl: "https://example.com/m",
  mime,
  bytes,
  ...extra,
});
const noRange = async () => new Uint8Array();
const codes = (i: PublishInput) => validatePost(i).map((v) => v.code);
const step = (s: PublishState, i: PublishInput, t = tokens) =>
  threadsAdapter.publishStep(s, i, t, noRange);

async function run(i: PublishInput) {
  const stages: string[] = [];
  const waits: (number | undefined)[] = [];
  let state = start;
  for (let k = 0; k < 40; k++) {
    const out = await step(state, i);
    if ("result" in out) return { out, stages, waits };
    stages.push(out.next.stage);
    waits.push(out.waitMs);
    expect(JSON.stringify(out.next)).not.toContain("at-0");
    state = out.next;
  }
  throw new Error("no result");
}

const family = "👨‍👩‍👧‍👧"; // 25 UTF-8 bytes

describe("threads rules", () => {
  it("500 passes and 501 fails", () => {
    expect(codes(input({ caption: "a".repeat(500) }))).toEqual([]);
    expect(codes(input({ caption: "a".repeat(501) }))).toContain(
      "caption_too_long",
    );
  });
  it("emoji count by UTF-8 bytes (joined sequence is one unit of 25)", () => {
    expect(codes(input({ caption: family + "a".repeat(475) }))).toEqual([]);
    expect(codes(input({ caption: family + "a".repeat(476) }))).toContain(
      "caption_too_long",
    );
    expect(codes(input({ caption: "😀".repeat(125) }))).toEqual([]);
    expect(codes(input({ caption: "😀".repeat(126) }))).toContain(
      "caption_too_long",
    );
  });
  it("5 unique links pass, 6 fail, repeats count once", () => {
    const l = (k: number) =>
      Array.from({ length: k }, (_, x) => `https://e.com/${x}`).join(" ");
    expect(codes(input({ caption: l(5) }))).toEqual([]);
    expect(codes(input({ caption: l(6) }))).toContain("too_many_links");
    expect(codes(input({ caption: `${l(5)} ${l(5)}` }))).toEqual([]);
    // trailing slash is the same link; an upper-case scheme is still found
    expect(
      codes(
        input({
          caption:
            "https://e.com/a https://e.com/a/ https://e.com/b https://e.com/c https://e.com/d https://e.com/e",
        }),
      ),
    ).toEqual([]);
    expect(
      codes(
        input({
          caption: `${l(5)} HTTPS://e.com/zz`,
        }),
      ),
    ).toContain("too_many_links");
  });
  it("21 carousel items rejected, 20 pass", () => {
    const img = media("image/jpeg", 10);
    expect(codes(input({ media: Array(21).fill(img) }))).toContain(
      "too_many_media",
    );
    expect(codes(input({ media: Array(20).fill(img) }))).toEqual([]);
  });
  it("media rules", () => {
    const img = media("image/png", 10);
    expect(codes(input({ media: [media("image/png", 8_000_001)] }))).toContain(
      "image_too_large",
    );
    expect(codes(input({ media: [media("image/png", 8_000_000)] }))).toEqual(
      [],
    );
    expect(codes(input({ media: [media("image/gif", 10)] }))).toContain(
      "unsupported_media",
    );
    expect(codes(input({ media: [{ ...img, width: 200 }] }))).toContain(
      "image_dimensions",
    );
    expect(
      codes(
        input({ media: [media("video/mp4", 10, { durationMs: 300_001 })] }),
      ),
    ).toContain("video_too_long");
    expect(
      codes(input({ media: [media("video/mp4", 1_000_000_001)] })),
    ).toContain("video_too_large");
    const alt = (n: number) =>
      codes(input({ media: [{ ...img, altText: "a".repeat(n) }] }));
    expect(alt(1000)).toEqual([]);
    expect(alt(1001)).toContain("alt_text_too_long");
    expect(codes(input({ caption: " " }))).toContain("caption_required");
    expect(codes(input({ caption: " ", media: [img] }))).toEqual([]);
  });
});

describe("threads publish", () => {
  it("text: create, publish, permalink; token in the body only", async () => {
    const { out, stages } = await run(
      input({ config: { reply_control: "everyone" } }),
    );
    expect(stages).toEqual(["publish"]);
    expect("result" in out && out.result.ok && out.result.platformPostUrl).toBe(
      "https://www.threads.com/@alice/post/abc",
    );
    expect(seen.forms[0]?.get("media_type")).toBe("TEXT");
    expect(seen.forms[0]?.get("reply_control")).toBe("everyone");
    expect(seen.forms[0]?.get("access_token")).toBe("at-0");
    expect(seen.forms[1]?.get("creation_id")).toBe("c1");
  });
  it("IN_PROGRESS then FINISHED publishes; image waits 30000", async () => {
    statuses = [{ status: "IN_PROGRESS" }, { status: "FINISHED" }];
    const { out, stages, waits } = await run(
      input({ media: [media("image/png", 10)] }),
    );
    expect(stages).toEqual(["status", "status", "publish"]);
    expect(waits[0]).toBe(30_000);
    expect(seen.forms[0]?.get("media_type")).toBe("IMAGE");
    expect(seen.forms[0]?.get("image_url")).toBe("https://example.com/m");
    expect("result" in out && out.result.ok).toBe(true);
  });
  it("carousel: children one per step, then parent, poll, publish", async () => {
    const a = { ...media("image/png", 10), altText: "first" };
    const { stages, waits } = await run(
      input({ media: [a, media("video/mp4", 10), a] }),
    );
    expect(stages).toEqual([
      "child",
      "child",
      "child",
      "child_status",
      "parent",
      "status",
      "publish",
    ]);
    expect(waits[3]).toBe(30_000);
    expect(waits[5]).toBe(30_000);
    expect(
      seen.forms.slice(0, 3).map((f) => f.get("is_carousel_item")),
    ).toEqual(["true", "true", "true"]);
    expect(seen.forms[1]?.get("media_type")).toBe("VIDEO");
    expect(seen.forms[0]?.get("alt_text")).toBe("first");
    expect(seen.forms[3]?.get("media_type")).toBe("CAROUSEL");
    expect(seen.forms[3]?.get("children")).toBe("c1,c2,c3");
    expect(seen.forms[4]?.get("creation_id")).toBe("c4");
  });
  it("carousel: video child polled until FINISHED before the parent", async () => {
    statuses = [{ status: "IN_PROGRESS" }, { status: "FINISHED" }];
    const { stages } = await run(
      input({ media: [media("video/mp4", 10), media("image/png", 10)] }),
    );
    expect(stages).toEqual([
      "child",
      "child",
      "child_status",
      "child_status",
      "parent",
      "status",
      "publish",
    ]);
  });
  it("carousel: video child ERROR is permanent and the parent is never created", async () => {
    statuses = [{ status: "ERROR", error_message: "INVALID_DURATION" }];
    const err = await run(
      input({ media: [media("video/mp4", 10), media("image/png", 10)] }),
    ).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["media_failed", "permanent"]);
    expect(seen.forms.some((f) => f.get("media_type") === "CAROUSEL")).toBe(
      false,
    );
  });
  it("PUBLISHED container is post_outcome_unknown, publish is never called", async () => {
    statuses = [{ status: "PUBLISHED" }];
    const err = await run(input({ media: [media("image/png", 10)] })).catch(
      (e) => e,
    );
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
    expect(seen.forms.some((f) => f.has("creation_id"))).toBe(false);
  });
  it("publish with an empty creation_id is bad_state", async () => {
    const err = await step({ stage: "publish", data: {} }, input()).catch(
      (e) => e,
    );
    expect(err.code).toBe("bad_state");
  });
  it("ERROR is permanent with a capped, redacted platform message", async () => {
    statuses = [
      {
        status: "ERROR",
        error_message: `INVALID_DURATION Bearer abcdef123456 ${"x".repeat(400)}`,
      },
    ];
    const err = await run(input({ media: [media("image/png", 10)] })).catch(
      (e) => e,
    );
    expect([err.code, err.kind]).toEqual(["media_failed", "permanent"]);
    expect(err.message).toContain("INVALID_DURATION");
    expect(err.message).not.toContain("abcdef123456");
    expect(err.message.length).toBeLessThan(400);
  });
  it("ERROR text: URLs are replaced before redact and cap", async () => {
    statuses = [
      {
        status: "ERROR",
        error_message:
          "bad media at https://cdn.example.com/m.jpg?X-Amz-Signature=abc123 end",
      },
    ];
    const err = await run(input({ media: [media("image/png", 10)] })).catch(
      (e) => e,
    );
    expect(err.message).toContain("[url]");
    expect(err.message).not.toContain("X-Amz-Signature");
  });
  it("threads_publish 200 with an unparsable body is post_outcome_unknown", async () => {
    server.use(
      http.post(
        `${A}/:uid/threads_publish`,
        () => new HttpResponse("not json"),
      ),
    );
    const err = await step(
      { stage: "publish", data: { creation_id: "c1" } },
      input(),
    ).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
  });
  it("EXPIRED container is retryable", async () => {
    statuses = [{ status: "EXPIRED" }];
    const err = await run(input({ media: [media("image/png", 10)] })).catch(
      (e) => e,
    );
    expect([err.code, err.kind]).toEqual(["container_expired", "retryable"]);
  });
  it("poll: poll_until set on first poll, timeout past it", async () => {
    statuses = [{ status: "IN_PROGRESS" }];
    const s = { stage: "status", data: { creation_id: "c1" } };
    const i = input({ media: [media("image/png", 10)] });
    const out = await step(s, i);
    expect("next" in out && out.next.data.poll_until).toEqual(
      expect.any(String),
    );
    const left = Date.parse(
      "next" in out ? String(out.next.data.poll_until) : "",
    );
    expect(left - Date.now()).toBeGreaterThan(4 * 60_000);
    const err = await step(
      {
        ...s,
        data: { ...s.data, poll_until: "2000-01-01T00:00:00.000Z" },
      },
      i,
    ).catch((e) => e);
    expect([err.code, err.kind]).toEqual([
      "media_processing_timeout",
      "permanent",
    ]);
  });
  it("lost response or 503 on publish is post_outcome_unknown; 429 retryable", async () => {
    const p = { stage: "publish", data: { creation_id: "c1" } };
    server.use(
      http.post(`${A}/:uid/threads_publish`, () => HttpResponse.error()),
    );
    let err = await step(p, input()).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
    server.use(
      http.post(
        `${A}/:uid/threads_publish`,
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    err = await step(p, input()).catch((e) => e);
    expect(err.code).toBe("post_outcome_unknown");
    server.use(
      http.post(
        `${A}/:uid/threads_publish`,
        () => new HttpResponse(null, { status: 429 }),
      ),
    );
    err = await step(p, input()).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["rate_limited", "retryable"]);
  });
  it("HTTP errors: fixed messages, 401 auth, link limit code", async () => {
    server.use(
      http.post(`${A}/:uid/threads`, () =>
        HttpResponse.json(
          { error: { message: "secret text" } },
          { status: 422 },
        ),
      ),
    );
    let err = await step(start, input()).catch((e) => e);
    expect(err.code).toBe("http_422");
    expect(err.message).not.toContain("secret");
    server.use(
      http.post(`${A}/:uid/threads`, () =>
        HttpResponse.json(
          { error: { code: "THREADS_API__LINK_LIMIT_EXCEEDED" } },
          { status: 400 },
        ),
      ),
    );
    err = await step(start, input()).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["too_many_links", "permanent"]);
    server.use(
      http.post(
        `${A}/:uid/threads`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    err = await step(start, input()).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["account_reauth_required", "auth"]);
  });
  it("expired token maps to account_reauth_required", async () => {
    const err = await step(start, input(), {
      ...tokens,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["account_reauth_required", "auth"]);
  });
});

describe("threads oauth", () => {
  it("auth url, exchange to long-lived, refresh, profile", async () => {
    const { url } = await threadsAdapter.getAuthUrl({
      state: "s",
      redirectUri: "https://x/cb",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://threads.com/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe(
      "threads_basic,threads_content_publish",
    );
    expect(u.searchParams.get("client_id")).toBe("tid");
    const t = await threadsAdapter.exchangeCode({
      code: "c#_",
      redirectUri: "https://x/cb",
    });
    expect(seen.forms[0]?.get("code")).toBe("c");
    expect(seen.forms[0]?.get("client_secret")).toBe("tsecret");
    expect(seen.urls[0]?.searchParams.get("grant_type")).toBe(
      "th_exchange_token",
    );
    expect(seen.urls[0]?.searchParams.get("access_token")).toBe("short-1");
    expect(t.accessToken).toBe("long-1");
    expect(Date.parse(t.expiresAt ?? "") - Date.now()).toBeGreaterThan(
      5_000_000_000,
    );
    const r = await threadsAdapter.refreshToken(t);
    expect(seen.urls[1]?.searchParams.get("grant_type")).toBe(
      "th_refresh_token",
    );
    expect(r.accessToken).toBe("long-2");
    expect((await threadsAdapter.getProfile(r)).platformUserId).toBe("1234");
    await threadsAdapter.revoke(r);
  });
});

describe("threads refresh window", () => {
  const now = new Date("2026-10-29T00:00:00Z");
  const at = (ms: number) => ({
    ...tokens,
    expiresAt: new Date(now.getTime() + ms).toISOString(),
  });
  const day = 24 * 3_600_000;
  it("refreshes under 7 days, not at 8; others keep 10 minutes", () => {
    expect(tokenNeedsRefresh(threadsAdapter, at(6 * day), now)).toBe(true);
    expect(tokenNeedsRefresh(threadsAdapter, at(8 * day), now)).toBe(false);
    expect(tokenNeedsRefresh(mockAdapter, at(6 * day), now)).toBe(false);
    expect(tokenNeedsRefresh(mockAdapter, at(5 * 60_000), now)).toBe(true);
    expect(tokenNeedsRefresh(threadsAdapter, tokens, now)).toBe(false);
  });
});

describe.skipIf(!hasDb)("threads quota", () => {
  const acc = crypto.randomUUID();
  const scope = `account:${acc}`;
  it("251st post gets daily_quota_reached", async () => {
    const db = await testDb();
    await db.from("platform_quotas").delete().eq("scope", scope);
    expect(await precheck(threadsAdapter, acc, null)).toEqual({ ok: true });
    const { error } = await db
      .from("platform_quotas")
      .insert({ scope, day: utcDay(new Date()), count: 250 });
    if (error) throw error;
    const r = await precheck(threadsAdapter, acc, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.code).toBe("daily_quota_reached");
    await db.from("platform_quotas").delete().eq("scope", scope);
  });
});
