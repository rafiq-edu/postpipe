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
import { pinterestAdapter } from "../lib/platforms/pinterest/adapter";
import boards from "../lib/platforms/pinterest/fixtures/boards.json";
import pin from "../lib/platforms/pinterest/fixtures/pin.json";
import token from "../lib/platforms/pinterest/fixtures/token.json";
import video from "../lib/platforms/pinterest/fixtures/video.json"; // UNRECORDED
import { validatePost } from "../lib/platforms/pinterest/rules";
import type {
  MediaInfo,
  PublishError,
  PublishInput,
  PublishState,
  TokenSet,
} from "../lib/platforms/types";

const A = "https://api.pinterest.com/v5";
const S = "https://api-sandbox.pinterest.com/v5";
const UP = video.register.upload_url;
const seen: {
  pins: Record<string, unknown>[];
  auth: string[];
  up: FormData[];
} = { pins: [], auth: [], up: [] };
let pinReply: () => Response = () => HttpResponse.json(pin, { status: 201 });
let statuses: unknown[] = [];
let boardCalls: URL[] = [];

const server = setupServer(
  http.post(`${A}/oauth/token`, async ({ request }) => {
    seen.auth.push(request.headers.get("authorization") ?? "");
    seen.pins.push(
      Object.fromEntries(new URLSearchParams(await request.text())),
    );
    return HttpResponse.json(token);
  }),
  http.get(`${A}/boards`, ({ request }) => {
    const u = new URL(request.url);
    boardCalls.push(u);
    const n = Number(u.searchParams.get("bookmark")?.slice(3) ?? 0);
    return HttpResponse.json(boards.pages[n]);
  }),
  http.get(`${A}/user_account`, () => HttpResponse.json({ username: "alice" })),
  http.post(`${A}/pins`, async ({ request }) => {
    seen.auth.push(request.headers.get("authorization") ?? "");
    seen.pins.push((await request.json()) as Record<string, unknown>);
    return pinReply();
  }),
  http.post(`${A}/media`, () => HttpResponse.json(video.register)),
  http.post(UP, async ({ request }) => {
    expect(request.headers.get("authorization")).toBeNull();
    seen.up.push(await request.formData());
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${A}/media/:id`, () =>
    HttpResponse.json(statuses.shift() ?? video.succeeded),
  ),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  process.env.PINTEREST_APP_ID = "pid";
  process.env.PINTEREST_APP_SECRET = "psecret";
  delete process.env.PINTEREST_ENV;
  process.env.SECRETS_SOURCE = "env";
});
afterEach(() => {
  server.resetHandlers();
  seen.pins = [];
  seen.auth = [];
  seen.up = [];
  statuses = [];
  boardCalls = [];
  pinReply = () => HttpResponse.json(pin, { status: 201 });
});
afterAll(() => server.close());

const tokens: TokenSet = { accessToken: "pina-secret-1", scopes: [] };
const start: PublishState = { stage: "start", data: {} };
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
const mp4 = media("video/mp4", 4, {
  thumbnailUrl: "https://example.com/cover.jpg?sig=cov",
});
const input = (o: Partial<PublishInput> = {}): PublishInput => ({
  caption: "hello",
  media: [jpg],
  config: { board_id: "b-1" },
  account: { platformUserId: "alice", platformData: {} },
  ...o,
});
const range = async (_: string, s: number, e: number) =>
  new Uint8Array(e - s + 1);
const codes = (i: PublishInput) => validatePost(i).map((v) => v.code);
const step = (s: PublishState, i: PublishInput) =>
  pinterestAdapter.publishStep(s, i, tokens, range);

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
    for (const bad of ["pina-secret-1", "sig=abc", "sig=cov", "fake-sig"])
      expect(j).not.toContain(bad);
    state = out.next;
  }
  throw new Error("no result");
}
const err = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: PublishError) => e,
  );

describe("pinterest rules", () => {
  it("board_id required unless a board was picked at connect", () => {
    expect(codes(input({ config: {} }))).toContain("board_required");
    expect(
      codes(
        input({
          config: {},
          account: {
            platformUserId: "u1",
            platformData: { target: { id: "b-9" } },
          },
        }),
      ),
    ).toEqual([]);
    expect(codes(input())).toEqual([]);
  });
  it("title 100, description 800, alt text 500, link 2048", () => {
    const c = (o: Record<string, string>) =>
      codes(input({ config: { board_id: "b", ...o } }));
    expect(c({ title: "a".repeat(100) })).toEqual([]);
    expect(c({ title: "a".repeat(101) })).toContain("title_too_long");
    expect(codes(input({ caption: "a".repeat(800) }))).toEqual([]);
    expect(codes(input({ caption: "a".repeat(801) }))).toContain(
      "description_too_long",
    );
    expect(c({ alt_text: "a".repeat(501) })).toContain("alt_text_too_long");
    expect(c({ link: `https://a.example/${"a".repeat(2040)}` })).toContain(
      "link_too_long",
    );
  });
  it("media: required, one only, format, size, video cover and duration", () => {
    expect(codes(input({ media: [] }))).toContain("media_required");
    expect(codes(input({ media: [jpg, jpg] }))).toContain("too_many_media");
    expect(codes(input({ media: [media("image/gif", 1)] }))).toContain(
      "unsupported_media",
    );
    expect(codes(input({ media: [media("image/png", 20_000_001)] }))).toContain(
      "image_too_large",
    );
    expect(codes(input({ media: [media("video/mp4", 1)] }))).toContain(
      "cover_required",
    );
    expect(codes(input({ media: [{ ...mp4, durationMs: 3_999 }] }))).toContain(
      "video_duration",
    );
    expect(
      codes(input({ media: [{ ...mp4, durationMs: 300_001 }] })),
    ).toContain("video_duration");
    expect(codes(input({ media: [{ ...mp4, durationMs: 5_000 }] }))).toEqual(
      [],
    );
  });
});

describe("pinterest publish", () => {
  it("image pin happy path", async () => {
    const { out, stages } = await run(
      input({
        config: { board_id: "b-1", title: "T", link: "https://a.example" },
      }),
    );
    expect(stages).toEqual([]);
    expect(out.result).toMatchObject({
      ok: true,
      platformPostId: "pin-1",
      platformPostUrl: "https://www.pinterest.com/pin/pin-1/",
      meta: { hasUrl: true },
    });
    expect(seen.auth).toEqual(["Bearer pina-secret-1"]);
    expect(seen.pins[0]).toEqual({
      board_id: "b-1",
      title: "T",
      link: "https://a.example",
      description: "hello",
      media_source: { source_type: "image_url", url: jpg.signedUrl },
    });
  });
  it("video: registers, uploads to form fields, polls, then pins with cover", async () => {
    statuses = [video.processing, video.processing, video.succeeded];
    const { out, stages, waits } = await run(input({ media: [mp4] }));
    expect(stages).toEqual([
      "video_status",
      "video_status",
      "video_status",
      "video_pin",
    ]);
    expect(waits[0]).toBe(5_000);
    expect(out.result).toMatchObject({ ok: true, platformPostId: "pin-1" });
    const fd = seen.up[0];
    expect(fd.get("key")).toBe("videos/med-1");
    expect(fd.get("policy")).toBe("fake-policy");
    expect(fd.get("file")).toBeInstanceOf(Blob);
    expect(seen.pins[0].media_source).toEqual({
      source_type: "video_id",
      media_id: "med-1",
      cover_image_url: mp4.thumbnailUrl,
    });
  });
  it("video poll past the deadline: media_processing_timeout", async () => {
    const e = await err(
      step(
        {
          stage: "video_status",
          data: { media_id: "med-1", poll_until: "2020-01-01T00:00:00Z" },
        },
        input({ media: [mp4] }),
      ),
    );
    expect(e.code).toBe("media_processing_timeout");
    expect(e.kind).toBe("permanent");
  });
  it("video status failed: permanent", async () => {
    statuses = [video.failed];
    const e = await err(
      step(
        {
          stage: "video_status",
          data: {
            media_id: "med-1",
            poll_until: new Date(Date.now() + 60_000).toISOString(),
          },
        },
        input({ media: [mp4] }),
      ),
    );
    expect(e).toMatchObject({ code: "media_failed", kind: "permanent" });
  });
  it("429 is retryable with the reset header", async () => {
    pinReply = () =>
      new HttpResponse("{}", {
        status: 429,
        headers: { "x-ratelimit-reset": "30" },
      });
    const e = await err(step(start, input()));
    expect(e).toMatchObject({
      code: "rate_limited",
      kind: "retryable",
      retryAfterMs: 30_000,
    });
  });
  it("401 maps to auth", async () => {
    pinReply = () =>
      HttpResponse.json({ code: 2, message: "bad token" }, { status: 401 });
    const e = await err(step(start, input()));
    expect(e).toMatchObject({ code: "account_reauth_required", kind: "auth" });
  });
  it("create pin 5xx, network error, 200 without id: post_outcome_unknown", async () => {
    for (const reply of [
      () => new HttpResponse("{}", { status: 503 }),
      () => HttpResponse.error(),
      () => HttpResponse.json({}, { status: 200 }),
    ]) {
      pinReply = reply;
      const e = await err(step(start, input()));
      expect(e.code).toBe("post_outcome_unknown");
      expect(e.kind).toBe("permanent");
    }
  });
  it("4xx text: urls cut, secrets redacted, capped at 300", async () => {
    pinReply = () =>
      HttpResponse.json(
        {
          message: `see https://x.example/p?t=1 Bearer abcdef ${"z".repeat(400)}`,
        },
        { status: 400 },
      );
    const e = await err(step(start, input()));
    expect(e.code).toBe("http_400");
    expect(e.message).toContain("[url]");
    expect(e.message).not.toContain("x.example");
    expect(e.message).not.toContain("abcdef");
    expect(e.message.length).toBeLessThan(360);
  });
  it("redirect is not followed", async () => {
    pinReply = () =>
      new HttpResponse(null, {
        status: 302,
        headers: { location: "https://evil.example/" },
      });
    const e = await err(step(start, input()));
    expect(e.code).toBe("http_302");
  });
  it("sandbox env switches the base URL", async () => {
    process.env.PINTEREST_ENV = "sandbox";
    let sandboxHits = 0;
    server.use(
      http.post(`${S}/pins`, () => {
        sandboxHits++;
        return HttpResponse.json(pin, { status: 201 });
      }),
    );
    const { out } = await run(input());
    expect(out.result).toMatchObject({ ok: true });
    expect(sandboxHits).toBe(1);
    expect(seen.pins).toEqual([]); // the prod pins handler was not hit
  });
  it("PINTEREST_ENV is trimmed and lowercased; unknown value throws", async () => {
    process.env.PINTEREST_ENV = " Production ";
    expect((await run(input())).out.result).toMatchObject({ ok: true });
    process.env.PINTEREST_ENV = "staging";
    const e = await err(step(start, input()));
    expect(e).toMatchObject({ code: "config_error", kind: "permanent" });
  });
  it("account api_env wins over an unset secret", async () => {
    delete process.env.PINTEREST_ENV;
    server.use(
      http.post(`${S}/pins`, () => HttpResponse.json(pin, { status: 201 })),
    );
    const { out } = await run(
      input({
        account: { platformUserId: "u", platformData: { api_env: "sandbox" } },
      }),
    );
    expect(out.result).toMatchObject({ ok: true });
    expect(seen.pins).toEqual([]);
  });
  it("no board_id: publishes to the board picked at connect", async () => {
    await run(
      input({
        config: {},
        account: {
          platformUserId: "u",
          platformData: { target: { id: "b-9" } },
        },
      }),
    );
    expect(seen.pins[0].board_id).toBe("b-9");
  });
  it("poll_until that is not a date: bad_state", async () => {
    const e = await err(
      step(
        { stage: "video_status", data: { media_id: "med-1", poll_until: "x" } },
        input({ media: [mp4] }),
      ),
    );
    expect(e).toMatchObject({ code: "bad_state", kind: "permanent" });
  });
});

describe("pinterest oauth and targets", () => {
  it("auth url carries scopes", async () => {
    const { url } = await pinterestAdapter.getAuthUrl({
      state: "s1",
      redirectUri: "https://app.example/cb",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.pinterest.com/oauth/");
    expect(u.searchParams.get("scope")).toBe(
      "boards:read boards:write pins:read pins:write user_accounts:read",
    );
    expect(u.searchParams.get("client_id")).toBe("pid");
  });
  it("exchange uses Basic auth, continuous_refresh; 60 day refresh expiry", async () => {
    const t = await pinterestAdapter.exchangeCode({
      code: "c1",
      redirectUri: "https://app.example/cb",
    });
    expect(seen.auth[0]).toBe(
      `Basic ${Buffer.from("pid:psecret").toString("base64")}`,
    );
    expect(seen.pins[0]).toMatchObject({
      grant_type: "authorization_code",
      continuous_refresh: "true",
    });
    expect(t.accessToken).toBe("pina_fake_access");
    expect(t.platformData).toEqual({ api_env: "production" });
    expect(t.scopes).toContain("pins:write");
    expect(
      Date.parse(t.refreshExpiresAt as string) - Date.now(),
    ).toBeGreaterThan(59 * 86_400_000);
  });
  it("refresh stores the new refresh token; none means reauth", async () => {
    const t = await pinterestAdapter.refreshToken({
      accessToken: "old",
      refreshToken: "pinr_old",
      scopes: [],
    });
    expect(seen.pins[0]).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "pinr_old",
    });
    expect(t.refreshToken).toBe("pinr_fake_refresh");
    expect(
      Date.parse(t.refreshExpiresAt as string) - Date.now(),
    ).toBeGreaterThan(59 * 86_400_000);
    server.use(
      http.post(`${A}/oauth/token`, () =>
        HttpResponse.json({ access_token: "a2", expires_in: 100 }),
      ),
    );
    const kept = await pinterestAdapter.refreshToken({
      accessToken: "old",
      refreshToken: "pinr_old",
      scopes: [],
    });
    expect(kept.refreshToken).toBe("pinr_old");
    const e = await err(
      pinterestAdapter.refreshToken({ accessToken: "x", scopes: [] }),
    );
    expect(e.kind).toBe("auth");
  });
  it("listTargets pages through empty pages and returns boards only", async () => {
    const r = await pinterestAdapter.listTargets?.(tokens);
    expect(r).toEqual([
      { id: "b-1", kind: "board", name: "Recipes" },
      { id: "b-2", kind: "board", name: "Travel" },
    ]);
    expect(boardCalls.map((u) => u.searchParams.get("page_size"))).toEqual([
      "250",
      "250",
      "250",
    ]);
    expect(JSON.stringify(r)).not.toContain("pina-secret");
  });
  it("getProfile uses id, keeps username; falls back to username", async () => {
    server.use(
      http.get(`${A}/user_account`, () =>
        HttpResponse.json({ id: "u-77", username: "alice" }),
      ),
    );
    expect(await pinterestAdapter.getProfile(tokens)).toMatchObject({
      platformUserId: "u-77",
      username: "alice",
      displayName: "alice",
    });
    server.resetHandlers();
    expect(await pinterestAdapter.getProfile(tokens)).toMatchObject({
      platformUserId: "alice",
      username: "alice",
    });
  });
});
