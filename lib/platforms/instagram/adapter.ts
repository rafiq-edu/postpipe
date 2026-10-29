import { redact } from "../../log/redact";
import {
  type Json,
  type PlatformAdapter,
  PublishError,
  type PublishInput,
  type PublishState,
  type PublishStepOutcome,
  type TokenSet,
} from "../types";
import {
  API,
  AUTHORIZE_URL,
  appCreds,
  call,
  EXCHANGE_URL,
  type Fetch,
  getWithToken,
  postForm,
  REFRESH_URL,
  TOKEN_URL,
} from "./api";
import { InstagramConfigSchema } from "./config";
import { INSTAGRAM_LIMITS, postKind, validatePost } from "./rules";

// Scopes from instagram.md OAuth: publishing only needs these two.
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
];

const LONG_LIVED_S = 5_183_944; // instagram.md OAuth, Tokens: long-lived 60 days
const REFRESH_WINDOW_MS = 7 * 24 * 3_600_000; // our choice; instagram.md allows refresh once a token is 24 hours old
const POLL_MS = 60_000; // instagram.md Container flow, step 2: poll once a minute
const ERROR_TEXT_CHARS = 300; // our cap on remote text

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  user_id?: number | string;
  // instagram.md OAuth step 4: S9 shows a `data` array wrapper
  data?: { access_token?: string; user_id?: number | string }[];
};

const bad = (what: string) =>
  new PublishError("bad_state", "permanent", `bad publish state: ${what}`);
const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const num = (v: Json | undefined) => (typeof v === "number" ? v : 0);
const strs = (v: Json | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const noId = (what: string) =>
  new PublishError(
    "bad_response",
    "permanent",
    `instagram ${what} returned no id`,
  );
const noToken = (what: string) =>
  new PublishError(
    "bad_token_response",
    "permanent",
    `instagram ${what} response has no access token`,
  );

const isVideo = (mime: string) => mime.startsWith("video/");

/**
 * Publishing usage the platform reports for this account (instagram.md Rate
 * limits: content_publishing_limit). Pure over fetch; the caller stores it.
 */
export async function fetchPublishingUsage(
  t: TokenSet,
  igUserId: string,
  f: Fetch = (...a) => fetch(...a),
): Promise<{ used: number; total: number }> {
  const r = await getWithToken<{
    data?: { quota_usage?: number; config?: { quota_total?: number } }[];
  }>(
    f,
    "publishing limit",
    `${API}/${encodeURIComponent(igUserId)}/content_publishing_limit`,
    t.accessToken,
    {
      fields: "quota_usage,config",
      since: String(Math.floor(Date.now() / 1000) - 86_000), // within 24h (instagram.md Rate limits)
    },
  );
  const d = r.data?.[0];
  // Fallback 50: "currently 50" in instagram.md S16 (content_publishing_limit), used only when the response omits quota_total.
  return { used: d?.quota_usage ?? 0, total: d?.config?.quota_total ?? 50 };
}

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createInstagramAdapter(
  f: Fetch = (...a) => fetch(...a),
): PlatformAdapter {
  const container = async (
    uid: string,
    token: string,
    fields: Record<string, string>,
  ): Promise<string> => {
    const r = await postForm<{ id?: string }>(
      f,
      "create container",
      `${API}/${encodeURIComponent(uid)}/media`,
      token,
      fields,
    );
    if (!r.id) throw noId("create container");
    return r.id;
  };
  const urlField = (
    m: PublishInput["media"][number],
  ): Record<string, string> =>
    isVideo(m.mime) ? { video_url: m.signedUrl } : { image_url: m.signedUrl };
  const child = (m: PublishInput["media"][number]): Record<string, string> => ({
    ...urlField(m),
    ...(isVideo(m.mime) ? { media_type: "VIDEO" } : {}),
    ...(!isVideo(m.mime) && m.altText ? { alt_text: m.altText } : {}),
    is_carousel_item: "true",
  });
  const single = (i: PublishInput): Record<string, string> => {
    const m = i.media[0];
    if (!m) throw bad("media");
    const kind = postKind(i);
    return {
      ...urlField(m),
      ...(kind === "IMAGE" ? {} : { media_type: kind }),
      ...(kind === "IMAGE" && m.altText ? { alt_text: m.altText } : {}),
    };
  };

  const pollUntil = (d: Record<string, Json>): string =>
    str(d.poll_until) ||
    new Date(Date.now() + INSTAGRAM_LIMITS.pollMs).toISOString();

  /** True when FINISHED, false while pending. Throws on the deadline and on ERROR, EXPIRED, PUBLISHED. */
  async function finished(
    id: string,
    token: string,
    until: string,
  ): Promise<boolean> {
    if (Date.parse(until) < Date.now())
      throw new PublishError(
        "media_processing_timeout",
        "permanent",
        "Instagram media processing timed out",
      );
    const r = await getWithToken<{ status_code?: string; status?: string }>(
      f,
      "container status",
      `${API}/${encodeURIComponent(id)}`,
      token,
      // UNVERIFIED: instagram.md names only status_code; `status` (error detail text) is not in the doc.
      { fields: "status_code,status" },
    );
    if (r.status_code === "FINISHED") return true;
    // Already published: never call media_publish again (no idempotency key in instagram.md).
    if (r.status_code === "PUBLISHED")
      throw new PublishError(
        "post_outcome_unknown",
        "permanent",
        "Instagram container is already published; check the account before retrying",
      );
    if (r.status_code === "ERROR") {
      // graph.instagram.com is a fixed trusted host, so its message is shown, redacted then capped.
      const msg = String(
        redact(String(r.status ?? "").replace(/https?:\/\/\S+/g, "[url]")),
      ).slice(0, ERROR_TEXT_CHARS);
      throw new PublishError(
        "media_failed",
        "permanent",
        `Instagram could not process the media${msg ? `: ${msg}` : ""}`,
      );
    }
    // instagram.md Gotchas: EXPIRED means not published within 24 hours; create a new container.
    if (r.status_code === "EXPIRED")
      throw new PublishError(
        "container_expired",
        "retryable",
        "Instagram container expired before publish",
      );
    return false;
  }

  async function publish(
    i: PublishInput,
    token: string,
    creationId: string,
  ): Promise<PublishStepOutcome> {
    if (!creationId) throw bad("creation id");
    const uid = encodeURIComponent(i.account.platformUserId);
    // A lost response or 5xx may still have published; no idempotency key is documented.
    const unknown = () =>
      new PublishError(
        "post_outcome_unknown",
        "permanent",
        "Instagram may have published the post; check the account before retrying",
      );
    const r = await postForm<{ id?: string }>(
      f,
      "publish",
      `${API}/${uid}/media_publish`,
      token,
      { creation_id: creationId },
    ).catch((e) => {
      if (!(e instanceof PublishError)) throw unknown();
      if (e.code.startsWith("http_5")) throw unknown();
      throw e;
    });
    // 200 with no id or an unparsable body: the post may exist.
    if (!r.id) throw unknown();
    // media_publish returns only the id; permalink needs a second call (instagram.md Permalink). The post exists, so a failure here is not an error.
    const link = await getWithToken<{ permalink?: string }>(
      f,
      "permalink",
      `${API}/${encodeURIComponent(r.id)}`,
      token,
      { fields: "permalink" },
    ).catch(() => ({}) as { permalink?: string });
    return {
      result: {
        ok: true,
        platformPostId: r.id,
        ...(link.permalink ? { platformPostUrl: link.permalink } : {}),
        meta: { hasUrl: /https?:\/\//i.test(i.caption) },
      },
    };
  }

  return {
    platform: "instagram",
    // Instagram needs a token 24 hours old to refresh (instagram.md OAuth); 7 days left is far from that.
    refreshWindowMs: REFRESH_WINDOW_MS,
    async getAuthUrl({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: (await appCreds()).id,
        redirect_uri: redirectUri,
        scope: INSTAGRAM_SCOPES.join(","), // comma list: instagram.md OAuth step 1
        response_type: "code",
        state,
      }).toString();
      return { url: url.toString() };
    },
    async exchangeCode({ code, redirectUri }) {
      const c = await appCreds();
      const raw = await call<TokenResponse>(f, "token exchange", TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: c.id,
          client_secret: c.secret,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code: code.replace(/#_$/, ""), // instagram.md OAuth step 2: remove the #_ suffix
        }),
      });
      const short = raw.access_token ?? raw.data?.[0]?.access_token;
      if (!short) throw noToken("token");
      // The app secret must be in the query here: instagram.md OAuth step 5 shows no other form.
      const long = await getWithToken<TokenResponse>(
        f,
        "long-lived exchange",
        EXCHANGE_URL,
        short,
        { grant_type: "ig_exchange_token", client_secret: c.secret },
      );
      if (!long.access_token) throw noToken("long-lived");
      return {
        accessToken: long.access_token,
        expiresAt: new Date(
          Date.now() + (long.expires_in ?? LONG_LIVED_S) * 1000,
        ).toISOString(),
        scopes: INSTAGRAM_SCOPES,
      };
    },
    async refreshToken(t) {
      const r = await getWithToken<TokenResponse>(
        f,
        "token refresh",
        REFRESH_URL,
        t.accessToken,
        { grant_type: "ig_refresh_token" },
      );
      if (!r.access_token) throw noToken("refresh");
      return {
        ...t,
        accessToken: r.access_token,
        expiresAt: new Date(
          Date.now() + (r.expires_in ?? LONG_LIVED_S) * 1000,
        ).toISOString(),
      };
    },
    async revoke() {
      // instagram.md names no revocation endpoint: nothing to call.
    },
    async getProfile(t) {
      // UNVERIFIED: instagram.md does not document GET /me or these fields.
      const r = await getWithToken<{
        user_id?: string | number;
        id?: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
      }>(f, "get profile", `${API}/me`, t.accessToken, {
        fields: "user_id,username,name,profile_picture_url",
      });
      const id = String(r.user_id ?? r.id ?? "");
      if (!id)
        throw new PublishError(
          "bad_response",
          "permanent",
          "instagram profile response has no id",
        );
      return {
        platformUserId: id,
        username: r.username || id,
        displayName: r.name || r.username || id,
        avatarUrl: r.profile_picture_url,
      };
    },
    // No listTargets: Instagram Login is one professional account per login (instagram.md Overview, Login paths).
    reportedUsage: (t, a) => fetchPublishingUsage(t, a.platformUserId, f),
    configSchema: InstagramConfigSchema,
    // instagram.md section 5: plan for 50 per 24 hours (docs conflict with 100; section 5 says plan for 50).
    quota: {
      scope: "account",
      dailyCap: 50,
      sourceLine: "instagram.md section 5",
    },
    validatePost,
    async publishStep(state: PublishState, i, t) {
      const token = t.accessToken;
      if (t.expiresAt && Date.parse(t.expiresAt) <= Date.now())
        throw new PublishError(
          "account_reauth_required",
          "auth",
          "instagram token expired",
        );
      const d = state.data;
      const uid = i.account.platformUserId;
      const caption: Record<string, string> = i.caption
        ? { caption: i.caption }
        : {};

      if (state.stage === "publish")
        return publish(i, token, str(d.creation_id));

      if (state.stage === "start") {
        if (i.media.length === 0) throw bad("media");
        if (i.media.length === 1) {
          const id = await container(uid, token, {
            ...single(i),
            ...caption,
          });
          return {
            next: { stage: "status", data: { creation_id: id } },
            waitMs: POLL_MS,
          };
        }
        return { next: { stage: "child", data: { idx: 0, children: [] } } };
      }

      if (state.stage === "child") {
        const idx = num(d.idx);
        const m = i.media[idx];
        if (!m) throw bad("media index");
        const id = await container(uid, token, child(m));
        const children = [...strs(d.children), id];
        const videos = [...strs(d.videos), ...(isVideo(m.mime) ? [id] : [])];
        if (idx + 1 < i.media.length)
          return {
            next: { stage: "child", data: { idx: idx + 1, children, videos } },
          };
        return videos.length
          ? {
              next: { stage: "child_status", data: { children, videos } },
              waitMs: POLL_MS,
            }
          : { next: { stage: "parent", data: { children } } };
      }

      // Video children must be FINISHED before the parent is created; one status call per step.
      if (state.stage === "child_status") {
        const [cur, ...rest] = strs(d.videos);
        if (!cur) throw bad("child id");
        const until = pollUntil(d);
        if (!(await finished(cur, token, until))) {
          return {
            next: {
              stage: "child_status",
              data: { ...d, poll_until: until },
            },
            waitMs: POLL_MS,
          };
        }
        return rest.length
          ? {
              next: {
                stage: "child_status",
                data: { children: strs(d.children), videos: rest },
              },
            }
          : { next: { stage: "parent", data: { children: strs(d.children) } } };
      }

      if (state.stage === "parent") {
        const id = await container(uid, token, {
          media_type: "CAROUSEL",
          children: strs(d.children).join(","),
          ...caption,
        });
        return {
          next: { stage: "status", data: { creation_id: id } },
          waitMs: POLL_MS,
        };
      }

      if (state.stage === "status") {
        const creation = str(d.creation_id);
        if (!creation) throw bad("creation id");
        const until = pollUntil(d);
        if (await finished(creation, token, until))
          return {
            next: { stage: "publish", data: { creation_id: creation } },
          };
        return {
          next: {
            stage: "status",
            data: { creation_id: creation, poll_until: until },
          },
          waitMs: POLL_MS,
        };
      }
      throw bad("stage");
    },
  };
}

export const instagramAdapter = createInstagramAdapter();
