import { randomBytes } from "node:crypto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import sharp from "sharp";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("node:dns", () => ({
  promises: {
    lookup: async (h: string) => [
      {
        address: h === "internal.example.com" ? "10.0.0.5" : "93.184.216.34",
        family: 4,
      },
    ],
  },
}));

import { blueskyAdapter, postUrl } from "../lib/platforms/bluesky/adapter";
import {
  loginWithAppPassword,
  refreshAppPasswordSession,
  resolvePds,
} from "../lib/platforms/bluesky/app-password";
import { buildFacets } from "../lib/platforms/bluesky/facets";
import createRecord from "../lib/platforms/bluesky/fixtures/create-record.json";
import createSession from "../lib/platforms/bluesky/fixtures/create-session.json";
import didDoc from "../lib/platforms/bluesky/fixtures/did-doc.json";
import jobDone from "../lib/platforms/bluesky/fixtures/job-status-completed.json";
import profile from "../lib/platforms/bluesky/fixtures/profile.json";
import resolveHandle from "../lib/platforms/bluesky/fixtures/resolve-handle.json";
import uploadBlob from "../lib/platforms/bluesky/fixtures/upload-blob.json";
import uploadVideo from "../lib/platforms/bluesky/fixtures/upload-video.json";
import { validatePost } from "../lib/platforms/bluesky/rules";
import { tidFor } from "../lib/platforms/bluesky/tid";
import {
  PublishError,
  type PublishInput,
  type TokenSet,
} from "../lib/platforms/types";

const PDS = "https://pds.example.com";
const family = "👨‍👩‍👧‍👧";
const seen: { blobs: number[]; records: Record<string, unknown>[] } = {
  blobs: [],
  records: [],
};

const server = setupServer(
  http.get("https://plc.directory/did:plc:abc123", () =>
    HttpResponse.json(didDoc),
  ),
  http.get(
    "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle",
    () => HttpResponse.json(resolveHandle),
  ),
  http.get("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile", () =>
    HttpResponse.json(profile),
  ),
  http.post(
    `${PDS}/xrpc/com.atproto.server.createSession`,
    async ({ request }) => {
      const b = (await request.json()) as { password: string };
      if (b.password !== "good-good-good-good")
        return HttpResponse.json(
          {
            error: "AuthenticationRequired",
            message: "Invalid identifier or password",
          },
          { status: 401 },
        );
      return HttpResponse.json(createSession);
    },
  ),
  http.post(`${PDS}/xrpc/com.atproto.server.refreshSession`, () =>
    HttpResponse.json(createSession),
  ),
  http.post(`${PDS}/xrpc/com.atproto.repo.uploadBlob`, async ({ request }) => {
    seen.blobs.push((await request.arrayBuffer()).byteLength);
    return HttpResponse.json(uploadBlob);
  }),
  http.post(
    `${PDS}/xrpc/com.atproto.repo.createRecord`,
    async ({ request }) => {
      const b = (await request.json()) as { record: Record<string, unknown> };
      seen.records.push(b.record);
      return HttpResponse.json(createRecord);
    },
  ),
  http.get(`${PDS}/xrpc/com.atproto.server.getServiceAuth`, () =>
    HttpResponse.json({ token: "service-token" }),
  ),
  http.post("https://video.bsky.app/xrpc/app.bsky.video.uploadVideo", () =>
    HttpResponse.json(uploadVideo),
  ),
  http.get("https://video.bsky.app/xrpc/app.bsky.video.getJobStatus", () =>
    HttpResponse.json(jobDone),
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen.blobs = [];
  seen.records = [];
});
afterAll(() => server.close());

const tokens: TokenSet = {
  accessToken: "access",
  refreshToken: "refresh",
  scopes: ["app_password"],
  platformData: { auth: "app_password", did: "did:plc:abc123" },
};
const input = (p: Partial<PublishInput> = {}): PublishInput => ({
  caption: "hello",
  media: [],
  config: {},
  account: { platformUserId: "did:plc:abc123", platformData: {} },
  ...p,
});
const noRange = async () => new Uint8Array();
const start = { stage: "start", data: {} };

describe("bluesky rules", () => {
  it("300 graphemes with joined emoji pass, 301 fail", () => {
    const ok = family.repeat(3) + "a".repeat(297);
    // 300 graphemes, but 3*25 + 297 = 372 bytes: fine
    expect(validatePost(input({ caption: ok }))).toEqual([]);
    const v = validatePost(input({ caption: `${ok}a` }));
    expect(v.map((x) => x.code)).toEqual(["caption_too_long"]);
  });
  it("3001 bytes fail even under 300 graphemes", () => {
    const v = validatePost(input({ caption: "€".repeat(1001) })); // 3003 bytes, 1001 graphemes
    expect(v.map((x) => x.code)).toContain("caption_too_many_bytes");
    expect(
      validatePost(input({ caption: "€".repeat(300) + "a".repeat(0) })),
    ).toEqual([]);
    const only = validatePost(input({ caption: "😀".repeat(300) })); // 1200 bytes
    expect(only).toEqual([]);
  });
  it("rejects 5 images and mixed media", () => {
    const img = { mediaId: "i", signedUrl: "", mime: "image/png", bytes: 1 };
    const vid = { mediaId: "v", signedUrl: "", mime: "video/mp4", bytes: 1 };
    expect(
      validatePost(input({ media: Array(5).fill(img) })).map((x) => x.code),
    ).toContain("too_many_media");
    expect(
      validatePost(input({ media: [img, vid] })).map((x) => x.code),
    ).toContain("mixed_media");
  });
});

describe("bluesky facets", () => {
  it("uses UTF-8 byte offsets with an emoji before a link", async () => {
    const text = `${family} see https://example.com/a. #tag @alice.example.com`;
    const f = await buildFacets(text, async () => "did:plc:abc123");
    const bytes = Buffer.from(text);
    const slice = (i: { byteStart: number; byteEnd: number }) =>
      bytes.subarray(i.byteStart, i.byteEnd).toString();
    expect(f.map((x) => slice(x.index))).toEqual([
      "https://example.com/a",
      "#tag",
      "@alice.example.com",
    ]);
    expect(f[0].index.byteStart).toBe(25 + 5);
  });
  it("skips a mention that does not resolve", async () => {
    expect(
      await buildFacets("hi @nobody.example.com", async () => null),
    ).toEqual([]);
  });
});

describe("bluesky adapter", () => {
  it("builds the post URL from the record URI", () => {
    expect(postUrl(createRecord.uri)).toBe(
      "https://bsky.app/profile/did:plc:abc123/post/3kfakerkey22",
    );
  });

  it("publishes text in one call to the user's own PDS", async () => {
    const out = await blueskyAdapter.publishStep(
      start,
      input({ caption: "hi https://example.com" }),
      tokens,
      noRange,
    );
    expect(out).toMatchObject({
      result: {
        ok: true,
        platformPostUrl:
          "https://bsky.app/profile/did:plc:abc123/post/3kfakerkey22",
        meta: { hasUrl: true },
      },
    });
    expect(seen.records[0].text).toBe("hi https://example.com");
  });

  it("resizes a 1.5 MB image under 1,000,000 bytes and uploads it", async () => {
    const big = new Uint8Array(
      await sharp(randomBytes(1000 * 700 * 3), {
        raw: { width: 1000, height: 700, channels: 3 },
      })
        .png()
        .toBuffer(),
    );
    expect(big.length).toBeGreaterThan(1_500_000);
    const out = await blueskyAdapter.publishStep(
      start,
      input({
        media: [
          {
            mediaId: "m",
            signedUrl: "",
            mime: "image/png",
            bytes: big.length,
            altText: "noise",
          },
        ],
      }),
      tokens,
      async () => big,
    );
    expect("result" in out && out.result.ok).toBe(true);
    expect(seen.blobs).toHaveLength(1);
    expect(seen.blobs[0]).toBeLessThan(1_000_000);
    const embed = seen.records[0].embed as { images: { alt: string }[] };
    expect(embed.images[0].alt).toBe("noise");
  });

  it("video: upload job, then poll, then post", async () => {
    const media = [
      {
        mediaId: "v",
        signedUrl: "",
        mime: "video/mp4",
        bytes: 4,
        durationMs: 5000,
      },
    ];
    const first = await blueskyAdapter.publishStep(
      start,
      input({ media }),
      tokens,
      async () => new Uint8Array(4),
    );
    expect(first).toMatchObject({
      next: { stage: "processing", data: { job_id: "job-1" } },
      waitMs: 3000,
    });
    if (!("next" in first)) throw new Error("expected next");
    const second = await blueskyAdapter.publishStep(
      first.next,
      input({ media }),
      tokens,
      noRange,
    );
    expect(second).toMatchObject({ result: { ok: true } });
    expect((seen.records[0].embed as { $type: string }).$type).toBe(
      "app.bsky.embed.video",
    );
  });

  it("429 is retryable with the reset header", async () => {
    server.use(
      http.post(`${PDS}/xrpc/com.atproto.repo.createRecord`, () =>
        HttpResponse.json(
          { error: "RateLimitExceeded" },
          {
            status: 429,
            headers: {
              "ratelimit-reset": String(Math.floor(Date.now() / 1000) + 120),
            },
          },
        ),
      ),
    );
    const err = await blueskyAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.kind).toBe("retryable");
    expect(err.retryAfterMs).toBeGreaterThan(100_000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(120_000);
  });
});

describe("bluesky app password", () => {
  const f = (...a: Parameters<typeof fetch>) => fetch(...a);
  it("logs in, stores no secret in platformData, then posts", async () => {
    const t = await loginWithAppPassword(f, {
      handle: "@Alice.example.com",
      appPassword: "good-good-good-good",
    });
    expect(t.platformData).toEqual({
      auth: "app_password",
      did: "did:plc:abc123",
      pds_url: PDS,
    });
    expect(JSON.stringify(t.platformData)).not.toContain(t.accessToken);
    expect(t.expiresAt).toBe("2100-01-01T00:00:00.000Z");
    expect(await blueskyAdapter.getProfile(t)).toMatchObject({
      platformUserId: "did:plc:abc123",
      username: "alice.example.com",
    });
    const out = await blueskyAdapter.publishStep(start, input(), t, noRange);
    expect("result" in out && out.result.ok).toBe(true);
    const r = await refreshAppPasswordSession(f, t);
    expect(r.refreshToken).toBe(createSession.refreshJwt);
  });

  it("wrong app password is an auth error without the password in it", async () => {
    const err = await loginWithAppPassword(f, {
      handle: "alice.example.com",
      appPassword: "bad-bad-bad-bad",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.kind).toBe("auth");
    expect(JSON.stringify(err)).not.toContain("bad-bad");
    expect(err.message).not.toContain("bad-bad");
  });
});

const spyFetch = () => {
  const urls: string[] = [];
  const f = (...a: Parameters<typeof fetch>) => {
    urls.push(String(a[0] instanceof Request ? a[0].url : a[0]));
    return fetch(...a);
  };
  return { f, urls };
};
const didWeb = (host: string, ep: string) =>
  http.get(`https://${host}/.well-known/did.json`, () =>
    HttpResponse.json({
      service: [{ id: "#atproto_pds", serviceEndpoint: ep }],
    }),
  );

describe("bluesky SSRF guard", () => {
  it.each([
    ["did:web:localhost"],
    ["did:web:127.0.0.1"],
    ["did:web:internal.example.com"],
  ])("refuses %s without fetching it", async (did) => {
    const { f, urls } = spyFetch();
    const err = await resolvePds(f, did).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.code).toBe("pds_not_public");
    expect(err.kind).toBe("permanent");
    expect(urls).toEqual([]);
  });

  it.each([
    ["http://127.0.0.1"],
    ["https://169.254.169.254"],
    ["https://internal.example.com"],
  ])("refuses a DID doc that points the PDS at %s", async (ep) => {
    server.use(didWeb("evil.example.com", ep));
    const { f, urls } = spyFetch();
    const err = await resolvePds(f, "did:web:evil.example.com").catch((e) => e);
    expect(err.code).toBe("pds_not_public");
    expect(urls).toEqual(["https://evil.example.com/.well-known/did.json"]);
  });

  it("does not send the app password to a private PDS", async () => {
    server.use(didWeb("evil.example.com", "https://169.254.169.254"));
    const { f, urls } = spyFetch();
    const err = await loginWithAppPassword(f, {
      handle: "did:web:evil.example.com",
      appPassword: "x",
    }).catch((e) => e);
    expect(err.code).toBe("pds_not_public");
    expect(urls.some((u) => u.includes("169.254"))).toBe(false);
  });

  it("rejects an IP or localhost handle", async () => {
    for (const handle of ["localhost", "127.0.0.1"]) {
      const err = await loginWithAppPassword(fetch, {
        handle,
        appPassword: "x",
      }).catch((e) => e);
      expect(err.code).toBe("bad_handle");
    }
  });

  it("re-checks the PDS on every publish call", async () => {
    server.use(didWeb("evil.example.com", "https://169.254.169.254"));
    const err = await blueskyAdapter
      .publishStep(
        start,
        input({
          account: {
            platformUserId: "did:web:evil.example.com",
            platformData: { pds_url: PDS },
          },
        }),
        tokens,
        noRange,
      )
      .catch((e) => e);
    expect(err.code).toBe("pds_not_public");
  });
});

describe("bluesky idempotent rkey", () => {
  it("TID is 13 valid base32-sortable chars and stable per target", () => {
    const t = tidFor("target-1", "2026-10-29T10:00:00.123456Z");
    expect(t).toMatch(
      /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/,
    );
    expect(tidFor("target-1", "2026-10-29T10:00:00.123456Z")).toBe(t);
    expect(tidFor("target-2", "2026-10-29T10:00:00.123456Z")).not.toBe(t);
  });

  it("a retry after success returns the same URL and no second record", async () => {
    const store = new Map<string, unknown>();
    server.use(
      http.post(
        `${PDS}/xrpc/com.atproto.repo.createRecord`,
        async ({ request }) => {
          const b = (await request.json()) as { rkey: string; record: unknown };
          if (store.has(b.rkey))
            return HttpResponse.json(
              { error: "InvalidRequest", message: "Record already exists" },
              { status: 400 },
            );
          store.set(b.rkey, b.record);
          return HttpResponse.json({
            uri: `at://did:plc:abc123/app.bsky.feed.post/${b.rkey}`,
            cid: "c",
          });
        },
      ),
      http.get(`${PDS}/xrpc/com.atproto.repo.getRecord`, ({ request }) => {
        const rkey = new URL(request.url).searchParams.get("rkey") ?? "";
        return HttpResponse.json({
          uri: `at://did:plc:abc123/app.bsky.feed.post/${rkey}`,
          cid: "c",
          value: { text: "hello" },
        });
      }),
    );
    const i = input({
      target: { id: "target-1", createdAt: "2026-10-29T10:00:00.123Z" },
    });
    const a = await blueskyAdapter.publishStep(start, i, tokens, noRange);
    const b = await blueskyAdapter.publishStep(start, i, tokens, noRange);
    expect(store.size).toBe(1);
    expect(b).toEqual(a);
    expect("result" in a && a.result.ok && a.result.platformPostUrl).toContain(
      `/post/${tidFor("target-1", "2026-10-29T10:00:00.123Z")}`,
    );
  });
});

describe("bluesky review fixes", () => {
  it("blocks a redirect from the PDS and never calls the second host", async () => {
    let hit = false;
    server.use(
      http.post(`${PDS}/xrpc/com.atproto.server.createSession`, () =>
        HttpResponse.text("", {
          status: 307,
          headers: { location: "http://169.254.169.254/" },
        }),
      ),
      http.all("http://169.254.169.254/*", () => {
        hit = true;
        return HttpResponse.json({});
      }),
    );
    const err = await loginWithAppPassword((...a) => fetch(...a), {
      handle: "alice.example.com",
      appPassword: "good-good-good-good",
    }).catch((e) => e);
    expect(err).toMatchObject({ code: "redirect_blocked", kind: "permanent" });
    expect(hit).toBe(false);
  });

  it("two targets with the same createdAt get different valid rkeys", () => {
    const at = "2026-10-29T10:00:00.000Z";
    const a = tidFor("target-1", at);
    const b = tidFor("target-2", at);
    expect(a).not.toBe(b);
    for (const k of [a, b]) expect(k).toMatch(/^[2-b][2-7a-z]{12}$/);
    expect(tidFor("target-1", at)).toBe(a);
  });

  const target = { id: "t1", createdAt: "2026-10-29T10:00:00.000Z" };
  const dupHandlers = (text: string) => [
    http.post(`${PDS}/xrpc/com.atproto.repo.createRecord`, () =>
      HttpResponse.json({ error: "RecordAlreadyExists" }, { status: 400 }),
    ),
    http.get(`${PDS}/xrpc/com.atproto.repo.getRecord`, () =>
      HttpResponse.json({ ...createRecord, value: { text } }),
    ),
  ];
  it("duplicate rkey with the same text returns the existing post", async () => {
    server.use(...dupHandlers("hello"));
    const out = await blueskyAdapter.publishStep(
      start,
      input({ target }),
      tokens,
      noRange,
    );
    expect("result" in out && out.result.ok).toBe(true);
  });
  it("duplicate rkey with other text fails with rkey_conflict", async () => {
    server.use(...dupHandlers("someone else"));
    const err = await blueskyAdapter
      .publishStep(start, input({ target }), tokens, noRange)
      .catch((e) => e);
    expect(err).toMatchObject({ code: "rkey_conflict", kind: "permanent" });
  });

  it("does not copy platform error text into PublishError", async () => {
    server.use(
      http.post(`${PDS}/xrpc/com.atproto.repo.createRecord`, () =>
        HttpResponse.json(
          { error: "EvilCode<script>", message: "EVIL-MESSAGE" },
          { status: 400 },
        ),
      ),
    );
    const err = await blueskyAdapter
      .publishStep(start, input(), tokens, noRange)
      .catch((e) => e);
    expect(err.code).toBe("http_400");
    expect(JSON.stringify(err) + err.message).not.toContain("EVIL");
  });

  it("skips a tag longer than 64 graphemes", async () => {
    const f = await buildFacets(
      `#${"a".repeat(65)} #${"b".repeat(64)}`,
      async () => null,
    );
    expect(f).toHaveLength(1);
  });
});
