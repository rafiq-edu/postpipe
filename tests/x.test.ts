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
  type MediaInfo,
  PublishError,
  type PublishInput,
  type PublishState,
  type TokenSet,
} from "../lib/platforms/types";
import { xAdapter } from "../lib/platforms/x/adapter";
import createPost from "../lib/platforms/x/fixtures/create-post.json";
import finalizePending from "../lib/platforms/x/fixtures/media-finalize-pending.json";
import mediaInit from "../lib/platforms/x/fixtures/media-init.json";
import statusFailed from "../lib/platforms/x/fixtures/media-status-failed.json";
import statusOk from "../lib/platforms/x/fixtures/media-status-succeeded.json";
import profile from "../lib/platforms/x/fixtures/profile.json";
import token from "../lib/platforms/x/fixtures/token.json";
import { validatePost } from "../lib/platforms/x/rules";
import { xWeightedLength } from "../lib/text/length";

const API = "https://api.x.com";
const seen: {
  posts: Record<string, unknown>[];
  tokenForms: URLSearchParams[];
  auth: (string | null)[];
  segs: { idx: string; size: number }[];
} = {
  posts: [],
  tokenForms: [],
  auth: [],
  segs: [],
};
const server = setupServer(
  http.post(`${API}/2/oauth2/token`, async ({ request }) => {
    seen.auth.push(request.headers.get("authorization"));
    seen.tokenForms.push(new URLSearchParams(await request.text()));
    return HttpResponse.json(token);
  }),
  http.get(`${API}/2/users/me`, () => HttpResponse.json(profile)),
  http.post(`${API}/2/oauth2/revoke`, () =>
    HttpResponse.json({ revoked: true }),
  ),
  http.post(`${API}/2/tweets`, async ({ request }) => {
    seen.posts.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(createPost, { status: 201 });
  }),
  http.post(`${API}/2/media/upload/initialize`, () =>
    HttpResponse.json(mediaInit),
  ),
  http.post(`${API}/2/media/upload/:id/append`, async ({ request }) => {
    const form = await request.formData();
    seen.segs.push({
      idx: String(form.get("segment_index")),
      size: (form.get("media") as File).size,
    });
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${API}/2/media/upload/:id/finalize`, () =>
    HttpResponse.json(finalizePending),
  ),
  http.get(`${API}/2/media/upload`, () => HttpResponse.json(statusOk)),
);
beforeAll(() => {
  server.listen();
});
beforeEach(() => {
  process.env.X_CLIENT_ID = "cid";
  process.env.X_CLIENT_SECRET = "csecret";
  process.env.SECRETS_SOURCE = "env";
});
afterEach(() => {
  server.resetHandlers();
  seen.posts = [];
  seen.tokenForms = [];
  seen.auth = [];
  seen.segs = [];
});
afterAll(() => server.close());

const tokens: TokenSet = {
  accessToken: "at-0",
  refreshToken: "rt-1",
  scopes: [],
};
const start: PublishState = { stage: "start", data: {} };
const input = (o: Partial<PublishInput> = {}): PublishInput => ({
  caption: "hello",
  media: [],
  config: {},
  account: { platformUserId: "2244994945", platformData: {} },
  ...o,
});
const media = (
  mime: string,
  bytes: number,
  durationMs?: number,
): MediaInfo => ({
  mediaId: "m1",
  signedUrl: "https://example.com/m",
  mime,
  bytes,
  durationMs,
});
const noRange = async () => new Uint8Array();
const codes = (i: PublishInput) => validatePost(i).map((v) => v.code);

describe("x text", () => {
  it("280 weighted passes and 281 fails", () => {
    expect(codes(input({ caption: "a".repeat(280) }))).toEqual([]);
    expect(codes(input({ caption: "a".repeat(281) }))).toContain(
      "caption_too_long",
    );
  });
  it("a 90 character URL counts 23", () => {
    const url = `https://example.com/${"a".repeat(70)}`;
    expect(url.length).toBe(90);
    expect(xWeightedLength(url)).toBe(23);
  });
  it("an emoji counts 2, CJK counts 2", () => {
    expect(xWeightedLength("😀")).toBe(2);
    expect(xWeightedLength("👨‍👩‍👧‍👧")).toBe(2);
    expect(xWeightedLength("日本")).toBe(4);
    expect(codes(input({ caption: `${"a".repeat(278)}😀` }))).toEqual([]);
    expect(codes(input({ caption: `${"a".repeat(279)}😀` }))).toContain(
      "caption_too_long",
    );
  });
});

describe("x media rules", () => {
  it("5 images are rejected too_many_media", () => {
    const m = Array.from({ length: 5 }, () => media("image/png", 1000));
    expect(codes(input({ media: m }))).toContain("too_many_media");
    expect(codes(input({ media: m.slice(0, 4) }))).toEqual([]);
  });
  it("video over the post limit is rejected video_too_long", () => {
    expect(
      codes(input({ media: [media("video/mp4", 1000, 20 * 60_000)] })),
    ).toEqual([]);
    expect(
      codes(input({ media: [media("video/mp4", 1000, 20 * 60_000 + 1)] })),
    ).toContain("video_too_long");
  });
  it("140 seconds is not a post limit", () => {
    expect(
      codes(input({ media: [media("video/mp4", 600_000_000, 300_000)] })),
    ).toEqual([]);
  });
  it("size limits and mixing", () => {
    expect(codes(input({ media: [media("image/png", 5_000_001)] }))).toContain(
      "image_too_large",
    );
    expect(codes(input({ media: [media("image/gif", 15_000_001)] }))).toContain(
      "gif_too_large",
    );
    expect(
      codes(input({ media: [media("image/png", 10), media("video/mp4", 10)] })),
    ).toContain("mixed_media");
  });
});

describe("x publish", () => {
  it("text post sets hasUrl only with a link", async () => {
    const plain = await xAdapter.publishStep(start, input(), tokens, noRange);
    expect(
      "result" in plain && plain.result.ok && plain.result.meta?.hasUrl,
    ).toBe(false);
    const linked = await xAdapter.publishStep(
      start,
      input({ caption: "see https://example.com/x" }),
      tokens,
      noRange,
    );
    expect(
      "result" in linked && linked.result.ok && linked.result.meta?.hasUrl,
    ).toBe(true);
    expect(
      "result" in linked && linked.result.ok && linked.result.platformPostId,
    ).toBe(createPost.data.id);
  });

  it("chunked video: init, one append per step, finalize, status, post", async () => {
    const bytes = 5_000_000 * 2 + 10;
    const i = input({ media: [media("video/mp4", bytes, 1000)] });
    const ranges: [number, number][] = [];
    const fetchRange = async (_: string, s: number, e: number) => {
      ranges.push([s, e]);
      return new Uint8Array(e - s + 1);
    };
    let state: PublishState = start;
    const stages: string[] = [];
    let waited: number | undefined;
    let posted = false;
    for (let n = 0; n < 20 && !posted; n++) {
      const out = await xAdapter.publishStep(state, i, tokens, fetchRange);
      if ("result" in out) {
        posted = true;
        break;
      }
      stages.push(out.next.stage);
      if (out.waitMs) waited = out.waitMs;
      expect(JSON.stringify(out.next)).not.toContain("at-0");
      state = out.next;
    }
    expect(posted).toBe(true);
    expect(stages).toEqual([
      "append",
      "append",
      "append",
      "finalize",
      "status",
      "post",
    ]);
    expect(waited).toBe(5000);
    expect(ranges).toEqual([
      [0, 4_999_999],
      [5_000_000, 9_999_999],
      [10_000_000, 10_000_009],
    ]);
    expect(seen.segs.map((s) => s.idx)).toEqual(["0", "1", "2"]);
    expect(seen.posts[0]).toEqual({
      text: "hello",
      media: { media_ids: [mediaInit.data.id] },
    });
  });

  it("status past poll_until is permanent media_processing_timeout, first status sets it", async () => {
    const i = input({ media: [media("video/mp4", 10)] });
    const err = await xAdapter
      .publishStep(
        {
          stage: "status",
          data: {
            idx: 0,
            ids: [],
            media_id: "9",
            poll_until: "2000-01-01T00:00:00.000Z",
          },
        },
        i,
        tokens,
        noRange,
      )
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual([
      "media_processing_timeout",
      "permanent",
    ]);
    server.use(
      http.get(`${API}/2/media/upload`, () =>
        HttpResponse.json({
          data: { id: "9", processing_info: { state: "in_progress" } },
        }),
      ),
    );
    const out = await xAdapter.publishStep(
      { stage: "status", data: { idx: 0, ids: [], media_id: "9" } },
      i,
      tokens,
      noRange,
    );
    expect("next" in out && typeof out.next.data.poll_until).toBe("string");
  });

  it("failed media processing is permanent media_failed", async () => {
    server.use(
      http.get(`${API}/2/media/upload`, () => HttpResponse.json(statusFailed)),
    );
    const err = await xAdapter
      .publishStep(
        { stage: "status", data: { idx: 0, ids: [], media_id: "9" } },
        input({ media: [media("video/mp4", 10)] }),
        tokens,
        noRange,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect([err.code, err.kind]).toEqual(["media_failed", "permanent"]);
  });

  it("403 duplicate maps to permanent duplicate_post without copying text", async () => {
    server.use(
      http.post(`${API}/2/tweets`, () =>
        HttpResponse.json(
          {
            detail:
              "You are not allowed to create a Tweet with duplicate content.",
          },
          { status: 403 },
        ),
      ),
    );
    const err = await xAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual(["duplicate_post", "permanent"]);
    expect(err.message).not.toMatch(/duplicate content/i);
  });

  it("other 403 is permanent forbidden", async () => {
    server.use(
      http.post(`${API}/2/tweets`, () =>
        HttpResponse.json({ detail: "secret remote text" }, { status: 403 }),
      ),
    );
    const err = await xAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual(["forbidden", "permanent"]);
    expect(err.message).not.toContain("secret");
  });

  it("429 is retryable with retryAfterMs from x-rate-limit-reset", async () => {
    server.use(
      http.post(`${API}/2/tweets`, () =>
        HttpResponse.json(
          { errors: [{ code: 88, message: "Rate limit exceeded" }] },
          {
            status: 429,
            headers: {
              "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 120),
            },
          },
        ),
      ),
    );
    const err = await xAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect(err.kind).toBe("retryable");
    expect(err.retryAfterMs).toBeGreaterThan(100_000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(120_000);
  });

  it("lost response on create post is permanent post_outcome_unknown, no second POST", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/2/tweets`, () => {
        calls++;
        return HttpResponse.error();
      }),
    );
    const err = await xAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
    expect(calls).toBe(1);
  });

  it("503 on create post is post_outcome_unknown", async () => {
    server.use(
      http.post(
        `${API}/2/tweets`,
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    const err = await xAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
  });

  it("2 images: both ids reach the post body", async () => {
    let n = 0;
    server.use(
      http.post(`${API}/2/media/upload/initialize`, () =>
        HttpResponse.json({ data: { id: `id${++n}` } }),
      ),
      http.post(`${API}/2/media/upload/:id/finalize`, () =>
        HttpResponse.json({ data: {} }),
      ),
    );
    const i = input({
      media: [media("image/png", 10), media("image/png", 10)],
    });
    let state: PublishState = start;
    const idxs: unknown[] = [];
    for (let k = 0; k < 20; k++) {
      const out = await xAdapter.publishStep(
        state,
        i,
        tokens,
        async (_, s, e) => new Uint8Array(e - s + 1),
      );
      if ("result" in out) break;
      idxs.push(out.next.data.idx);
      state = out.next;
    }
    expect(idxs).toContain(1);
    expect(seen.posts[0]).toEqual({
      text: "hello",
      media: { media_ids: ["id1", "id2"] },
    });
  });

  it("10,000,000 bytes is exactly 2 append chunks", async () => {
    const i = input({ media: [media("image/gif", 10_000_000)] });
    let state: PublishState = start;
    for (let k = 0; k < 20; k++) {
      const out = await xAdapter.publishStep(
        state,
        i,
        tokens,
        async (_, s, e) => new Uint8Array(e - s + 1),
      );
      if ("result" in out) break;
      state = out.next;
    }
    expect(seen.segs).toEqual([
      { idx: "0", size: 5_000_000 },
      { idx: "1", size: 5_000_000 },
    ]);
  });

  it("401 maps to auth", async () => {
    server.use(
      http.post(
        `${API}/2/tweets`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    const err = await xAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect(err.kind).toBe("auth");
  });
});

describe("x oauth", () => {
  it("auth url has PKCE S256 and the exact scopes", async () => {
    const { url } = await xAdapter.getAuthUrl({
      state: "s1",
      redirectUri: "http://127.0.0.1:3000/cb",
      codeChallenge: "chal",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(u.searchParams.get("scope")).toBe(
      "tweet.read tweet.write users.read offline.access media.write",
    );
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("client_id")).toBe("cid");
  });

  it("exchanges the code with basic auth and the verifier", async () => {
    const t = await xAdapter.exchangeCode({
      code: "c",
      redirectUri: "http://127.0.0.1:3000/cb",
      codeVerifier: "ver",
    });
    expect(seen.auth[0]).toBe(
      `Basic ${Buffer.from("cid:csecret").toString("base64")}`,
    );
    expect(seen.tokenForms[0].get("code_verifier")).toBe("ver");
    expect(t.accessToken).toBe("at-1");
    expect(t.refreshToken).toBe("rt-2");
    expect(t.scopes).toContain("media.write");
    expect(t.expiresAt).toBeDefined();
  });

  it("refresh returns the rotated refresh token", async () => {
    const t = await xAdapter.refreshToken(tokens);
    expect(seen.tokenForms[0].get("grant_type")).toBe("refresh_token");
    expect(seen.tokenForms[0].get("refresh_token")).toBe("rt-1");
    expect(t.refreshToken).toBe("rt-2");
  });

  it("reads profile and revokes", async () => {
    const p = await xAdapter.getProfile(tokens);
    expect(p).toMatchObject({
      platformUserId: "2244994945",
      username: "alice",
    });
    await expect(xAdapter.revoke(tokens)).resolves.toBeUndefined();
  });

  it("missing keys fail at call time, not at import", async () => {
    delete process.env.X_CLIENT_ID;
    await expect(
      xAdapter.getAuthUrl({ state: "s", redirectUri: "r", codeChallenge: "c" }),
    ).rejects.toThrow(/MissingSecret/);
  });
});
