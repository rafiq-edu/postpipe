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
  escapeCommentary,
  linkedinAdapter,
} from "../lib/platforms/linkedin/adapter";
import imageInit from "../lib/platforms/linkedin/fixtures/image-init.json";
import profile from "../lib/platforms/linkedin/fixtures/profile.json";
import token from "../lib/platforms/linkedin/fixtures/token.json";
import videoInit from "../lib/platforms/linkedin/fixtures/video-init.json";
import { validatePost } from "../lib/platforms/linkedin/rules";
import {
  type MediaInfo,
  PublishError,
  type PublishInput,
  type PublishState,
  type TokenSet,
} from "../lib/platforms/types";

const REST = "https://api.linkedin.com/rest";
const seen: {
  posts: Record<string, unknown>[];
  headers: Headers[];
  tokenForms: URLSearchParams[];
  puts: { url: string; size: number; auth: string | null }[];
  finalize: unknown[];
} = { posts: [], headers: [], tokenForms: [], puts: [], finalize: [] };

const server = setupServer(
  http.post(
    "https://www.linkedin.com/oauth/v2/accessToken",
    async ({ request }) => {
      seen.tokenForms.push(new URLSearchParams(await request.text()));
      return HttpResponse.json(token);
    },
  ),
  http.get("https://api.linkedin.com/v2/userinfo", () =>
    HttpResponse.json(profile),
  ),
  http.post(`${REST}/posts`, async ({ request }) => {
    seen.headers.push(request.headers);
    seen.posts.push((await request.json()) as Record<string, unknown>);
    return new HttpResponse(null, {
      status: 201,
      headers: { "x-restli-id": "urn:li:share:123" },
    });
  }),
  http.post(`${REST}/images`, () => HttpResponse.json(imageInit)),
  http.post(`${REST}/videos`, async ({ request }) => {
    if (new URL(request.url).searchParams.get("action") === "finalizeUpload") {
      seen.finalize.push(await request.json());
      return new HttpResponse(null, { status: 200 });
    }
    return HttpResponse.json(videoInit);
  }),
  http.get(`${REST}/videos/:urn`, () =>
    HttpResponse.json({ status: "AVAILABLE" }),
  ),
  http.put(
    "https://www.linkedin.com/dms-uploads/:id",
    async ({ request, params }) => {
      seen.puts.push({
        url: String(params.id),
        size: (await request.arrayBuffer()).byteLength,
        auth: request.headers.get("authorization"),
      });
      return new HttpResponse(null, {
        status: 201,
        headers: { etag: `etag-${params.id}` },
      });
    },
  ),
);
beforeAll(() => {
  server.listen();
});
beforeEach(() => {
  process.env.LINKEDIN_CLIENT_ID = "cid";
  process.env.LINKEDIN_CLIENT_SECRET = "csecret";
  process.env.SECRETS_SOURCE = "env";
});
afterEach(() => {
  server.resetHandlers();
  seen.posts = [];
  seen.headers = [];
  seen.tokenForms = [];
  seen.puts = [];
  seen.finalize = [];
});
afterAll(() => server.close());

const tokens: TokenSet = { accessToken: "at-0", scopes: [] };
const start: PublishState = { stage: "start", data: {} };
const input = (o: Partial<PublishInput> = {}): PublishInput => ({
  caption: "hello",
  media: [],
  config: {},
  account: { platformUserId: "abc123", platformData: {} },
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

async function run(i: PublishInput, t = tokens) {
  const stages: string[] = [];
  const fetchRange = async (_: string, s: number, e: number) =>
    new Uint8Array(e - s + 1);
  let state = start;
  for (let n = 0; n < 20; n++) {
    const out = await linkedinAdapter.publishStep(state, i, t, fetchRange);
    if ("result" in out) return { out, stages };
    stages.push(out.next.stage);
    expect(JSON.stringify(out.next)).not.toContain("at-0");
    state = out.next;
  }
  throw new Error("no result");
}

describe("linkedin rules", () => {
  it("3000 passes and 3001 fails", () => {
    expect(codes(input({ caption: "a".repeat(3000) }))).toEqual([]);
    expect(codes(input({ caption: "a".repeat(3001) }))).toContain(
      "caption_too_long",
    );
  });
  it("media rules", () => {
    const img = media("image/png", 10);
    expect(codes(input({ media: Array(21).fill(img) }))).toContain(
      "too_many_media",
    );
    expect(
      codes(input({ media: [img, media("video/mp4", 1_000_000)] })),
    ).toContain("mixed_media");
    expect(
      codes(input({ media: [{ ...img, width: 6000, height: 6026 }] })),
    ).toContain("image_too_large");
    expect(
      codes(input({ media: [media("video/mp4", 1_000_000, 2999)] })),
    ).toContain("video_length");
    expect(
      codes(
        input({ media: [media("video/mp4", 500 * 1024 * 1024 + 1, 5000)] }),
      ),
    ).toContain("video_size");
  });
});

describe("linkedin escaping", () => {
  it.each([..."|{}@[]()<>#\\*_~"])("escapes %s", async (ch) => {
    expect(escapeCommentary(`a${ch}b`)).toBe(`a\\${ch}b`);
    await run(input({ caption: `a${ch}b` }));
    expect(seen.posts[0]?.commentary).toBe(`a\\${ch}b`);
  });
});

describe("linkedin publish", () => {
  it("text post: versioned headers, url from x-restli-id", async () => {
    const { out } = await run(input({ caption: "see https://e.com" }));
    expect("result" in out && out.result.ok && out.result.platformPostUrl).toBe(
      "https://www.linkedin.com/feed/update/urn:li:share:123/",
    );
    expect(seen.headers[0]?.get("linkedin-version")).toBe("202610");
    expect(seen.headers[0]?.get("x-restli-protocol-version")).toBe("2.0.0");
    expect(seen.posts[0]?.author).toBe("urn:li:person:abc123");
  });
  it("one image: init, put, post", async () => {
    const { stages } = await run(input({ media: [media("image/png", 10)] }));
    expect(stages).toEqual(["post"]);
    expect(seen.puts).toEqual([
      { url: "img-1", size: 10, auth: "Bearer at-0" },
    ]);
    expect(seen.posts[0]?.content).toEqual({
      media: { id: "urn:li:image:IMG1" },
    });
  });
  it("2-part video: init, 2 parts, finalize, status, post", async () => {
    const { stages } = await run(
      input({ media: [media("video/mp4", 4_194_314, 5000)] }),
    );
    expect(stages).toEqual(["part", "part", "finalize", "status", "post"]);
    expect(seen.puts.map((p) => p.size)).toEqual([4_194_304, 10]);
    expect(seen.finalize[0]).toEqual({
      finalizeUploadRequest: {
        video: "urn:li:video:VID1",
        uploadToken: "utok",
        uploadedPartIds: ["etag-v-1", "etag-v-2"],
      },
    });
    expect(seen.posts[0]?.content).toEqual({
      media: { id: "urn:li:video:VID1" },
    });
  });
  it("image waits 5000 ms before the post stage", async () => {
    const out = await linkedinAdapter.publishStep(
      start,
      input({ media: [media("image/png", 10)] }),
      tokens,
      async () => new Uint8Array(10),
    );
    expect("next" in out && [out.next.stage, out.waitMs]).toEqual([
      "post",
      5000,
    ]);
  });
  it("multi-image: 2 images with alt text", async () => {
    const a = { ...media("image/png", 10), altText: "first" };
    const b = { ...media("image/jpeg", 10), altText: "second" };
    const { stages } = await run(input({ media: [a, b] }));
    expect(stages).toEqual(["init", "post"]);
    expect(seen.posts[0]?.content).toEqual({
      multiImage: {
        images: [
          { id: "urn:li:image:IMG1", altText: "first" },
          { id: "urn:li:image:IMG1", altText: "second" },
        ],
      },
    });
  });
  it("token goes only to https linkedin hosts", async () => {
    for (const url of [
      "http://www.linkedin.com/dms-uploads/x",
      "https://evil.example.com/up",
    ]) {
      server.use(
        http.post(`${REST}/images`, () =>
          HttpResponse.json({
            value: { uploadUrl: url, image: "urn:li:image:I" },
          }),
        ),
        http.put(url, ({ request }) => {
          seen.puts.push({
            url,
            size: 0,
            auth: request.headers.get("authorization"),
          });
          return new HttpResponse(null, { status: 201 });
        }),
      );
      await run(input({ media: [media("image/png", 10)] }));
    }
    expect(seen.puts.map((p) => p.auth)).toEqual([null, null]);
  });
  it("WAITING_UPLOAD code is retryable, other 4xx stay permanent", async () => {
    server.use(
      http.post(`${REST}/posts`, () =>
        HttpResponse.json(
          { code: "MEDIA_ASSET_WAITING_UPLOAD" },
          { status: 400 },
        ),
      ),
    );
    const err = await linkedinAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual(["media_not_ready", "retryable"]);
  });
  it("empty text is rejected only without media", () => {
    expect(codes(input({ caption: " " }))).toContain("caption_required");
    expect(
      codes(input({ caption: " ", media: [media("image/png", 10)] })),
    ).toEqual([]);
  });
  it("video status: poll_until set on first poll, timeout past it", async () => {
    const vs = {
      stage: "status",
      data: { idx: 0, ids: [], video: "urn:li:video:VID1" },
    };
    server.use(
      http.get(`${REST}/videos/:urn`, () =>
        HttpResponse.json({ status: "PROCESSING" }),
      ),
    );
    const i = input({ media: [media("video/mp4", 1_000_000, 5000)] });
    const out = await linkedinAdapter.publishStep(vs, i, tokens, noRange);
    expect("next" in out && typeof out.next.data.poll_until).toBe("string");
    const err = await linkedinAdapter
      .publishStep(
        { ...vs, data: { ...vs.data, poll_until: "2000-01-01T00:00:00.000Z" } },
        i,
        tokens,
        noRange,
      )
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual([
      "media_processing_timeout",
      "permanent",
    ]);
  });
  it("lost response on create is post_outcome_unknown", async () => {
    server.use(http.post(`${REST}/posts`, () => HttpResponse.error()));
    const err = await linkedinAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual(["post_outcome_unknown", "permanent"]);
  });
  it("503 on create is post_outcome_unknown, 429 stays retryable", async () => {
    server.use(
      http.post(`${REST}/posts`, () => new HttpResponse(null, { status: 503 })),
    );
    let err = await linkedinAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect(err.code).toBe("post_outcome_unknown");
    server.use(
      http.post(`${REST}/posts`, () => new HttpResponse(null, { status: 429 })),
    );
    err = await linkedinAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect([err.code, err.kind]).toEqual(["rate_limited", "retryable"]);
  });
  it("401 and expired token map to account_reauth_required/auth", async () => {
    server.use(
      http.post(`${REST}/posts`, () => new HttpResponse(null, { status: 401 })),
    );
    const e1 = await linkedinAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect(e1).toBeInstanceOf(PublishError);
    expect([e1.code, e1.kind]).toEqual(["account_reauth_required", "auth"]);
    const e2 = await linkedinAdapter
      .publishStep(
        start,
        input(),
        { ...tokens, expiresAt: new Date(Date.now() - 1000).toISOString() },
        noRange,
      )
      .catch((e) => e);
    expect([e2.code, e2.kind]).toEqual(["account_reauth_required", "auth"]);
  });
  it("unknown 4xx maps to http_<status> with a fixed message", async () => {
    server.use(
      http.post(`${REST}/posts`, () =>
        HttpResponse.json({ message: "secret text" }, { status: 422 }),
      ),
    );
    const err = await linkedinAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect(err.code).toBe("http_422");
    expect(err.message).not.toContain("secret");
  });
});

describe("linkedin oauth", () => {
  it("auth url, exchange, refresh, profile, revoke", async () => {
    const { url } = await linkedinAdapter.getAuthUrl({
      state: "s",
      redirectUri: "https://x/cb",
    });
    const u = new URL(url);
    expect(u.searchParams.get("scope")).toBe(
      "openid profile email w_member_social",
    );
    expect(u.searchParams.get("client_id")).toBe("cid");
    const t = await linkedinAdapter.exchangeCode({
      code: "c",
      redirectUri: "https://x/cb",
    });
    expect(t.refreshToken).toBeUndefined();
    expect(Date.parse(t.expiresAt ?? "") - Date.now()).toBeGreaterThan(
      5_000_000_000,
    );
    expect(seen.tokenForms[0]?.get("client_secret")).toBe("csecret");
    const err = await linkedinAdapter.refreshToken(t).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["account_reauth_required", "auth"]);
    expect((await linkedinAdapter.getProfile(t)).platformUserId).toBe("abc123");
    await linkedinAdapter.revoke(t);
  });
});
