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
import { verifyPull } from "../lib/media/pull-url";
import { tiktokAdapter } from "../lib/platforms/tiktok/adapter";
import creator from "../lib/platforms/tiktok/fixtures/creator_info.json";
import token from "../lib/platforms/tiktok/fixtures/token.json";
import user from "../lib/platforms/tiktok/fixtures/user.json";
import {
  chunkPlan,
  chunkRange,
  TIKTOK_LIMITS,
  validatePost,
} from "../lib/platforms/tiktok/rules";
import type {
  MediaInfo,
  PublishError,
  PublishInput,
  PublishState,
  TokenSet,
} from "../lib/platforms/types";

const API = "https://open.tiktokapis.com";
const UP = "https://open-upload.tiktokapis.com/video/?upload_id=u1";
const MIB = 1024 * 1024;

let calls: { url: string; body: unknown; auth: string | null }[] = [];
let replies: Record<string, (() => Response)[]> = {};
let puts: { range: string | null; auth: string | null }[] = [];
let putReplies: (() => Response | Promise<Response>)[] = [];
const reply = (path: string, r: () => Response) =>
  (replies[path] = [...(replies[path] ?? []), r]);
const ok = (data: unknown) =>
  HttpResponse.json({ data, error: { code: "ok", message: "" } });

const server = setupServer(
  http.post(`${API}/*`, async ({ request }) => {
    const path = new URL(request.url).pathname;
    const text = await request.text();
    calls.push({
      url: path,
      body: text.startsWith("{") ? JSON.parse(text) : text,
      auth: request.headers.get("authorization"),
    });
    return (
      replies[path]?.shift() ?? (() => HttpResponse.json({}, { status: 500 }))
    )();
  }),
  http.get(`${API}/v2/user/info/`, () => HttpResponse.json(user)),
  http.put("https://open-upload.tiktokapis.com/video/", async ({ request }) => {
    puts.push({
      range: request.headers.get("content-range"),
      auth: request.headers.get("authorization"),
    });
    return (
      putReplies.shift() ?? (() => new HttpResponse(null, { status: 206 }))
    )();
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  process.env.TIKTOK_CLIENT_KEY = "ckey";
  process.env.TIKTOK_CLIENT_SECRET = "csecret";
  process.env.SECRETS_SOURCE = "env";
  process.env.MEDIA_URL_SIGNING_KEY = "test-signing-key";
  delete process.env.TIKTOK_MEDIA_URL_BASE;
});
afterEach(() => {
  server.resetHandlers();
  calls = [];
  replies = {};
  puts = [];
  putReplies = [];
});
afterAll(() => server.close());

const PULL_RE =
  /^https:\/\/media\.example\.test\/media\/(p1)\/(\d+)\/([A-Za-z0-9_-]+)$/;

const media = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  mediaId: "m1",
  signedUrl: "https://s3.example.test/m1?sig=secret",
  mime: "video/mp4",
  bytes: 25 * MIB,
  durationMs: 60_000,
  ...over,
});
const input = (
  config: PublishInput["config"] = {},
  m: MediaInfo[] = [media()],
): PublishInput => ({
  caption: "hello",
  media: m,
  config: {
    privacy_level: "SELF_ONLY",
    brand_content_toggle: false,
    brand_organic_toggle: false,
    ...config,
  },
  account: { platformUserId: "open-1", platformData: {} },
});
const tok: TokenSet = { accessToken: "act.secret-token", scopes: [] };
const range = async (_id: string, s: number, e: number) =>
  new Uint8Array(e - s + 1);
const step = (state: PublishState, i = input()) =>
  tiktokAdapter.publishStep(state, i, tok, range);
const fails = async (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected a PublishError");
    },
    (e) => e as PublishError,
  );
const start: PublishState = { stage: "creator_info", data: {} };
const upState = (index: number, restarts = 0): PublishState => ({
  stage: "upload",
  data: { publish_id: "pub-1", upload_url: UP, index, restarts },
});
const statusState = (extra: Record<string, string> = {}): PublishState => ({
  stage: "status",
  data: {
    publish_id: "pub-1",
    poll_until: new Date(Date.now() + 60_000).toISOString(),
    ...extra,
  },
});

describe("tiktok rules", () => {
  it("rejects a direct post without privacy_level", async () => {
    const i = input();
    delete i.config.privacy_level;
    expect((await validatePost(i)).map((v) => v.code)).toEqual([
      "privacy_level_required",
    ]);
  });
  it("requires both commercial content flags for a direct post only", async () => {
    const i = input();
    delete i.config.brand_content_toggle;
    delete i.config.brand_organic_toggle;
    expect((await validatePost(i)).map((v) => v.code)).toEqual([
      "commercial_content_required",
      "commercial_content_required",
    ]);
    expect(
      await validatePost({ ...i, config: { post_mode: "MEDIA_UPLOAD" } }),
    ).toEqual([]);
  });
  it("rejects branded content that is private", async () => {
    const v = await validatePost(input({ brand_content_toggle: true }));
    expect(v.map((x) => x.code)).toEqual(["branded_content_not_private"]);
  });
  it("rejects a video over 10 minutes", async () => {
    const v = await validatePost(input({}, [media({ durationMs: 600_001 })]));
    expect(v.map((x) => x.code)).toEqual(["video_too_long"]);
  });
  it("rejects photo posts while TIKTOK_MEDIA_URL_BASE is unset, accepts them when set", async () => {
    const photos = [
      media({ mime: "image/jpeg", bytes: 1000, durationMs: undefined }),
    ];
    expect((await validatePost(input({}, photos))).map((v) => v.code)).toEqual([
      "tiktok_photo_unavailable",
    ]);
    process.env.TIKTOK_MEDIA_URL_BASE = "https://media.example.test";
    expect(await validatePost(input({}, photos))).toEqual([]);
  });
});

describe("tiktok chunk plan", () => {
  it("70 MiB = 7 chunks of 10 MiB, in order, no gaps", () => {
    const size = 70 * MIB;
    const p = chunkPlan(size);
    expect(p).toEqual({ chunkSize: 10 * MIB, count: 7 });
    let next = 0;
    for (let n = 0; n < p.count; n++) {
      const r = chunkRange(size, p, n);
      expect(r.start).toBe(next);
      next = r.end + 1;
    }
    expect(next).toBe(size);
  });
  it("the final chunk takes the remainder and stays within the doc's limits", () => {
    const size = 70_000_000;
    const p = chunkPlan(size);
    expect(p.count).toBe(Math.floor(size / p.chunkSize));
    const last = chunkRange(size, p, p.count - 1);
    expect(last.last).toBe(true);
    expect(last.end - last.start + 1).toBeLessThanOrEqual(
      TIKTOK_LIMITS.finalChunkMax,
    );
    expect(p.chunkSize).toBeGreaterThanOrEqual(TIKTOK_LIMITS.chunkMin);
    expect(p.chunkSize).toBeLessThanOrEqual(TIKTOK_LIMITS.chunkMax);
  });
  it("a file under one chunk goes whole", () => {
    expect(chunkPlan(3 * MIB)).toEqual({ chunkSize: 3 * MIB, count: 1 });
    expect(chunkPlan(10 * MIB - 1).count).toBe(1);
  });
});

describe("tiktok creator_info stage", () => {
  it("rejects a video longer than max_video_post_duration_sec", async () => {
    reply("/v2/post/publish/creator_info/query/", () =>
      HttpResponse.json(creator),
    );
    const e = await fails(
      step(start, input({}, [media({ durationMs: 301_000 })])),
    );
    expect(e).toMatchObject({ code: "video_too_long", kind: "permanent" });
    expect(calls[0].auth).toBe("Bearer act.secret-token");
  });
  it("rejects a privacy level the creator does not offer", async () => {
    reply("/v2/post/publish/creator_info/query/", () =>
      HttpResponse.json(creator),
    );
    const e = await fails(
      step(start, input({ privacy_level: "FOLLOWER_OF_CREATOR" })),
    );
    expect(e).toMatchObject({
      code: "privacy_level_option_mismatch",
      kind: "permanent",
    });
  });
  it("refuses to enable an interaction the creator disabled", async () => {
    reply("/v2/post/publish/creator_info/query/", () =>
      HttpResponse.json(creator),
    );
    const e = await fails(step(start, input({ disable_duet: false })));
    expect(e).toMatchObject({ code: "interaction_disabled_by_creator" });
  });
  it("moves to init and forces disabled interactions off", async () => {
    reply("/v2/post/publish/creator_info/query/", () =>
      HttpResponse.json(creator),
    );
    const out = await step(start);
    expect(out).toMatchObject({
      next: {
        stage: "init",
        data: {
          disable_comment: false,
          disable_duet: true,
          disable_stitch: false,
        },
      },
    });
  });
  it("spam_risk_too_many_posts inside a 200 reply is permanent", async () => {
    reply("/v2/post/publish/creator_info/query/", () =>
      HttpResponse.json({
        data: {},
        error: { code: "spam_risk_too_many_posts", message: "limit" },
      }),
    );
    const e = await fails(step(start));
    expect(e).toMatchObject({
      code: "spam_risk_too_many_posts",
      kind: "permanent",
    });
  });
});

describe("tiktok init stage", () => {
  const initState = (): PublishState => ({
    stage: "init",
    data: {
      disable_comment: false,
      disable_duet: true,
      disable_stitch: false,
      restarts: 0,
    },
  });
  it("direct video: sends the plan and returns the upload state and publish id", async () => {
    reply("/v2/post/publish/video/init/", () =>
      ok({ publish_id: "pub-1", upload_url: UP }),
    );
    const out = await step(initState());
    expect(calls[0].body).toMatchObject({
      post_info: {
        title: "hello",
        privacy_level: "SELF_ONLY",
        disable_duet: true,
        brand_content_toggle: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: 25 * MIB,
        chunk_size: 10 * MIB,
        total_chunk_count: 2,
      },
    });
    expect(out).toMatchObject({
      platformPublishId: "pub-1",
      next: {
        stage: "upload",
        data: { publish_id: "pub-1", upload_url: UP, index: 0 },
      },
    });
  });
  it("inbox video uses the inbox endpoint", async () => {
    reply("/v2/post/publish/inbox/video/init/", () =>
      ok({ publish_id: "pub-1", upload_url: UP }),
    );
    await step(initState(), input({ post_mode: "MEDIA_UPLOAD" }));
    expect(calls[0].url).toBe("/v2/post/publish/inbox/video/init/");
  });
  it("refuses an upload URL on a foreign host and never sends to it", async () => {
    reply("/v2/post/publish/video/init/", () =>
      ok({
        publish_id: "pub-1",
        upload_url: "https://evil.example.test/video/?x=1",
      }),
    );
    const e = await fails(step(initState()));
    expect(e).toMatchObject({ code: "bad_upload_url", kind: "permanent" });
    expect(e.message).not.toContain("evil");
  });
  it("refuses a stored upload URL on a foreign host before any PUT", async () => {
    const s = upState(0);
    s.data.upload_url = "https://evil.example.test/video/";
    const e = await fails(step(s));
    expect(e).toMatchObject({ code: "bad_state" });
    expect(puts).toHaveLength(0);
  });
  it("photo post pulls from the verified domain and goes straight to status", async () => {
    process.env.TIKTOK_MEDIA_URL_BASE = "https://media.example.test/";
    reply("/v2/post/publish/content/init/", () => ok({ publish_id: "pub-2" }));
    const photos = [
      media({
        mediaId: "p1",
        mime: "image/jpeg",
        bytes: 1000,
        durationMs: undefined,
      }),
    ];
    const out = await step(initState(), input({}, photos));
    expect(calls[0].body).toMatchObject({
      media_type: "PHOTO",
      post_mode: "DIRECT_POST",
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: [expect.stringMatching(PULL_RE)],
      },
    });
    const [, id, exp, sig] = (
      (calls[0].body as { source_info: { photo_images: string[] } }).source_info
        .photo_images[0] as string
    ).match(PULL_RE) as RegExpMatchArray;
    expect(await verifyPull(id, exp, sig, Math.floor(Date.now() / 1000))).toBe(
      true,
    );
    expect(out).toMatchObject({
      platformPublishId: "pub-2",
      next: { stage: "status" },
    });
  });
  it("photo post without the media domain is refused", async () => {
    const photos = [media({ mime: "image/jpeg", bytes: 1000 })];
    const e = await fails(step(initState(), input({}, photos)));
    expect(e).toMatchObject({
      code: "tiktok_photo_unavailable",
      kind: "permanent",
    });
  });
});

describe("tiktok upload stage", () => {
  it("sends one chunk per call with the doc's headers and no token", async () => {
    const out = await step(upState(0));
    expect(puts).toEqual([
      { range: `bytes 0-${10 * MIB - 1}/${25 * MIB}`, auth: null },
    ]);
    expect(out).toMatchObject({
      next: { stage: "upload", data: { index: 1 } },
    });
  });
  it("the last chunk (25 MiB = 2 chunks, second takes 15 MiB) leads to status", async () => {
    const out = await step(upState(1));
    expect(puts[0].range).toBe(`bytes ${10 * MIB}-${25 * MIB - 1}/${25 * MIB}`);
    expect(out).toMatchObject({
      next: { stage: "status", data: { publish_id: "pub-1" } },
    });
  });
  it("a 5xx on a middle chunk starts a new init", async () => {
    putReplies.push(() => new HttpResponse(null, { status: 503 }));
    const out = await step(upState(0));
    expect(out).toMatchObject({
      next: { stage: "init", data: { restarts: 1 } },
    });
  });
  it("a lost middle chunk gives up retryable after the restart cap", async () => {
    putReplies.push(() => HttpResponse.error());
    const e = await fails(step(upState(0, TIKTOK_LIMITS.maxRestarts)));
    expect(e).toMatchObject({ code: "network_error", kind: "retryable" });
  });
  it("a lost final chunk is post_outcome_unknown (permanent)", async () => {
    putReplies.push(() => HttpResponse.error());
    const e = await fails(step(upState(1)));
    expect(e).toMatchObject({
      code: "post_outcome_unknown",
      kind: "permanent",
    });
  });
  it("a 5xx or 4xx on the final chunk is post_outcome_unknown too", async () => {
    putReplies.push(() => new HttpResponse(null, { status: 502 }));
    expect(await fails(step(upState(1)))).toMatchObject({
      code: "post_outcome_unknown",
    });
    putReplies.push(() => new HttpResponse(null, { status: 400 }));
    expect(await fails(step(upState(1)))).toMatchObject({
      code: "post_outcome_unknown",
    });
  });
  it("a 4xx on a middle chunk fails permanent", async () => {
    putReplies.push(() => new HttpResponse(null, { status: 400 }));
    expect(await fails(step(upState(0)))).toMatchObject({
      code: "http_400",
      kind: "permanent",
    });
  });
});

describe("tiktok status stage", () => {
  const S = "/v2/post/publish/status/fetch/";
  it("a 503, 429 or lost status call keeps the same state and waits (no second post)", async () => {
    const s = statusState();
    reply(S, () => HttpResponse.json({}, { status: 503 }));
    expect(await step(s)).toMatchObject({
      next: { stage: "status", data: { publish_id: "pub-1" } },
      waitMs: TIKTOK_LIMITS.statusWaitMs,
    });
    reply(S, () =>
      HttpResponse.json({}, { status: 429, headers: { "retry-after": "7" } }),
    );
    expect(await step(s)).toMatchObject({
      next: { stage: "status" },
      waitMs: 7000,
    });
    reply(S, () => HttpResponse.error());
    expect(await step(s)).toMatchObject({ next: { stage: "status" } });
  });
  it("a permanent status error still throws", async () => {
    reply(S, () => HttpResponse.json({}, { status: 400 }));
    expect(await fails(step(statusState()))).toMatchObject({
      kind: "permanent",
    });
  });
  it("an unsafe or oversized post id is ignored (placeholder path)", async () => {
    reply(
      S,
      () =>
        new HttpResponse(
          '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7123456789012345678]},"error":{"code":"ok"}}',
          {
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const out = await step(statusState());
    expect("result" in out).toBe(false);
    reply(S, () =>
      ok({
        status: "PUBLISH_COMPLETE",
        publicaly_available_post_id: ["9".repeat(65)],
      }),
    );
    expect("result" in (await step(statusState()))).toBe(false);
  });
  it("keeps polling while processing", async () => {
    reply(S, () => ok({ status: "PROCESSING_UPLOAD" }));
    const out = await step(statusState());
    expect(out).toMatchObject({
      next: { stage: "status" },
      waitMs: TIKTOK_LIMITS.statusWaitMs,
    });
    expect(calls[0].body).toEqual({ publish_id: "pub-1" });
  });
  it("PUBLISH_COMPLETE with a post id settles success", async () => {
    reply(S, () =>
      ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] }),
    );
    expect(await step(statusState())).toEqual({
      result: { ok: true, platformPostId: "7123" },
    });
  });
  it("PUBLISH_COMPLETE without an id waits and stores the first-complete time", async () => {
    reply(S, () => ok({ status: "PUBLISH_COMPLETE" }));
    const out = await step(statusState());
    expect(out).toMatchObject({
      next: { data: { complete_at: expect.any(String) } },
      waitMs: TIKTOK_LIMITS.statusWaitMs,
    });
    expect("result" in out).toBe(false);
  });
  it("settles without the post id 10 minutes after the first complete", async () => {
    reply(S, () => ok({ status: "PUBLISH_COMPLETE" }));
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    expect(await step(statusState({ complete_at: old }))).toEqual({
      result: { ok: true, platformPostId: "pub-1" },
    });
  });
  it("inbox mode settles at SEND_TO_USER_INBOX", async () => {
    reply(S, () => ok({ status: "SEND_TO_USER_INBOX" }));
    const out = await step(statusState(), input({ post_mode: "MEDIA_UPLOAD" }));
    expect(out).toMatchObject({ result: { ok: true } });
  });
  it("FAILED gives a permanent error with the allowlisted reason only", async () => {
    reply(S, () =>
      ok({ status: "FAILED", fail_reason: "duration_check_failed" }),
    );
    expect(await fails(step(statusState()))).toMatchObject({
      code: "duration_check_failed",
      kind: "permanent",
    });
    reply(S, () =>
      ok({ status: "FAILED", fail_reason: "https://x.example/leak" }),
    );
    const e = await fails(step(statusState()));
    expect(e).toMatchObject({ code: "publish_failed" });
    expect(e.message).not.toContain("leak");
  });
  it("FAILED internal retries; auth_removed is an auth error", async () => {
    reply(S, () => ok({ status: "FAILED", fail_reason: "internal" }));
    expect(await fails(step(statusState()))).toMatchObject({
      kind: "retryable",
    });
    reply(S, () => ok({ status: "FAILED", fail_reason: "auth_removed" }));
    expect(await fails(step(statusState()))).toMatchObject({ kind: "auth" });
  });
  it("times out after poll_until", async () => {
    const s = statusState({ poll_until: "2020-01-01T00:00:00Z" });
    expect(await fails(step(s))).toMatchObject({
      code: "media_processing_timeout",
      kind: "permanent",
    });
  });
});

describe("tiktok errors", () => {
  // creator_info is not a polling stage, so a retryable error is thrown there.
  const C = "/v2/post/publish/creator_info/query/";
  const S = "/v2/post/publish/status/fetch/";
  const body = (code: string, message = "m") => ({
    data: {},
    error: { code, message },
  });
  it("spam_risk_too_many_posts (403) is permanent", async () => {
    reply(S, () =>
      HttpResponse.json(body("spam_risk_too_many_posts"), { status: 403 }),
    );
    expect(await fails(step(statusState()))).toMatchObject({
      code: "spam_risk_too_many_posts",
      kind: "permanent",
    });
  });
  it("rate_limit_exceeded (429) is retryable with Retry-After", async () => {
    reply(C, () =>
      HttpResponse.json(body("rate_limit_exceeded"), {
        status: 429,
        headers: { "retry-after": "7" },
      }),
    );
    expect(await fails(step(start))).toMatchObject({
      kind: "retryable",
      retryAfterMs: 7000,
    });
  });
  it("access_token_invalid (401) is auth", async () => {
    reply(S, () =>
      HttpResponse.json(body("access_token_invalid"), { status: 401 }),
    );
    expect(await fails(step(statusState()))).toMatchObject({
      code: "account_reauth_required",
      kind: "auth",
    });
  });
  it("5xx is retryable; an unknown code is http_<status>; text is cleaned", async () => {
    reply(C, () => HttpResponse.json({}, { status: 503 }));
    expect(await fails(step(start))).toMatchObject({
      code: "http_503",
      kind: "retryable",
    });
    reply(S, () =>
      HttpResponse.json(
        body(
          "weird_new_code",
          `see https://x.example/p?token=abc ${"z".repeat(400)}`,
        ),
        { status: 400 },
      ),
    );
    const e = await fails(step(statusState()));
    expect(e.code).toBe("http_400");
    expect(e.message).toContain("[url]");
    expect(e.message).not.toContain("x.example");
    expect(e.message.length).toBeLessThan(400);
  });
});

describe("tiktok oauth", () => {
  it("builds the authorize URL with comma scopes and no PKCE", async () => {
    const { url } = await tiktokAdapter.getAuthUrl({
      state: "st",
      redirectUri: "https://app.example.test/cb",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://www.tiktok.com/v2/auth/authorize/",
    );
    expect(u.searchParams.get("client_key")).toBe("ckey");
    expect(u.searchParams.get("scope")).toBe(
      "user.info.basic,video.publish,video.upload",
    );
    expect(u.searchParams.has("code_challenge")).toBe(false);
  });
  it("exchanges a code and reads both expiries", async () => {
    reply("/v2/oauth/token/", () => HttpResponse.json(token));
    const t = await tiktokAdapter.exchangeCode({
      code: "c",
      redirectUri: "https://app.example.test/cb",
    });
    expect(calls[0].body).toContain("grant_type=authorization_code");
    expect(t.accessToken).toBe("act.fake-access");
    expect(t.scopes).toEqual([
      "user.info.basic",
      "video.publish",
      "video.upload",
    ]);
    expect(
      Date.parse(t.refreshExpiresAt as string) - Date.now(),
    ).toBeGreaterThan(364 * 86_400_000);
    expect(Date.parse(t.expiresAt as string) - Date.now()).toBeLessThanOrEqual(
      86_400_000,
    );
  });
  it("keeps the rotated refresh token, or the old one when none comes back", async () => {
    reply("/v2/oauth/token/", () => HttpResponse.json(token));
    const t = await tiktokAdapter.refreshToken({
      accessToken: "a",
      refreshToken: "old",
      scopes: ["x"],
    });
    expect(t.refreshToken).toBe("rft.fake-refresh-2");
    reply("/v2/oauth/token/", () =>
      HttpResponse.json({ access_token: "n", expires_in: 10 }),
    );
    const u = await tiktokAdapter.refreshToken({
      accessToken: "a",
      refreshToken: "old",
      scopes: ["x"],
    });
    expect(u.refreshToken).toBe("old");
  });
  it("a dead refresh token is an auth error", async () => {
    reply("/v2/oauth/token/", () =>
      HttpResponse.json(
        { error: "invalid_grant", error_description: "bad" },
        { status: 400 },
      ),
    );
    expect(
      await fails(
        tiktokAdapter.refreshToken({
          accessToken: "a",
          refreshToken: "old",
          scopes: [],
        }),
      ),
    ).toMatchObject({ kind: "auth" });
  });
  it("getProfile uses open_id", async () => {
    expect(await tiktokAdapter.getProfile(tok)).toMatchObject({
      platformUserId: "open-1",
      displayName: "Fake Creator",
    });
  });
  it("quota is 15 per account per day", () => {
    expect(tiktokAdapter.quota).toMatchObject({
      scope: "account",
      dailyCap: 15,
      sourceLine: "tiktok.md section 5",
    });
  });
});
