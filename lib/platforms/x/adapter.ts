import { getSecret } from "../../secrets";
import {
  type Json,
  type MediaInfo,
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
  bearer,
  call,
  clientCreds,
  type Fetch,
  REVOKE_URL,
  TOKEN_URL,
} from "./api";
import { XConfigSchema } from "./config";
import { validatePost, X_LIMITS } from "./rules";

// Scopes from x.md section 3.
export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
  "media.write",
];

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};
type Processing = { state?: string; check_after_secs?: number };
type Upload = { data?: { id?: string; processing_info?: Processing } };

const category = (m: MediaInfo) =>
  m.mime.startsWith("video/")
    ? "tweet_video"
    : m.mime === "image/gif"
      ? "tweet_gif"
      : "tweet_image"; // x.md section 4

const bad = (what: string) =>
  new PublishError("bad_state", "permanent", `bad publish state: ${what}`);
const num = (v: Json | undefined) => (typeof v === "number" ? v : 0);
const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const ids = (v: Json | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createXAdapter(
  f: Fetch = (...a) => fetch(...a),
): PlatformAdapter {
  async function tokenCall(
    op: string,
    params: Record<string, string>,
  ): Promise<TokenResponse> {
    const c = await clientCreds();
    return call<TokenResponse>(f, op, TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: c.header,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ ...params, client_id: c.id }),
    });
  }

  function toTokenSet(r: TokenResponse, prev?: TokenSet): TokenSet {
    if (!r.access_token)
      throw new PublishError(
        "bad_token_response",
        "permanent",
        "x token response has no access token",
      );
    return {
      accessToken: r.access_token,
      // Refresh tokens rotate (x.md section 3): always return the new one.
      refreshToken: r.refresh_token ?? prev?.refreshToken,
      expiresAt: r.expires_in
        ? new Date(Date.now() + r.expires_in * 1000).toISOString()
        : undefined,
      scopes: r.scope ? r.scope.split(" ") : (prev?.scopes ?? X_SCOPES),
    };
  }

  async function createPost(
    i: PublishInput,
    token: string,
    mediaIds: string[],
  ): Promise<PublishStepOutcome> {
    // Alt text is skipped until the x.md alt-text request shape is verified (x.md section 1).
    const body: Record<string, Json> = { text: i.caption };
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    if (typeof i.config.reply_settings === "string")
      body.reply_settings = i.config.reply_settings;
    // A lost response or 5xx may still have created the post: check the timeline before retry (x.md:78).
    const unknown = () =>
      new PublishError(
        "post_outcome_unknown",
        "permanent",
        "X may have created the post; check the account before retrying",
      );
    const r = await call<{ data?: { id?: string } }>(
      f,
      "create post",
      `${API}/2/tweets`,
      {
        method: "POST",
        headers: { ...bearer(token), "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ).catch((e) => {
      if (!(e instanceof PublishError)) throw unknown();
      if (e.code.startsWith("http_5")) throw unknown();
      throw e;
    });
    const id = r.data?.id;
    if (!id)
      throw new PublishError(
        "bad_response",
        "permanent",
        "x create post returned no id",
      );
    return {
      result: {
        ok: true,
        platformPostId: id,
        platformPostUrl: `https://x.com/i/web/status/${id}`, // format UNVERIFIED (x.md section 4)
        meta: { hasUrl: /https?:\/\//i.test(i.caption) },
      },
    };
  }

  /** Media `idx` is done: start the next one, or post. */
  function afterMedia(
    i: PublishInput,
    idx: number,
    done: string[],
  ): PublishStepOutcome {
    if (idx + 1 < i.media.length)
      return { next: { stage: "init", data: { idx: idx + 1, ids: done } } };
    return { next: { stage: "post", data: { ids: done } } };
  }

  return {
    platform: "x",
    async getAuthUrl({ state, redirectUri, codeChallenge }) {
      if (!codeChallenge)
        throw new PublishError(
          "pkce_required",
          "permanent",
          "PKCE is required",
        );
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: await getSecret("X_CLIENT_ID"),
        redirect_uri: redirectUri,
        scope: X_SCOPES.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256", // x.md section 3
      }).toString();
      return { url: url.toString() };
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      if (!codeVerifier)
        throw new PublishError(
          "pkce_required",
          "permanent",
          "PKCE is required",
        );
      return toTokenSet(
        await tokenCall("token exchange", {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      );
    },
    async refreshToken(t) {
      if (!t.refreshToken)
        throw new PublishError(
          "account_reauth_required",
          "auth",
          "no refresh token",
        );
      return toTokenSet(
        await tokenCall("token refresh", {
          grant_type: "refresh_token",
          refresh_token: t.refreshToken,
        }),
        t,
      );
    },
    async revoke(t) {
      // Whether this kills the paired token is UNVERIFIED (x.md section 3).
      const c = await clientCreds();
      await call(f, "revoke", REVOKE_URL, {
        method: "POST",
        headers: {
          authorization: c.header,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: t.refreshToken ?? t.accessToken,
          client_id: c.id,
        }),
      });
    },
    async getProfile(t) {
      const r = await call<{
        data?: {
          id: string;
          username: string;
          name?: string;
          profile_image_url?: string;
        };
      }>(f, "get profile", `${API}/2/users/me?user.fields=profile_image_url`, {
        headers: bearer(t.accessToken),
      });
      if (!r.data)
        throw new PublishError(
          "bad_response",
          "permanent",
          "x profile response has no data",
        );
      return {
        platformUserId: r.data.id,
        username: r.data.username,
        displayName: r.data.name || r.data.username,
        avatarUrl: r.data.profile_image_url,
      };
    },
    configSchema: XConfigSchema,
    validatePost,
    async publishStep(state: PublishState, i, t, fetchRange) {
      const token = t.accessToken;
      const d = state.data;
      const done = ids(d.ids);
      const idx = num(d.idx);

      if (state.stage === "post") return createPost(i, token, done);
      if (i.media.length === 0) return createPost(i, token, []);
      const m = i.media[idx];
      if (!m) throw bad("media index");

      if (state.stage === "start" || state.stage === "init") {
        const r = await call<Upload>(
          f,
          "media init",
          `${API}/2/media/upload/initialize`,
          {
            method: "POST",
            headers: { ...bearer(token), "content-type": "application/json" },
            body: JSON.stringify({
              media_type: m.mime,
              total_bytes: m.bytes,
              media_category: category(m),
            }),
          },
        );
        if (!r.data?.id)
          throw new PublishError(
            "bad_response",
            "permanent",
            "x media init returned no id",
          );
        return {
          next: {
            stage: "append",
            data: { idx, ids: done, media_id: r.data.id, seg: 0 },
          },
        };
      }

      const mediaId = str(d.media_id);
      if (!mediaId) throw bad("media id");
      const upload = `${API}/2/media/upload/${encodeURIComponent(mediaId)}`;

      if (state.stage === "append") {
        const seg = num(d.seg);
        const start = seg * X_LIMITS.chunkBytes;
        const end = Math.min(start + X_LIMITS.chunkBytes, m.bytes) - 1;
        if (start > end) throw bad("segment");
        const chunk = await fetchRange(m.mediaId, start, end);
        const form = new FormData();
        form.set("segment_index", String(seg));
        form.set("media", new Blob([chunk as BlobPart]));
        await call(f, "media append", `${upload}/append`, {
          method: "POST",
          headers: bearer(token),
          body: form,
        });
        return end + 1 < m.bytes
          ? { next: { stage: "append", data: { ...d, seg: seg + 1 } } }
          : {
              next: {
                stage: "finalize",
                data: { idx, ids: done, media_id: mediaId },
              },
            };
      }

      const processing = (
        r: Upload,
        waitData: Record<string, Json>,
      ): PublishStepOutcome => {
        const p = r.data?.processing_info;
        if (p?.state === "failed")
          throw new PublishError(
            "media_failed",
            "permanent",
            "X could not process the media",
          );
        if (p && p.state !== "succeeded")
          return {
            next: { stage: "status", data: waitData },
            waitMs: (p.check_after_secs ?? 3) * 1000,
          };
        return afterMedia(i, idx, [...done, mediaId]);
      };
      const waitData = { idx, ids: done, media_id: mediaId };

      if (state.stage === "finalize")
        return processing(
          await call<Upload>(f, "media finalize", `${upload}/finalize`, {
            method: "POST",
            headers: bearer(token),
          }),
          waitData,
        );
      if (state.stage === "status") {
        // x.md:66 gives no processing deadline; 30 minutes is our own cap.
        const until =
          str(d.poll_until) || new Date(Date.now() + 30 * 60_000).toISOString();
        if (Date.parse(until) < Date.now())
          throw new PublishError(
            "media_processing_timeout",
            "permanent",
            "X media processing timed out",
          );
        return processing(
          await call<Upload>(
            f,
            "media status",
            `${API}/2/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
            { headers: bearer(token) },
          ),
          { ...waitData, poll_until: until },
        );
      }
      throw bad("stage");
    },
  };
}

export const xAdapter = createXAdapter();
