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
import { facebookAdapter } from "../lib/platforms/facebook/adapter";
import { GRAPH_VERSION } from "../lib/platforms/facebook/api";
import accounts from "../lib/platforms/facebook/fixtures/accounts.json";
import longToken from "../lib/platforms/facebook/fixtures/long-token.json";
import token from "../lib/platforms/facebook/fixtures/token.json";
import { validatePost } from "../lib/platforms/facebook/rules";
import type {
  MediaInfo,
  PublishInput,
  PublishState,
  TokenSet,
} from "../lib/platforms/types";

const A = `https://graph.facebook.com/${GRAPH_VERSION}`;
const seen: { forms: URLSearchParams[]; urls: URL[]; multi: FormData[] } = {
  forms: [],
  urls: [],
  multi: [],
};
const hosts: string[] = [];
let ranges: [number, number][] = [];
let reelStatuses: unknown[] = [];
let n = 0;

const server = setupServer(
  http.get(`${A}/oauth/access_token`, ({ request }) => {
    const u = new URL(request.url);
    seen.urls.push(u);
    return HttpResponse.json(
      u.searchParams.get("grant_type") === "fb_exchange_token"
        ? longToken
        : token,
    );
  }),
  http.get(`${A}/me/accounts`, ({ request }) => {
    seen.urls.push(new URL(request.url));
    return HttpResponse.json(accounts);
  }),
  http.get(`${A}/me`, () => HttpResponse.json({ id: "u-1", name: "Alice" })),
  http.post(`${A}/:page/feed`, async ({ request }) => {
    seen.forms.push(new URLSearchParams(await request.text()));
    return HttpResponse.json({ id: "page-1_post-1" });
  }),
  http.post(`${A}/:page/photos`, async ({ request }) => {
    const f = new URLSearchParams(await request.text());
    seen.forms.push(f);
    return HttpResponse.json(
      f.get("published") === "false"
        ? { id: `ph${++n}` }
        : { id: "ph-x", post_id: "page-1_photo-post" },
    );
  }),
  http.post(`${A}/:page/videos`, async ({ request }) => {
    if (request.headers.get("content-type")?.includes("multipart")) {
      const fd = await request.formData();
      seen.multi.push(fd);
      const start = Number(fd.get("start_offset"));
      return HttpResponse.json({
        start_offset: String(start + 4),
        end_offset: String(Math.min(start + 8, 10)),
      });
    }
    const f = new URLSearchParams(await request.text());
    seen.forms.push(f);
    return f.get("upload_phase") === "start"
      ? HttpResponse.json({
          upload_session_id: "sess-1",
          video_id: "vid-1",
          start_offset: "0",
          end_offset: "4",
        })
      : HttpResponse.json({ success: true });
  }),
  http.post(`${A}/:page/video_reels`, async ({ request }) => {
    const f = new URLSearchParams(await request.text());
    seen.forms.push(f);
    return f.get("upload_phase") === "start"
      ? HttpResponse.json({ video_id: "reel-1" })
      : HttpResponse.json({ success: true });
  }),
  http.post("https://rupload.facebook.com/video-upload/:id", ({ request }) => {
    hosts.push(request.headers.get("file_url") ?? "");
    expect(request.headers.get("authorization")).toBeNull();
    return HttpResponse.json({ success: true });
  }),
  http.get(`${A}/:id`, ({ request }) => {
    const u = new URL(request.url);
    if (u.searchParams.get("fields") === "status")
      return HttpResponse.json(
        reelStatuses.shift() ?? { status: { video_status: "ready" } },
      );
    return HttpResponse.json({
      permalink_url: "/page-1/posts/1",
    });
  }),
);
beforeAll(() => server.listen());
beforeEach(() => {
  process.env.META_APP_ID = "mid";
  process.env.META_APP_SECRET = "msecret";
  process.env.META_LOGIN_CONFIG_ID = "cfg-1";
  process.env.SECRETS_SOURCE = "env";
});
afterEach(() => {
  server.resetHandlers();
  seen.forms = [];
  seen.urls = [];
  seen.multi = [];
  hosts.length = 0;
  ranges = [];
  reelStatuses = [];
  n = 0;
});
afterAll(() => server.close());

const tokens: TokenSet = { accessToken: "page-token-1", scopes: [] };
const start: PublishState = { stage: "start", data: {} };
const input = (o: Partial<PublishInput> = {}): PublishInput => ({
  caption: "hello",
  media: [],
  config: {},
  account: { platformUserId: "page-1", platformData: {} },
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
const range = async (_: string, s: number, e: number) => {
  ranges.push([s, e]);
  return new Uint8Array(e - s + 1);
};
const codes = (i: PublishInput) => validatePost(i).map((v) => v.code);
const step = (s: PublishState, i: PublishInput) =>
  facebookAdapter.publishStep(s, i, tokens, range);

async function run(i: PublishInput) {
  const stages: string[] = [];
  let state = start;
  for (let k = 0; k < 40; k++) {
    const out = await step(state, i);
    if ("result" in out) return { out, stages };
    stages.push(out.next.stage);
    const j = JSON.stringify(out.next);
    expect(j).not.toContain("page-token-1");
    expect(j).not.toContain("sig=abc"); // signed media URL stays out of state
    state = out.next;
  }
  throw new Error("no result");
}

describe("facebook rules", () => {
  it("empty post rejected; text, link and photos pass", () => {
    expect(codes(input({ caption: "" }))).toContain("content_required");
    expect(codes(input())).toEqual([]);
    expect(
      codes(input({ caption: "", config: { link: "https://a.example" } })),
    ).toEqual([]);
    expect(codes(input({ media: [jpg, jpg, jpg] }))).toEqual([]);
  });
  it("photo 10 MB, format, link with media, mixed video", () => {
    expect(
      codes(input({ media: [media("image/jpeg", 10_000_001)] })),
    ).toContain("image_too_large");
    expect(codes(input({ media: [media("image/webp", 10)] }))).toContain(
      "unsupported_media",
    );
    expect(
      codes(input({ media: [jpg], config: { link: "https://a.example" } })),
    ).toContain("config_media_mismatch");
    expect(codes(input({ media: [mp4, jpg] }))).toContain("too_many_media");
  });
  it("Reel: MP4 only, 3 to 90 seconds, reel needs one video", () => {
    const reel = (m: MediaInfo) =>
      codes(input({ media: [m], config: { reel: true } }));
    expect(reel(media("video/mp4", 10, { durationMs: 2_999 }))).toContain(
      "video_duration",
    );
    expect(reel(media("video/mp4", 10, { durationMs: 90_001 }))).toContain(
      "video_duration",
    );
    expect(reel(media("video/mp4", 10, { durationMs: 90_000 }))).toEqual([]);
    expect(reel(media("video/quicktime", 10))).toContain("unsupported_media");
    expect(reel(jpg)).toContain("config_media_mismatch");
  });
  it("quota applies to Reels only", () => {
    const q = facebookAdapter.quota;
    expect(q).toMatchObject({ scope: "account", dailyCap: 30 });
    expect(q?.appliesTo?.({ config: { reel: true } })).toBe(true);
    expect(q?.appliesTo?.({ config: {} })).toBe(false);
  });
});

describe("facebook oauth and targets", () => {
  it("auth url uses config_id and the app id", async () => {
    const { url } = await facebookAdapter.getAuthUrl({
      state: "s1",
      redirectUri: "https://x.example/cb",
    });
    const u = new URL(url);
    expect(u.searchParams.get("config_id")).toBe("cfg-1");
    expect(u.searchParams.get("client_id")).toBe("mid");
    expect(url).not.toContain("msecret");
  });
  it("exchange: code, then long-lived user token", async () => {
    const t = await facebookAdapter.exchangeCode({
      code: "c1",
      redirectUri: "https://x.example/cb",
    });
    expect(t.accessToken).toBe("long-user-token");
    expect(seen.urls[1]?.searchParams.get("fb_exchange_token")).toBe(
      "short-user-token",
    );
    expect(Date.parse(t.expiresAt ?? "")).toBeGreaterThan(Date.now());
  });
  it("listTargets returns Pages with CREATE_CONTENT, no token", async () => {
    const list = await facebookAdapter.listTargets?.({
      accessToken: "long-user-token",
      scopes: [],
    });
    expect(list).toEqual([
      { id: "page-1", kind: "page", name: "Page One" },
      { id: "page-2", kind: "page", name: "Page Two" },
    ]);
    expect(JSON.stringify(list)).not.toContain("page-token");
  });
  it("targetToken returns the Page token without expiry; unknown Page fails", async () => {
    const u: TokenSet = {
      accessToken: "long-user-token",
      expiresAt: "2030-01-01T00:00:00Z",
      scopes: ["a"],
    };
    expect(await facebookAdapter.targetToken?.(u, "page-2")).toEqual({
      accessToken: "page-token-2",
      scopes: ["a"],
    });
    await expect(facebookAdapter.targetToken?.(u, "page-3")).rejects.toThrow(
      "Page token not found",
    );
  });
});

describe("facebook publish", () => {
  it("text with link: one feed post with message and link", async () => {
    const { out, stages } = await run(
      input({ config: { link: "https://a.example/x" } }),
    );
    expect(stages).toEqual([]);
    expect(seen.forms).toHaveLength(1);
    expect(seen.forms[0]?.get("message")).toBe("hello");
    expect(seen.forms[0]?.get("link")).toBe("https://a.example/x");
    expect(seen.forms[0]?.get("access_token")).toBe("page-token-1");
    expect(out).toMatchObject({
      result: {
        ok: true,
        platformPostId: "page-1_post-1",
        platformPostUrl: "https://www.facebook.com/page-1/posts/1",
        meta: { hasUrl: true },
      },
    });
  });
  it("one photo goes to /photos and returns post_id", async () => {
    const { out } = await run(input({ media: [jpg] }));
    expect(seen.forms[0]?.get("url")).toBe("https://example.com/m?sig=abc");
    expect(out).toMatchObject({
      result: { platformPostId: "page-1_photo-post" },
    });
  });
  it("3 photos: 3 unpublished uploads, then one feed post with attached_media", async () => {
    const { out, stages } = await run(input({ media: [jpg, jpg, jpg] }));
    expect(stages).toEqual(["photo", "photo", "photo", "attach"]);
    expect(seen.forms.slice(0, 3).map((f) => f.get("published"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    const feed = seen.forms[3];
    expect(feed?.get("attached_media[0]")).toBe('{"media_fbid":"ph1"}');
    expect(feed?.get("attached_media[2]")).toBe('{"media_fbid":"ph3"}');
    expect(feed?.get("message")).toBe("hello");
    expect(seen.forms).toHaveLength(4);
    expect(out).toMatchObject({ result: { platformPostId: "page-1_post-1" } });
  });
  it("video: start, one chunk per step by the offsets given, finish", async () => {
    const { out, stages } = await run(
      input({ media: [mp4], config: { title: "T" } }),
    );
    expect(stages).toEqual([
      "video_transfer",
      "video_transfer",
      "video_transfer",
      "video_finish",
    ]);
    expect(ranges).toEqual([
      [0, 3],
      [4, 7],
      [8, 9],
    ]);
    expect(seen.multi[0]?.get("upload_session_id")).toBe("sess-1");
    expect(seen.multi[0]?.get("video_file_chunk")).toBeInstanceOf(Blob);
    const fin = seen.forms.at(-1);
    expect([fin?.get("upload_phase"), fin?.get("title")]).toEqual([
      "finish",
      "T",
    ]);
    expect(out).toMatchObject({ result: { platformPostId: "vid-1" } });
  });
  it("Reel: start, hosted upload without a token, poll until ready, finish", async () => {
    reelStatuses = [{ status: { video_status: "processing" } }];
    const { out, stages } = await run(
      input({ media: [mp4], config: { reel: true } }),
    );
    expect(stages).toEqual([
      "reel_upload",
      "reel_status",
      "reel_status",
      "reel_finish",
    ]);
    expect(hosts).toEqual(["https://example.com/m?sig=abc"]);
    const fin = seen.forms.at(-1);
    expect([fin?.get("upload_phase"), fin?.get("video_state")]).toEqual([
      "finish",
      "PUBLISHED",
    ]);
    expect(out).toMatchObject({ result: { platformPostId: "reel-1" } });
  });
  it("Reel status: error is permanent; deadline passed is a timeout", async () => {
    reelStatuses = [{ status: { video_status: "error" } }];
    const err = await step(
      { stage: "reel_status", data: { video_id: "reel-1" } },
      input({ media: [mp4], config: { reel: true } }),
    ).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["media_failed", "permanent"]);
    const late = await step(
      {
        stage: "reel_status",
        data: { video_id: "reel-1", poll_until: "2000-01-01T00:00:00Z" },
      },
      input({ media: [mp4], config: { reel: true } }),
    ).catch((e) => e);
    expect(late.code).toBe("media_processing_timeout");
  });
  it("code 190 maps to account_reauth_required, kind auth, without remote text", async () => {
    server.use(
      http.post(`${A}/:page/feed`, () =>
        HttpResponse.json(
          { error: { code: 190, message: "bad EAAB1234567890abcdefgh" } },
          { status: 400 },
        ),
      ),
    );
    const err = await step(start, input()).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["account_reauth_required", "auth"]);
    expect(err.message).not.toContain("EAAB");
  });
  it("rate limit code 80001 is retryable", async () => {
    server.use(
      http.post(`${A}/:page/feed`, () =>
        HttpResponse.json({ error: { code: 80001 } }, { status: 400 }),
      ),
    );
    const err = await step(start, input()).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["rate_limited", "retryable"]);
  });
  it("final feed call: 5xx, network error and 200 without id are post_outcome_unknown", async () => {
    for (const h of [
      () => new HttpResponse(null, { status: 503 }),
      () => HttpResponse.error(),
      () => HttpResponse.json({}),
      () => new HttpResponse("not json"),
    ]) {
      server.use(http.post(`${A}/:page/feed`, h));
      const err = await step(start, input()).catch((e) => e);
      expect([err.code, err.kind]).toEqual([
        "post_outcome_unknown",
        "permanent",
      ]);
    }
  });
  it("final Reel finish without success is post_outcome_unknown", async () => {
    server.use(
      http.post(`${A}/:page/video_reels`, () => HttpResponse.json({})),
    );
    const err = await step(
      { stage: "reel_finish", data: { video_id: "reel-1" } },
      input({ media: [mp4], config: { reel: true } }),
    ).catch((e) => e);
    expect(err.code).toBe("post_outcome_unknown");
  });
  it("a non-final 5xx stays retryable; network error message has no token", async () => {
    server.use(http.post(`${A}/:page/photos`, () => HttpResponse.error()));
    const err = await step(
      { stage: "photo", data: { idx: 0, photos: [] } },
      input({ media: [jpg, jpg] }),
    ).catch((e) => e);
    expect([err.code, err.kind]).toEqual(["network_error", "retryable"]);
    expect(err.message).not.toContain("page-token-1");
  });
});
