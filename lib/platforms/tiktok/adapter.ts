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
  AUTHORIZE_URL,
  appCreds,
  bearer,
  CONTENT_INIT_URL,
  CREATOR_INFO_URL,
  call,
  FAIL_REASONS,
  type Fetch,
  failure,
  INBOX_INIT_URL,
  isUploadUrl,
  jsonHeaders,
  PROFILE_URL,
  REVOKE_URL,
  retryAfterMs,
  STATUS_URL,
  send,
  TOKEN_URL,
  VIDEO_INIT_URL,
} from "./api";
import { TiktokConfigSchema } from "./config";
import {
  chunkPlan,
  chunkRange,
  isDirect,
  isVideo,
  mediaBase,
  pullUrl,
  TIKTOK_LIMITS,
  validatePost,
} from "./rules";

// tiktok.md section 3, Scopes we need.
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
];

const bad = (what: string) =>
  new PublishError("bad_state", "permanent", `bad publish state: ${what}`);
const unknown = () =>
  new PublishError(
    "post_outcome_unknown",
    "permanent",
    "TikTok may have received the video; check the creator's account before retrying",
  );

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
};

const num = (v: Json | undefined) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const flag = (v: Json | undefined) => v === true;

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createTiktokAdapter(
  f: Fetch = (...a) => fetch(...a),
): PlatformAdapter {
  async function tokenCall(
    op: string,
    fields: Record<string, string>,
    prev?: TokenSet,
  ): Promise<TokenSet> {
    const c = await appCreds();
    const r = await call<TokenResponse>(f, op, TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: c.key,
        client_secret: c.secret,
        ...fields,
      }),
    });
    if (!r.access_token)
      throw new PublishError(
        "bad_token_response",
        "permanent",
        `tiktok ${op} response has no access token`,
      );
    return {
      accessToken: r.access_token,
      // tiktok.md section 3: a refresh may return a different refresh token; store the newest.
      refreshToken: r.refresh_token ?? prev?.refreshToken,
      expiresAt: r.expires_in ? at(r.expires_in) : undefined,
      refreshExpiresAt: r.refresh_expires_in
        ? at(r.refresh_expires_in)
        : undefined,
      // tiktok.md section 3: users can deny some scopes, so read what came back.
      scopes: r.scope ? r.scope.split(",") : (prev?.scopes ?? TIKTOK_SCOPES),
    };
  }

  /** Stage creator_info: read the creator's limits and check the post against them. */
  async function creatorInfo(
    i: PublishInput,
    token: string,
  ): Promise<PublishStepOutcome> {
    const r = await call<{
      data?: {
        privacy_level_options?: unknown;
        comment_disabled?: unknown;
        duet_disabled?: unknown;
        stitch_disabled?: unknown;
        max_video_post_duration_sec?: unknown;
      };
    }>(f, "creator info", CREATOR_INFO_URL, {
      method: "POST",
      headers: jsonHeaders(token),
      body: "{}",
    });
    const d = r.data ?? {};
    const m = i.media[0];
    const max = d.max_video_post_duration_sec;
    // tiktok.md section 7: check the video length against max_video_post_duration_sec.
    if (
      isVideo(i) &&
      typeof max === "number" &&
      m?.durationMs !== undefined &&
      m.durationMs > max * 1000
    )
      throw new PublishError(
        "video_too_long",
        "permanent",
        `video is longer than the ${max} seconds this creator may post`,
      );
    const c = i.config;
    if (isDirect(c)) {
      // tiktok.md section 1: privacy_level must be one of the creator's options.
      const opts = Array.isArray(d.privacy_level_options)
        ? d.privacy_level_options
        : [];
      if (!opts.includes(c.privacy_level))
        throw new PublishError(
          "privacy_level_option_mismatch",
          "permanent",
          "privacy_level is not one of this creator's options",
        );
    }
    // tiktok.md section 7: what the creator disabled stays disabled. Explicitly enabling it is refused.
    const lock = (name: string, off: unknown, cfg: Json | undefined) => {
      if (off === true && cfg === false)
        throw new PublishError(
          "interaction_disabled_by_creator",
          "permanent",
          `${name} is disabled in this creator's settings and cannot be enabled`,
        );
      return off === true || cfg === true;
    };
    return {
      next: {
        stage: "init",
        data: {
          disable_comment: lock(
            "comment",
            d.comment_disabled,
            c.disable_comment,
          ),
          disable_duet: lock("duet", d.duet_disabled, c.disable_duet),
          disable_stitch: lock("stitch", d.stitch_disabled, c.disable_stitch),
          restarts: 0,
        },
      },
    };
  }

  /** Stage init: direct post or inbox upload (tiktok.md section 4). */
  async function init(
    state: PublishState,
    i: PublishInput,
    token: string,
  ): Promise<PublishStepOutcome> {
    const c = i.config;
    const direct = isDirect(c);
    const d = state.data;
    const restarts = num(d.restarts);
    const brand: Record<string, Json> = direct
      ? {
          privacy_level: String(c.privacy_level),
          brand_content_toggle: c.brand_content_toggle === true,
          brand_organic_toggle: c.brand_organic_toggle === true,
        }
      : {};
    let url: string;
    let body: Record<string, Json>;
    if (isVideo(i)) {
      const m = i.media[0] as MediaInfo;
      const p = chunkPlan(m.bytes);
      const source_info = {
        source: "FILE_UPLOAD",
        video_size: m.bytes,
        chunk_size: p.chunkSize,
        total_chunk_count: p.count,
      };
      if (direct) {
        url = VIDEO_INIT_URL;
        const post_info: Record<string, Json> = {
          title: typeof c.title === "string" ? c.title : i.caption,
          ...brand,
          disable_comment: flag(d.disable_comment),
          disable_duet: flag(d.disable_duet),
          disable_stitch: flag(d.disable_stitch),
        };
        if (typeof c.video_cover_timestamp_ms === "number")
          post_info.video_cover_timestamp_ms = c.video_cover_timestamp_ms;
        if (typeof c.is_aigc === "boolean") post_info.is_aigc = c.is_aigc;
        body = { post_info, source_info };
      } else {
        // UNVERIFIED: tiktok.md section 4 lists no post_info for the inbox endpoint; none is sent.
        url = INBOX_INIT_URL;
        body = { source_info };
      }
    } else {
      const base = await mediaBase();
      if (!base)
        throw new PublishError(
          "tiktok_photo_unavailable",
          "permanent",
          "TikTok photo posts need a DNS-verified media domain (TIKTOK_MEDIA_URL_BASE)",
        );
      url = CONTENT_INIT_URL;
      const post_info: Record<string, Json> = {
        description: i.caption,
        disable_comment: flag(d.disable_comment),
        ...brand,
      };
      if (typeof c.title === "string") post_info.title = c.title;
      if (typeof c.auto_add_music === "boolean")
        post_info.auto_add_music = c.auto_add_music;
      body = {
        media_type: "PHOTO",
        post_mode: direct ? "DIRECT_POST" : "MEDIA_UPLOAD",
        post_info,
        source_info: {
          source: "PULL_FROM_URL",
          photo_cover_index:
            typeof c.photo_cover_index === "number" ? c.photo_cover_index : 0,
          // UNVERIFIED: tiktok.md section 4 names no field for the image list; photo_images is the usual name.
          photo_images: await Promise.all(
            i.media.map((m) => pullUrl(base, m.mediaId)),
          ),
        },
      };
    }
    const r = await call<{
      data?: { publish_id?: unknown; upload_url?: unknown };
    }>(f, "init", url, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify(body),
    });
    const id = r.data?.publish_id;
    // tiktok.md section 4: publish_id is at most 64 characters.
    if (typeof id !== "string" || !id || id.length > 64)
      throw new PublishError(
        "bad_response",
        "permanent",
        "tiktok init returned no publish id",
      );
    if (!isVideo(i))
      return {
        next: {
          stage: "status",
          data: { publish_id: id, poll_until: pollUntil() },
        },
        platformPublishId: id,
        waitMs: TIKTOK_LIMITS.statusWaitMs,
      };
    const upload = r.data?.upload_url;
    // The upload URL is kept in publish_state only; it is checked here and again before every PUT.
    if (!isUploadUrl(upload))
      throw new PublishError(
        "bad_upload_url",
        "permanent",
        "tiktok init returned an unexpected upload URL",
      );
    return {
      next: {
        stage: "upload",
        data: {
          publish_id: id,
          upload_url: upload,
          index: 0,
          restarts,
          disable_comment: flag(d.disable_comment),
          disable_duet: flag(d.disable_duet),
          disable_stitch: flag(d.disable_stitch),
        },
      },
      platformPublishId: id,
    };
  }

  /** Stage upload: one chunk PUT per call (tiktok.md section 4, Chunk rules). */
  async function upload(
    state: PublishState,
    m: MediaInfo,
    fetchRange: (id: string, s: number, e: number) => Promise<Uint8Array>,
  ): Promise<PublishStepOutcome> {
    const d = state.data;
    const url = d.upload_url;
    if (!isUploadUrl(url)) throw bad("upload_url");
    const plan = chunkPlan(m.bytes);
    const index = num(d.index);
    if (index >= plan.count) throw bad("index");
    const r = chunkRange(m.bytes, plan, index);
    let res: Response | undefined;
    try {
      // No token: tiktok.md section 4 sends none to the upload URL. Content-Length is set by fetch.
      res = await send(f, "upload chunk", url, {
        method: "PUT",
        headers: {
          "content-type": m.mime,
          "content-range": `bytes ${r.start}-${r.end}/${m.bytes}`,
        },
        body: (await fetchRange(m.mediaId, r.start, r.end)) as BodyInit,
      });
    } catch (e) {
      if (!(e instanceof PublishError)) throw e;
    }
    // UNVERIFIED: tiktok.md names no status codes for a chunk PUT; any 2xx counts as received.
    if (res?.ok) {
      if (!r.last)
        return {
          next: { stage: "upload", data: { ...d, index: index + 1 } },
        };
      return {
        next: {
          stage: "status",
          data: { publish_id: d.publish_id, poll_until: pollUntil() },
        },
        waitMs: TIKTOK_LIMITS.statusWaitMs,
      };
    }
    // After the last chunk was sent the post may exist: no retry, no restart.
    if (r.last) throw unknown();
    if (res && res.status !== 429 && res.status < 500) {
      if (res.status === 401)
        throw new PublishError(
          "account_reauth_required",
          "auth",
          "tiktok upload chunk failed: 401",
        );
      throw await failure("upload chunk", res);
    }
    // tiktok.md has no way to ask what arrived. Before the last chunk nothing is published yet, so start over with a new init.
    const restarts = num(d.restarts) + 1;
    if (restarts > TIKTOK_LIMITS.maxRestarts)
      throw new PublishError(
        "network_error",
        "retryable",
        `tiktok upload chunk failed: gave up after ${TIKTOK_LIMITS.maxRestarts} restarts`,
        res && retryAfterMs(res),
      );
    return {
      next: { stage: "init", data: { ...d, restarts } },
      waitMs: (res && retryAfterMs(res)) || TIKTOK_LIMITS.statusWaitMs,
    };
  }

  /** Stage status: poll until the post is public, delivered to the inbox, or failed. */
  async function status(
    state: PublishState,
    i: PublishInput,
    token: string,
  ): Promise<PublishStepOutcome> {
    const d = state.data;
    const id = str(d.publish_id);
    if (!id) throw bad("publish_id");
    const until = Date.parse(str(d.poll_until));
    if (Number.isNaN(until)) throw bad("poll_until");
    if (until < Date.now())
      throw new PublishError(
        "media_processing_timeout",
        "permanent",
        "TikTok processing timed out",
      );
    // tiktok.md section 4: statuses PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SEND_TO_USER_INBOX, PUBLISH_COMPLETE, FAILED.
    let r: {
      data?: {
        status?: unknown;
        fail_reason?: unknown;
        publicaly_available_post_id?: unknown;
      };
    };
    try {
      r = await call(f, "status", STATUS_URL, {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify({ publish_id: id }),
      });
    } catch (e) {
      // The post already exists: a thrown retryable error would make the worker drop the state and post again. Keep the state and poll later (poll_until bounds this).
      if (e instanceof PublishError && e.kind === "retryable")
        return {
          next: state,
          waitMs: e.retryAfterMs || TIKTOK_LIMITS.statusWaitMs,
        };
      throw e;
    }
    const s = r.data?.status;
    if (s === "FAILED") {
      const why = FAIL_REASONS.find((x) => x === r.data?.fail_reason);
      if (why === "auth_removed")
        throw new PublishError(
          "account_reauth_required",
          "auth",
          "tiktok publish failed (auth_removed)",
        );
      // tiktok.md section 9: `internal` is the one marked retry.
      throw new PublishError(
        why ?? "publish_failed",
        why === "internal" ? "retryable" : "permanent",
        `tiktok publish failed${why ? ` (${why})` : ""}`,
      );
    }
    if (s === "SEND_TO_USER_INBOX" && !isDirect(i.config))
      // Inbox mode ends here: the creator finishes the post in the TikTok app (tiktok.md section 1). The publish id stands in for the post id.
      return { result: { ok: true, platformPostId: id } };
    if (s === "PUBLISH_COMPLETE") {
      const ids = r.data?.publicaly_available_post_id; // tiktok.md section 4: docs spelling
      const first = Array.isArray(ids) ? ids[0] : ids;
      // A string up to 64 characters, or a safe integer; anything else (a rounded 19-digit number) is not trusted.
      if (
        (typeof first === "string" && first && first.length <= 64) ||
        Number.isSafeInteger(first)
      )
        return { result: { ok: true, platformPostId: String(first) } };
      // tiktok.md section 4: PUBLISH_COMPLETE has no post id; it comes by event after moderation. Wait for the event, then fall back.
      const doneAt = Date.parse(str(d.complete_at)) || Date.now();
      if (Date.now() - doneAt >= TIKTOK_LIMITS.idFallbackMs)
        return { result: { ok: true, platformPostId: id } };
      return {
        next: {
          stage: "status",
          data: { ...d, complete_at: new Date(doneAt).toISOString() },
        },
        waitMs: TIKTOK_LIMITS.statusWaitMs,
      };
    }
    return { next: state, waitMs: TIKTOK_LIMITS.statusWaitMs };
  }

  return {
    platform: "tiktok",
    async getAuthUrl({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      // tiktok.md section 3: PKCE is only for mobile and desktop apps; scope is comma separated.
      url.search = new URLSearchParams({
        client_key: (await appCreds()).key,
        response_type: "code",
        scope: TIKTOK_SCOPES.join(","),
        redirect_uri: redirectUri,
        state,
      }).toString();
      return { url: url.toString() };
    },
    exchangeCode: ({ code, redirectUri }) =>
      // tiktok.md section 3: the code must be URL-decoded (searchParams already did that).
      tokenCall("token exchange", {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    async refreshToken(t) {
      if (!t.refreshToken)
        throw new PublishError(
          "account_reauth_required",
          "auth",
          "no refresh token",
        );
      return tokenCall(
        "token refresh",
        { grant_type: "refresh_token", refresh_token: t.refreshToken },
        t,
      );
    },
    async revoke(t) {
      const c = await appCreds();
      await call(f, "revoke", REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: c.key,
          client_secret: c.secret,
          token: t.accessToken,
        }),
      });
    },
    async getProfile(t) {
      const r = await call<{
        data?: {
          user?: {
            open_id?: string;
            display_name?: string;
            avatar_url?: string;
          };
        };
      }>(f, "get profile", PROFILE_URL, { headers: bearer(t.accessToken) });
      const u = r.data?.user;
      if (!u?.open_id)
        throw new PublishError(
          "bad_response",
          "permanent",
          "tiktok profile has no open_id",
        );
      // user.info.basic gives no username (tiktok.md section 3); the display name stands in.
      const name = u.display_name || u.open_id;
      return {
        platformUserId: u.open_id,
        username: name,
        displayName: name,
        ...(u.avatar_url ? { avatarUrl: u.avatar_url } : {}),
      };
    },
    configSchema: TiktokConfigSchema,
    // tiktok.md section 5: about 15 posts per creator per day (approximate). The inbox draft has its own cap, not enforced.
    quota: {
      scope: "account",
      dailyCap: 15,
      sourceLine: "tiktok.md section 5",
      appliesTo: ({ config }) => isDirect(config),
    },
    validatePost,
    async publishStep(state: PublishState, i, t, fetchRange) {
      if (state.stage === "creator_info" || state.stage === "start")
        return creatorInfo(i, t.accessToken);
      if (state.stage === "init") return init(state, i, t.accessToken);
      if (state.stage === "status") return status(state, i, t.accessToken);
      if (state.stage === "upload") {
        const m = i.media[0];
        if (!m || m.bytes <= 0) throw bad("media");
        return upload(state, m, fetchRange);
      }
      throw bad("stage");
    },
  };
}

const pollUntil = () =>
  new Date(Date.now() + TIKTOK_LIMITS.pollDeadlineMs).toISOString();

export const tiktokAdapter = createTiktokAdapter();
