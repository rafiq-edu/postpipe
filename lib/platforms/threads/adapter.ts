import { redact } from "../../log/redact";
import {
  type Json,
  type PlatformAdapter,
  PublishError,
  type PublishInput,
  type PublishState,
  type PublishStepOutcome,
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
import { ThreadsConfigSchema } from "./config";
import { THREADS_LIMITS, validatePost } from "./rules";

// Scopes from threads.md section 3.
export const THREADS_SCOPES = ["threads_basic", "threads_content_publish"];

const LONG_LIVED_S = 5_183_944; // threads.md section 3, Short to long-lived: about 60 days
const REFRESH_WINDOW_MS = 7 * 24 * 3_600_000; // plan Task 22: refresh when under 7 days left
const MEDIA_WAIT_MS = 30_000; // threads.md section 4, Step 3: wait about 30 seconds
const POLL_MS = 60_000; // threads.md section 4, Step 2: poll once a minute
const ERROR_TEXT_CHARS = 300; // our cap on the platform's error_message

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  user_id?: number | string;
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
    `threads ${what} returned no id`,
  );

const isVideo = (mime: string) => mime.startsWith("video/");

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createThreadsAdapter(
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
      `${API}/${encodeURIComponent(uid)}/threads`,
      token,
      fields,
    );
    if (!r.id) throw noId("create container");
    return r.id;
  };
  const mediaFields = (m: PublishInput["media"][number]) => ({
    media_type: isVideo(m.mime) ? "VIDEO" : "IMAGE",
    [isVideo(m.mime) ? "video_url" : "image_url"]: m.signedUrl,
    ...(m.altText ? { alt_text: m.altText } : {}),
  });
  const replyControl = (i: PublishInput): Record<string, string> =>
    typeof i.config.reply_control === "string"
      ? { reply_control: i.config.reply_control }
      : {};

  const pollUntil = (d: Record<string, Json>): string =>
    str(d.poll_until) ||
    new Date(Date.now() + THREADS_LIMITS.pollMs).toISOString();

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
        "Threads media processing timed out",
      );
    const r = await getWithToken<{ status?: string; error_message?: string }>(
      f,
      "container status",
      `${API}/${encodeURIComponent(id)}`,
      token,
      { fields: "status,error_message" },
    );
    if (r.status === "FINISHED") return true;
    // Already published: never call threads_publish again (no idempotency key, threads.md section 4).
    if (r.status === "PUBLISHED")
      throw new PublishError(
        "post_outcome_unknown",
        "permanent",
        "Threads container is already published; check the account before retrying",
      );
    if (r.status === "ERROR") {
      // graph.threads.com is a fixed trusted host, so its message is shown, redacted then capped.
      const msg = String(
        redact(
          String(r.error_message ?? "").replace(/https?:\/\/\S+/g, "[url]"),
        ),
      ).slice(0, ERROR_TEXT_CHARS);
      throw new PublishError(
        "media_failed",
        "permanent",
        `Threads could not process the media${msg ? `: ${msg}` : ""}`,
      );
    }
    if (r.status === "EXPIRED")
      throw new PublishError(
        "container_expired",
        "retryable",
        "Threads container expired before publish",
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
    // A lost response or 5xx may still have published; no idempotency key is documented (threads.md section 4).
    const unknown = () =>
      new PublishError(
        "post_outcome_unknown",
        "permanent",
        "Threads may have published the post; check the account before retrying",
      );
    const r = await postForm<{ id?: string }>(
      f,
      "publish",
      `${API}/${uid}/threads_publish`,
      token,
      { creation_id: creationId },
    ).catch((e) => {
      if (!(e instanceof PublishError)) throw unknown();
      if (e.code.startsWith("http_5")) throw unknown();
      throw e;
    });
    // 200 with no id or an unparsable body: the post may exist.
    if (!r.id) throw unknown();
    // Permalink needs a second call (threads.md section 4, Permalink). The post exists, so a failure here is not an error.
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
    platform: "threads",
    // threads.md section 3: a token must be 24 hours old to refresh; 7 days left is far from that.
    refreshWindowMs: REFRESH_WINDOW_MS,
    async getAuthUrl({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: (await appCreds()).id,
        redirect_uri: redirectUri,
        scope: THREADS_SCOPES.join(","), // comma-separated: threads.md section 3
        response_type: "code",
        state,
      }).toString();
      return { url: url.toString() };
    },
    async exchangeCode({ code, redirectUri }) {
      const c = await appCreds();
      const short = await call<TokenResponse>(f, "token exchange", TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: c.id,
          client_secret: c.secret,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code: code.replace(/#_$/, ""), // threads.md section 3: remove the #_ suffix
        }),
      });
      if (!short.access_token)
        throw new PublishError(
          "bad_token_response",
          "permanent",
          "threads token response has no access token",
        );
      // The app secret must be in the query here: threads.md section 3 shows no other form.
      const long = await getWithToken<TokenResponse>(
        f,
        "long-lived exchange",
        EXCHANGE_URL,
        short.access_token,
        { grant_type: "th_exchange_token", client_secret: c.secret },
      );
      if (!long.access_token)
        throw new PublishError(
          "bad_token_response",
          "permanent",
          "threads long-lived response has no access token",
        );
      return {
        accessToken: long.access_token,
        expiresAt: new Date(
          Date.now() + (long.expires_in ?? LONG_LIVED_S) * 1000,
        ).toISOString(),
        scopes: THREADS_SCOPES,
      };
    },
    async refreshToken(t) {
      const r = await getWithToken<TokenResponse>(
        f,
        "token refresh",
        REFRESH_URL,
        t.accessToken,
        { grant_type: "th_refresh_token" },
      );
      if (!r.access_token)
        throw new PublishError(
          "bad_token_response",
          "permanent",
          "threads refresh response has no access token",
        );
      return {
        ...t,
        accessToken: r.access_token,
        expiresAt: new Date(
          Date.now() + (r.expires_in ?? LONG_LIVED_S) * 1000,
        ).toISOString(),
      };
    },
    async revoke() {
      // threads.md names no revocation endpoint: nothing to call.
    },
    async getProfile(t) {
      // UNVERIFIED: threads.md does not document GET /me or these fields.
      const r = await getWithToken<{
        id?: string;
        username?: string;
        name?: string;
        threads_profile_picture_url?: string;
      }>(f, "get profile", `${API}/me`, t.accessToken, {
        fields: "id,username,name,threads_profile_picture_url",
      });
      if (!r.id)
        throw new PublishError(
          "bad_response",
          "permanent",
          "threads profile response has no id",
        );
      return {
        platformUserId: r.id,
        username: r.username || r.id,
        displayName: r.name || r.username || r.id,
        avatarUrl: r.threads_profile_picture_url,
      };
    },
    configSchema: ThreadsConfigSchema,
    // threads.md section 5: 250 API posts per profile per rolling 24 hours (we count per UTC day).
    quota: {
      scope: "account",
      dailyCap: 250,
      sourceLine: "threads.md section 5",
    },
    validatePost,
    async publishStep(state: PublishState, i, t) {
      const token = t.accessToken;
      if (t.expiresAt && Date.parse(t.expiresAt) <= Date.now())
        throw new PublishError(
          "account_reauth_required",
          "auth",
          "threads token expired",
        );
      const d = state.data;
      const uid = i.account.platformUserId;
      const text: Record<string, string> = i.caption ? { text: i.caption } : {};

      if (state.stage === "publish")
        return publish(i, token, str(d.creation_id));

      if (state.stage === "start") {
        if (i.media.length === 0) {
          const id = await container(uid, token, {
            media_type: "TEXT",
            ...text,
            ...replyControl(i),
          });
          return { next: { stage: "publish", data: { creation_id: id } } };
        }
        if (i.media.length === 1) {
          const m = i.media[0];
          if (!m) throw bad("media");
          const id = await container(uid, token, {
            ...mediaFields(m),
            ...text,
            ...replyControl(i),
          });
          return {
            next: {
              stage: "status",
              data: { creation_id: id },
            },
            waitMs: MEDIA_WAIT_MS,
          };
        }
        return { next: { stage: "child", data: { idx: 0, children: [] } } };
      }

      if (state.stage === "child") {
        const idx = num(d.idx);
        const m = i.media[idx];
        if (!m) throw bad("media index");
        const id = await container(uid, token, {
          ...mediaFields(m),
          is_carousel_item: "true",
        });
        const children = [...strs(d.children), id];
        const videos = [...strs(d.videos), ...(isVideo(m.mime) ? [id] : [])];
        if (idx + 1 < i.media.length)
          return {
            next: { stage: "child", data: { idx: idx + 1, children, videos } },
          };
        return videos.length
          ? {
              next: { stage: "child_status", data: { children, videos } },
              waitMs: MEDIA_WAIT_MS,
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
          ...text,
          ...replyControl(i),
        });
        return {
          next: { stage: "status", data: { creation_id: id } },
          waitMs: MEDIA_WAIT_MS,
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

export const threadsAdapter = createThreadsAdapter();
