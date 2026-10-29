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
  vi,
} from "vitest";
import type {
  MediaInfo,
  PublishError,
  PublishInput,
  PublishState,
  TokenSet,
} from "../lib/platforms/types";
import { youtubeAdapter } from "../lib/platforms/youtube/adapter";
import channels from "../lib/platforms/youtube/fixtures/channels.json";
import token from "../lib/platforms/youtube/fixtures/token.json";
import video from "../lib/platforms/youtube/fixtures/video.json"; // UNRECORDED
import { validatePost } from "../lib/platforms/youtube/rules";
import { msToNextMidnight } from "../lib/publish/quota-day";

const START = "https://www.googleapis.com/upload/youtube/v3/videos";
const SESSION =
  "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=sess-1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MB8 = 8 * 1024 * 1024;

type Put = { range: string | null; auth: string | null; len: number };
let starts: { body: Record<string, unknown>; headers: Headers }[] = [];
let puts: Put[] = [];
let startReply: () => Response = () =>
  new HttpResponse(null, { status: 200, headers: { location: SESSION } });
let putReplies: (() => Response)[] = [];
const created = () => HttpResponse.json(video, { status: 201 });

const server = setupServer(
  http.post(START, async ({ request }) => {
    starts.push({
      body: (await request.json()) as Record<string, unknown>,
      headers: request.headers,
    });
    return startReply();
  }),
  http.put(START, async ({ request }) => {
    expect(new URL(request.url).searchParams.get("upload_id")).toBe("sess-1");
    puts.push({
      range: request.headers.get("content-range"),
      auth: request.headers.get("authorization"),
      len: (await request.arrayBuffer()).byteLength,
    });
    return (putReplies.shift() ?? created)();
  }),
  http.post(TOKEN_URL, async ({ request }) => {
    starts.push({
      body: Object.fromEntries(new URLSearchParams(await request.text())),
      headers: request.headers,
    });
    return HttpResponse.json(token);
  }),
  http.get("https://www.googleapis.com/youtube/v3/channels", ({ request }) => {
    expect(new URL(request.url).searchParams.get("mine")).toBe("true");
    return HttpResponse.json(channels);
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "gid";
  process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  process.env.SECRETS_SOURCE = "env";
});
afterEach(() => {
  server.resetHandlers();
  starts = [];
  puts = [];
  putReplies = [];
  startReply = () =>
    new HttpResponse(null, { status: 200, headers: { location: SESSION } });
  vi.useRealTimers();
});
afterAll(() => server.close());

const tokens: TokenSet = { accessToken: "goog-secret-1", scopes: [] };
const start: PublishState = { stage: "start", data: {} };
const media = (bytes: number, mime = "video/mp4"): MediaInfo => ({
  mediaId: "m1",
  signedUrl: "https://example.com/m?sig=abc",
  mime,
  bytes,
});
const input = (o: Partial<PublishInput> = {}): PublishInput => ({
  caption: "hello",
  media: [media(10)],
  config: { title: "T", made_for_kids: false },
  account: { platformUserId: "UC1", platformData: {} },
  ...o,
});
const range = async (_: string, s: number, e: number) =>
  new Uint8Array(e - s + 1);
const codes = (i: PublishInput) => validatePost(i).map((v) => v.code);
const step = (s: PublishState, i: PublishInput) =>
  youtubeAdapter.publishStep(s, i, tokens, range);
const r308 = (rangeHeader?: string) => () =>
  new HttpResponse(null, {
    status: 308,
    headers: rangeHeader ? { range: rangeHeader } : {},
  });
const lost = () => HttpResponse.error();

async function run(i: PublishInput, from: PublishState = start) {
  const stages: string[] = [];
  const waits: (number | undefined)[] = [];
  let state = from;
  for (let k = 0; k < 40; k++) {
    const out = await step(state, i);
    if ("result" in out) return { out, stages, waits };
    stages.push(out.next.stage);
    waits.push(out.waitMs);
    const j = JSON.stringify(out.next);
    for (const bad of ["goog-secret-1", "sig=abc", "gsecret"])
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

describe("youtube rules", () => {
  it("made_for_kids is required", () => {
    expect(codes(input({ config: { title: "T" } }))).toContain(
      "made_for_kids_required",
    );
    expect(
      codes(input({ config: { title: "T", made_for_kids: true } })),
    ).toEqual([]);
    expect(codes(input())).toEqual([]);
  });
  it("title is required and max 100", () => {
    const c = (title: string) =>
      codes(input({ config: { title, made_for_kids: false } }));
    expect(c("")).toContain("title_required");
    expect(c("a".repeat(100))).toEqual([]);
    expect(c("a".repeat(101))).toContain("title_too_long");
    expect(c("a<b")).toContain("title_invalid_chars");
  });
  it("description counts bytes, not characters", () => {
    // each "é" is 2 bytes in UTF-8: 2500 of them = 5000 bytes, 2501 = 5002
    expect(codes(input({ caption: "é".repeat(2500) }))).toEqual([]);
    expect(codes(input({ caption: "é".repeat(2501) }))).toContain(
      "description_too_long",
    );
    expect(codes(input({ caption: `${"a".repeat(5000)}b` }))).toContain(
      "description_too_long",
    );
    const cfg = {
      title: "T",
      made_for_kids: false,
      description: "é".repeat(2501),
    };
    expect(codes(input({ config: cfg }))).toContain("description_too_long");
  });
  it("tags max 500 characters in total", () => {
    const c = (tags: string[]) =>
      codes(input({ config: { title: "T", made_for_kids: false, tags } }));
    expect(c(["a".repeat(500)])).toEqual([]);
    expect(c(["a".repeat(250), "b".repeat(250)])).toContain("tags_too_long"); // the comma counts
    expect(c(["a b".repeat(1), "c".repeat(498)])).toContain("tags_too_long");
  });
  it("one video only; images rejected", () => {
    expect(codes(input({ media: [] }))).toContain("media_required");
    expect(codes(input({ media: [media(1), media(1)] }))).toContain(
      "too_many_media",
    );
    expect(codes(input({ media: [media(1, "image/png")] }))).toContain(
      "unsupported_media",
    );
    expect(codes(input({ media: [media(256 * 1024 ** 3 + 1)] }))).toContain(
      "video_too_large",
    );
  });
  it("config schema is strict and checks privacy_status", () => {
    const s = youtubeAdapter.configSchema;
    expect(s.safeParse({ privacy_status: "secret" }).success).toBe(false);
    expect(s.safeParse({ nope: 1 }).success).toBe(false);
    expect(
      s.safeParse({ privacy_status: "unlisted", tags: ["a"] }).success,
    ).toBe(true);
  });
  it("quota rule: 100 per day, project, Pacific", () => {
    expect(youtubeAdapter.quota).toMatchObject({
      scope: "project",
      dailyCap: 100,
      timeZone: "America/Los_Angeles",
    });
  });
});

describe("youtube publish", () => {
  it("small video: session, one chunk, success with the watch URL", async () => {
    const { out, stages } = await run(
      input({
        config: {
          title: "T",
          made_for_kids: true,
          tags: ["a"],
          contains_synthetic_media: true,
        },
      }),
    );
    expect(stages).toEqual(["upload"]);
    expect(out.result).toMatchObject({
      ok: true,
      platformPostId: "vid123",
      platformPostUrl: "https://www.youtube.com/watch?v=vid123",
    });
    expect(starts[0].body).toEqual({
      snippet: { title: "T", description: "hello", tags: ["a"] },
      status: {
        privacyStatus: "private", // not sent by the user: never public by guess
        selfDeclaredMadeForKids: true,
        containsSyntheticMedia: true,
      },
    });
    expect(starts[0].headers.get("x-upload-content-length")).toBe("10");
    expect(starts[0].headers.get("authorization")).toBe("Bearer goog-secret-1");
    expect(puts).toEqual([
      { range: "bytes 0-9/10", auth: "Bearer goog-secret-1", len: 10 },
    ]);
  });
  it("308 with Range bytes=0-8388607 resumes at 8388608", async () => {
    const total = 20_000_000;
    putReplies = [r308("bytes=0-8388607"), r308("bytes=0-16777215")];
    const { out, stages } = await run(input({ media: [media(total)] }));
    expect(stages).toEqual(["upload", "upload", "upload"]);
    expect(puts.map((p) => p.range)).toEqual([
      `bytes 0-${MB8 - 1}/${total}`,
      `bytes ${MB8}-${2 * MB8 - 1}/${total}`,
      `bytes ${2 * MB8}-${total - 1}/${total}`,
    ]);
    expect(out.result).toMatchObject({ ok: true });
  });
  it("308 without Range means nothing arrived: offset 0", async () => {
    putReplies = [r308()];
    await run(input({ media: [media(20_000_000)] }));
    expect(puts.map((p) => p.range?.split("/")[0])).toEqual([
      `bytes 0-${MB8 - 1}`,
      `bytes 0-${MB8 - 1}`,
    ]);
  });
  it("a server that never advances is stopped", async () => {
    putReplies = Array.from({ length: 10 }, () => r308());
    const e = await err(run(input({ media: [media(20_000_000)] })));
    expect(e.code).toBe("upload_stalled");
  });
  it("network error mid-upload: status query, then resume, no new session", async () => {
    const total = 20_000_000;
    putReplies = [
      r308("bytes=0-8388607"),
      lost,
      r308("bytes=0-8388607"), // the status answer
      r308("bytes=0-16777215"),
    ];
    const { out, stages, waits } = await run(input({ media: [media(total)] }));
    expect(stages).toEqual(["upload", "upload", "status", "upload", "upload"]);
    expect(waits[2]).toBeGreaterThan(0);
    expect(starts).toHaveLength(1);
    expect(puts.map((p) => p.range)).toEqual([
      `bytes 0-${MB8 - 1}/${total}`,
      `bytes ${MB8}-${2 * MB8 - 1}/${total}`,
      `bytes */${total}`,
      `bytes ${MB8}-${2 * MB8 - 1}/${total}`,
      `bytes ${2 * MB8}-${total - 1}/${total}`,
    ]);
    expect(puts[2].len).toBe(0);
    expect(out.result).toMatchObject({ ok: true });
  });
  it("final chunk lost, status says 200: success with the id", async () => {
    putReplies = [lost, () => HttpResponse.json(video, { status: 200 })];
    const { out, stages } = await run(input());
    expect(stages).toEqual(["upload", "status"]);
    expect(starts).toHaveLength(1);
    expect(out.result).toMatchObject({ ok: true, platformPostId: "vid123" });
  });
  it("503 on a chunk is handled like a lost response", async () => {
    putReplies = [
      () =>
        new HttpResponse(null, {
          status: 503,
          headers: { "retry-after": "7" },
        }),
      r308(),
    ];
    const out = await step(
      { stage: "upload", data: { session: SESSION, offset: 0 } },
      input(),
    );
    expect(out).toMatchObject({ next: { stage: "status" }, waitMs: 7000 });
  });
  it("final chunk lost and the status query keeps failing: post_outcome_unknown", async () => {
    putReplies = Array.from({ length: 10 }, () => lost);
    const e = await err(run(input()));
    expect(e).toMatchObject({
      code: "post_outcome_unknown",
      kind: "permanent",
    });
  });
  it("non-final chunk lost and status keeps failing: retryable", async () => {
    putReplies = Array.from({ length: 10 }, () => lost);
    const e = await err(run(input({ media: [media(20_000_000)] })));
    expect(e).toMatchObject({ code: "network_error", kind: "retryable" });
  });
  it("404 on the session before the last chunk: new session", async () => {
    putReplies = [() => new HttpResponse(null, { status: 404 })];
    const out = await step(
      { stage: "upload", data: { session: SESSION, offset: 0 } },
      input({ media: [media(20_000_000)] }),
    );
    expect(out).toEqual({ next: { stage: "start", data: { restarts: 1 } } });
    const again = await step((out as { next: PublishState }).next, input());
    expect(again).toMatchObject({ next: { stage: "upload" } });
    expect(JSON.stringify(again)).toContain('"restarts":1');
  });
  it("404 after the last chunk was sent: unknown, never a second upload", async () => {
    putReplies = [lost, () => new HttpResponse(null, { status: 404 })];
    const e = await err(run(input()));
    expect(e.code).toBe("post_outcome_unknown");
    expect(starts).toHaveLength(1);
  });
  it("404 too many times: session_expired", async () => {
    putReplies = [() => new HttpResponse(null, { status: 404 })];
    const e = await err(
      step(
        { stage: "upload", data: { session: SESSION, offset: 0, restarts: 2 } },
        input({ media: [media(20_000_000)] }),
      ),
    );
    expect(e.code).toBe("session_expired");
  });
  it("session URI on a foreign host is refused and gets no token", async () => {
    for (const loc of [
      "https://evil.example/upload/x",
      "http://www.googleapis.com/upload/x",
      "https://www.googleapis.com.evil.example/upload/x",
      "https://user@www.googleapis.com/upload/x",
      "https://www.googleapis.com:8443/upload/x",
    ]) {
      startReply = () =>
        new HttpResponse(null, { status: 200, headers: { location: loc } });
      const e = await err(step(start, input()));
      expect(e).toMatchObject({ code: "bad_upload_url", kind: "permanent" });
    }
    // a bad URI already in state is refused too
    const e = await err(
      step(
        {
          stage: "upload",
          data: { session: "https://evil.example/u", offset: 0 },
        },
        input(),
      ),
    );
    expect(e).toMatchObject({ code: "bad_state", kind: "permanent" });
    expect(puts).toEqual([]);
  });
  it("quotaExceeded: retryable until the next Pacific midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T06:00:00Z")); // 23:00 Pacific
    startReply = () =>
      HttpResponse.json(
        {
          error: {
            code: 403,
            message: "x",
            errors: [{ reason: "quotaExceeded" }],
          },
        },
        { status: 403 },
      );
    const e = await err(step(start, input()));
    expect(e).toMatchObject({ code: "quota_exceeded", kind: "retryable" });
    expect(e.retryAfterMs).toBe(3_600_000);
    expect(e.retryAfterMs).toBe(
      msToNextMidnight(new Date(), "America/Los_Angeles"),
    );
  });
  it("uploadLimitExceeded is retryable too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T06:00:00Z"));
    startReply = () =>
      HttpResponse.json(
        { error: { errors: [{ reason: "uploadLimitExceeded" }] } },
        { status: 400 },
      );
    const e = await err(step(start, input()));
    expect(e).toMatchObject({
      code: "upload_limit_exceeded",
      kind: "retryable",
    });
    expect(e.retryAfterMs).toBe(
      msToNextMidnight(new Date(), "America/Los_Angeles"),
    );
  });
  it("401 on start is auth; 500 and 429 are retryable", async () => {
    startReply = () => new HttpResponse(null, { status: 401 });
    expect(await err(step(start, input()))).toMatchObject({
      code: "account_reauth_required",
      kind: "auth",
    });
    startReply = () => new HttpResponse(null, { status: 500 });
    expect(await err(step(start, input()))).toMatchObject({
      code: "http_500",
      kind: "retryable",
    });
    startReply = () => new HttpResponse(null, { status: 429 });
    expect(await err(step(start, input()))).toMatchObject({
      code: "rate_limited",
      kind: "retryable",
    });
  });
  it("401 during upload: one wait so the token can refresh, then auth", async () => {
    putReplies = [() => new HttpResponse(null, { status: 401 })];
    const first = await step(
      { stage: "upload", data: { session: SESSION, offset: 0 } },
      input({ media: [media(20_000_000)] }),
    );
    expect(first).toMatchObject({ next: { stage: "upload" }, waitMs: 1000 });
    putReplies = [() => new HttpResponse(null, { status: 401 })];
    const e = await err(
      step(
        (first as { next: PublishState }).next,
        input({ media: [media(20_000_000)] }),
      ),
    );
    expect(e.kind).toBe("auth");
  });
  it("error text: reason allowlist, URLs cut, redacted, capped", async () => {
    startReply = () =>
      HttpResponse.json(
        {
          error: {
            message: `see https://x.example/p?t=1 Bearer abcdef ${"z".repeat(400)}`,
            errors: [{ reason: "invalidTags" }],
          },
        },
        { status: 400 },
      );
    const e = await err(step(start, input()));
    expect(e.code).toBe("invalidTags");
    expect(e.kind).toBe("permanent");
    expect(e.message).toContain("[url]");
    expect(e.message).not.toContain("x.example");
    expect(e.message).not.toContain("abcdef");
    expect(e.message.length).toBeLessThan(400);
    startReply = () =>
      HttpResponse.json(
        { error: { errors: [{ reason: "<script>" }] } },
        { status: 400 },
      );
    expect((await err(step(start, input()))).code).toBe("http_400");
  });
  it("redirect is not followed", async () => {
    startReply = () =>
      new HttpResponse(null, {
        status: 302,
        headers: { location: "https://evil.example/" },
      });
    expect((await err(step(start, input()))).code).toBe("http_302");
  });
  it("after the last chunk was sent, every other end state is post_outcome_unknown", async () => {
    const cases: [string, Response][] = [
      ["400", new Response(null, { status: 400 })],
      ["403", new Response(null, { status: 403 })],
      ["410", new Response(null, { status: 410 })],
      [
        "quota",
        Response.json(
          { error: { errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        ),
      ],
      ["401 again", new Response(null, { status: 401 })],
    ];
    for (const [name, res] of cases) {
      putReplies = [() => res.clone() as Response];
      const e = await err(
        step(
          {
            stage: "upload",
            data: { session: SESSION, offset: 0, auth_retry: 1, probed: true },
          },
          input(),
        ),
      );
      expect([name, e.code, e.kind]).toEqual([
        name,
        "post_outcome_unknown",
        "permanent",
      ]);
    }
  });
  it("unexpected 4xx on a chunk: ask for status once, then fail", async () => {
    const total = 20_000_000;
    putReplies = [
      () => new HttpResponse(null, { status: 400 }),
      r308("bytes=0-8388607"),
    ];
    const first = await step(
      { stage: "upload", data: { session: SESSION, offset: 0 } },
      input({ media: [media(total)] }),
    );
    expect(first).toMatchObject({ next: { stage: "status" } });
    const second = await step(
      (first as { next: PublishState }).next,
      input({ media: [media(total)] }),
    );
    expect(second).toMatchObject({ next: { stage: "upload" } });
    expect(puts.map((p) => p.range)).toEqual([
      `bytes 0-${MB8 - 1}/${total}`,
      `bytes */${total}`,
    ]);
    // the flag survives: a second 400 on the chunk is a plain error
    putReplies = [() => new HttpResponse(null, { status: 400 })];
    const e = await err(
      step(
        (second as { next: PublishState }).next,
        input({ media: [media(total)] }),
      ),
    );
    expect(e).toMatchObject({ code: "http_400", kind: "permanent" });
  });
  it("unknown stage: bad_state", async () => {
    expect(await err(step({ stage: "nope", data: {} }, input()))).toMatchObject(
      { code: "bad_state" },
    );
  });
});

describe("youtube oauth", () => {
  it("auth URL: offline, consent, exact scopes", async () => {
    const { url } = await youtubeAdapter.getAuthUrl({
      state: "st",
      redirectUri: "https://app.example/cb",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    );
    expect(u.searchParams.get("client_id")).toBe("gid");
    expect(u.searchParams.get("state")).toBe("st");
  });
  it("exchange code, then refresh keeps the old refresh token when none returned", async () => {
    const t = await youtubeAdapter.exchangeCode({
      code: "c",
      redirectUri: "https://app.example/cb",
    });
    expect(t.refreshToken).toBe(token.refresh_token);
    expect(t.expiresAt).toBeDefined();
    expect(starts[0].body).toMatchObject({
      grant_type: "authorization_code",
      client_secret: "gsecret",
    });
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ access_token: "new-access", expires_in: 3600 }),
      ),
    );
    const r = await youtubeAdapter.refreshToken({
      ...t,
      refreshToken: "keep-me",
    });
    expect(r.accessToken).toBe("new-access");
    expect(r.refreshToken).toBe("keep-me");
    expect(r.scopes).toEqual(t.scopes);
  });
  it("invalid_grant on refresh = account_reauth_required (auth)", async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );
    const e = await err(
      youtubeAdapter.refreshToken({ ...tokens, refreshToken: "r" }),
    );
    expect(e).toMatchObject({ code: "account_reauth_required", kind: "auth" });
    expect(await err(youtubeAdapter.refreshToken({ ...tokens }))).toMatchObject(
      { kind: "auth" },
    );
  });
  it("getProfile: platformUserId is the channel id", async () => {
    expect(await youtubeAdapter.getProfile(tokens)).toEqual({
      platformUserId: "UC_fake_channel",
      username: "@alice",
      displayName: "Alice Channel",
      avatarUrl: "https://yt3.example/a.jpg",
    });
    server.use(
      http.get("https://www.googleapis.com/youtube/v3/channels", () =>
        HttpResponse.json({}),
      ),
    );
    expect((await err(youtubeAdapter.getProfile(tokens))).code).toBe(
      "no_channel",
    );
  });
  it("revoke posts the refresh token to Google", async () => {
    let body = "";
    server.use(
      http.post("https://oauth2.googleapis.com/revoke", async ({ request }) => {
        body = await request.text();
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await youtubeAdapter.revoke({ ...tokens, refreshToken: "rt" });
    expect(body).toBe("token=rt");
  });
});
