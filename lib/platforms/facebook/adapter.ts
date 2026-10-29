import { getSecret } from "../../secrets";
import {
  type Json,
  type PlatformAdapter,
  PublishError,
  type PublishInput,
  type PublishState,
  type PublishStepOutcome,
  type Target,
  type TokenSet,
} from "../types";
import {
  API,
  AUTHORIZE_URL,
  appCreds,
  call,
  type Fetch,
  getWithToken,
  postForm,
  RUPLOAD,
  TOKEN_URL,
} from "./api";
import { FacebookConfigSchema } from "./config";
import { FACEBOOK_LIMITS, postKind, validatePost } from "./rules";

// facebook.md section 3, Scopes: list Pages, publish posts and photos, publish video.
export const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "publish_video",
];

const LONG_LIVED_S = 5_183_944; // facebook.md section 3, Token steps 3: sample expires_in
const CAN_PUBLISH = "CREATE_CONTENT"; // facebook.md section 1, Roles and tasks
const PAGE_LIMIT = "100"; // ours: facebook.md names no page size for /me/accounts

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
    `facebook ${what} returned no id`,
  );
const noToken = (what: string) =>
  new PublishError(
    "bad_token_response",
    "permanent",
    `facebook ${what} response has no access token`,
  );
const unknown = () =>
  new PublishError(
    "post_outcome_unknown",
    "permanent",
    "Facebook may have published the post; check the Page before retrying",
  );
const numOr = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

type Account = {
  id?: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
};
type TokenResponse = { access_token?: string; expires_in?: number };
type Offsets = { start_offset?: string | number; end_offset?: string | number };

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createFacebookAdapter(
  f: Fetch = (...a) => fetch(...a),
): PlatformAdapter {
  const pageAccounts = async (t: TokenSet): Promise<Account[]> => {
    // facebook.md section 3, Token steps 4: Page tokens come from /me/accounts.
    const r = await getWithToken<{ data?: Account[] }>(
      f,
      "list pages",
      `${API}/me/accounts`,
      t.accessToken,
      { fields: "id,name,access_token,tasks", limit: PAGE_LIMIT },
    );
    // facebook.md section 1: publishing needs the CREATE_CONTENT task.
    return (r.data ?? []).filter((a) => a.id && a.tasks?.includes(CAN_PUBLISH));
  };

  /**
   * The last call that makes the post public. A lost response, a 5xx or a 200
   * without the expected id may still have published: facebook.md section 4
   * documents no idempotency key.
   */
  async function final<
    T extends { id?: string; post_id?: string; success?: boolean },
  >(
    op: string,
    url: string,
    token: string,
    fields: Record<string, string>,
  ): Promise<T> {
    return postForm<T>(f, op, url, token, fields).catch((e) => {
      if (!(e instanceof PublishError)) throw unknown();
      if (e.code.startsWith("http_5") || e.code === "network_error")
        throw unknown();
      throw e;
    });
  }

  async function done(
    i: PublishInput,
    token: string,
    id: string,
  ): Promise<PublishStepOutcome> {
    // UNVERIFIED: facebook.md section 4 says to read back permalink_url and verify in a test. A failure here is not an error: the post exists.
    const link = await getWithToken<{ permalink_url?: string }>(
      f,
      "permalink",
      `${API}/${encodeURIComponent(id)}`,
      token,
      { fields: "permalink_url" },
    ).catch(() => ({}) as { permalink_url?: string });
    const url = link.permalink_url;
    return {
      result: {
        ok: true,
        platformPostId: id,
        ...(url
          ? {
              platformPostUrl: url.startsWith("http")
                ? url
                : `https://www.facebook.com${url}`,
            }
          : {}),
        meta: { hasUrl: /https?:\/\//i.test(i.caption) || !!i.config.link },
      },
    };
  }

  const pollUntil = (d: Record<string, Json>): string =>
    str(d.poll_until) ||
    new Date(Date.now() + FACEBOOK_LIMITS.pollDeadlineMs).toISOString();

  return {
    platform: "facebook",
    async getAuthUrl({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      // facebook.md section 2: pass config_id instead of scope (Login for Business).
      url.search = new URLSearchParams({
        client_id: (await appCreds()).id,
        redirect_uri: redirectUri,
        config_id: await getSecret("META_LOGIN_CONFIG_ID"),
        response_type: "code",
        state,
      }).toString();
      return { url: url.toString() };
    },
    async exchangeCode({ code, redirectUri }) {
      const c = await appCreds();
      // facebook.md section 3: code flow, then fb_exchange_token for a long-lived user token. Secret in the query: the only form shown.
      const short = await call<TokenResponse>(
        f,
        "token exchange",
        `${TOKEN_URL}?${new URLSearchParams({
          client_id: c.id,
          client_secret: c.secret,
          redirect_uri: redirectUri,
          code,
        })}`,
      );
      if (!short.access_token) throw noToken("token");
      const long = await call<TokenResponse>(
        f,
        "long-lived exchange",
        `${TOKEN_URL}?${new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: c.id,
          client_secret: c.secret,
          fb_exchange_token: short.access_token,
        })}`,
      );
      if (!long.access_token) throw noToken("long-lived");
      return {
        accessToken: long.access_token,
        expiresAt: new Date(
          Date.now() + (long.expires_in ?? LONG_LIVED_S) * 1000,
        ).toISOString(),
        scopes: FACEBOOK_SCOPES,
      };
    },
    async refreshToken() {
      // facebook.md section 3: an expired token cannot be exchanged; the user logs in again. Page tokens carry no expiry, so this runs only for an unpicked connection.
      throw new PublishError(
        "account_reauth_required",
        "auth",
        "facebook token must be reconnected",
      );
    },
    async revoke() {
      // facebook.md names no revocation endpoint: nothing to call.
    },
    async getProfile(t) {
      // UNVERIFIED: facebook.md does not document GET /me or these fields.
      const r = await getWithToken<{ id?: string; name?: string }>(
        f,
        "get profile",
        `${API}/me`,
        t.accessToken,
        { fields: "id,name" },
      );
      if (!r.id)
        throw new PublishError(
          "bad_response",
          "permanent",
          "facebook profile response has no id",
        );
      return {
        platformUserId: r.id,
        username: r.id,
        displayName: r.name || r.id,
      };
    },
    // No token here: the picker list is rendered into HTML.
    async listTargets(t): Promise<Target[]> {
      return (await pageAccounts(t)).map((a) => ({
        id: a.id as string,
        kind: "page",
        name: a.name || (a.id as string),
      }));
    },
    async targetToken(t, targetId) {
      const page = (await pageAccounts(t)).find((a) => a.id === targetId);
      if (!page?.access_token)
        throw new PublishError(
          "bad_response",
          "permanent",
          "facebook Page token not found for this Page",
        );
      // facebook.md section 3, Token steps 5: long-lived Page tokens have no expiration date, so no expiresAt.
      return { accessToken: page.access_token, scopes: t.scopes };
    },
    configSchema: FacebookConfigSchema,
    // Reels only; a plain post does not count (facebook.md section 5, Reels: 30 API-published posts per 24-hour moving period).
    quota: {
      scope: "account",
      dailyCap: 30,
      sourceLine: "facebook.md section 5",
      appliesTo: (i) => i.config.reel === true,
    },
    validatePost,
    async publishStep(state: PublishState, i, t, fetchRange) {
      const token = t.accessToken;
      const d = state.data;
      const page = encodeURIComponent(i.account.platformUserId);
      const caption: Record<string, string> = i.caption
        ? { message: i.caption }
        : {};
      const m = i.media[0];
      const title: Record<string, string> =
        typeof i.config.title === "string" ? { title: i.config.title } : {};

      if (state.stage === "start") {
        const kind = postKind(i);
        if (kind === "TEXT") {
          const link = typeof i.config.link === "string" ? i.config.link : "";
          const r = await final<{ id?: string }>(
            "feed post",
            `${API}/${page}/feed`,
            token,
            { ...caption, ...(link ? { link } : {}) },
          );
          if (!r.id) throw unknown();
          return done(i, token, r.id);
        }
        if (!m) throw bad("media");
        if (kind === "PHOTOS") {
          if (i.media.length === 1) {
            const r = await final<{ id?: string; post_id?: string }>(
              "photo post",
              `${API}/${page}/photos`,
              token,
              {
                url: m.signedUrl,
                ...(i.caption ? { caption: i.caption } : {}),
              },
            );
            const id = r.post_id ?? r.id;
            if (!id) throw unknown();
            return done(i, token, id);
          }
          return { next: { stage: "photo", data: { idx: 0, photos: [] } } };
        }
        if (kind === "REEL") {
          // facebook.md section 4, Reels step 1.
          const r = await postForm<{ video_id?: string }>(
            f,
            "reel start",
            `${API}/${page}/video_reels`,
            token,
            { upload_phase: "start" },
          );
          if (!r.video_id) throw noId("reel start");
          return {
            next: { stage: "reel_upload", data: { video_id: r.video_id } },
          };
        }
        // facebook.md section 4, Video: upload_phase start, transfer, finish.
        const r = await postForm<
          Offsets & { upload_session_id?: string; video_id?: string }
        >(f, "video start", `${API}/${page}/videos`, token, {
          upload_phase: "start",
          file_size: String(m.bytes),
        });
        if (!r.upload_session_id) throw noId("video start");
        // UNVERIFIED: start_offset/end_offset in the response are not described in facebook.md; chunkBytes is ours.
        const offset = numOr(r.start_offset) ?? 0;
        const end =
          numOr(r.end_offset) ??
          Math.min(offset + FACEBOOK_LIMITS.chunkBytes, m.bytes);
        return {
          next: {
            stage: "video_transfer",
            data: {
              session: r.upload_session_id,
              ...(r.video_id ? { video_id: r.video_id } : {}),
              offset,
              end,
            },
          },
        };
      }

      if (state.stage === "photo") {
        const idx = num(d.idx);
        const p = i.media[idx];
        if (!p) throw bad("media index");
        // facebook.md section 1, Multi-photo: published=false photos first.
        const r = await postForm<{ id?: string }>(
          f,
          "photo upload",
          `${API}/${page}/photos`,
          token,
          { url: p.signedUrl, published: "false" },
        );
        if (!r.id) throw noId("photo upload");
        const photos = [...strs(d.photos), r.id];
        return idx + 1 < i.media.length
          ? { next: { stage: "photo", data: { idx: idx + 1, photos } } }
          : { next: { stage: "attach", data: { photos } } };
      }

      if (state.stage === "attach") {
        const photos = strs(d.photos);
        if (photos.length === 0) throw bad("photos");
        // UNVERIFIED: attached_media is not documented on the feed page (facebook.md section 1); shape is community knowledge.
        const attached = Object.fromEntries(
          photos.map((id, n) => [
            `attached_media[${n}]`,
            JSON.stringify({ media_fbid: id }),
          ]),
        );
        const r = await final<{ id?: string }>(
          "feed post",
          `${API}/${page}/feed`,
          token,
          { ...caption, ...attached },
        );
        if (!r.id) throw unknown();
        return done(i, token, r.id);
      }

      if (state.stage === "video_transfer") {
        if (!m) throw bad("media");
        const session = str(d.session);
        const offset = num(d.offset);
        const end = Math.min(num(d.end), m.bytes);
        if (!session || offset >= end) throw bad("offsets");
        const chunk = await fetchRange(m.mediaId, offset, end - 1);
        const form = new FormData();
        form.set("upload_phase", "transfer");
        form.set("upload_session_id", session);
        form.set("start_offset", String(offset));
        form.set("access_token", token);
        form.set("video_file_chunk", new Blob([chunk as BlobPart]));
        const r = await call<Offsets>(
          f,
          "video transfer",
          `${API}/${page}/videos`,
          { method: "POST", body: form },
        );
        const next = numOr(r.start_offset) ?? end;
        if (next >= m.bytes)
          return {
            next: {
              stage: "video_finish",
              data: {
                session,
                ...(d.video_id ? { video_id: d.video_id } : {}),
              },
            },
          };
        const nextEnd =
          numOr(r.end_offset) ??
          Math.min(next + FACEBOOK_LIMITS.chunkBytes, m.bytes);
        return {
          next: {
            stage: "video_transfer",
            data: { ...d, offset: next, end: nextEnd },
          },
        };
      }

      if (state.stage === "video_finish") {
        const session = str(d.session);
        if (!session) throw bad("session");
        const r = await final<{ id?: string; success?: boolean }>(
          "video finish",
          `${API}/${page}/videos`,
          token,
          {
            upload_phase: "finish",
            upload_session_id: session,
            ...title,
            ...(i.caption ? { description: i.caption } : {}),
          },
        );
        // The video id comes from the start call; the finish call must confirm.
        const id = r.id ?? str(d.video_id);
        if (!id || !(r.id || r.success === true)) throw unknown();
        return done(i, token, id);
      }

      if (state.stage === "reel_upload") {
        const videoId = str(d.video_id);
        if (!m || !videoId) throw bad("reel upload");
        // facebook.md section 4, Reels step 2, hosted file: header file_url, no auth, so no token leaves graph.facebook.com.
        await call(
          f,
          "reel upload",
          `${RUPLOAD}/${encodeURIComponent(videoId)}`,
          { method: "POST", headers: { file_url: m.signedUrl } },
        );
        return {
          next: { stage: "reel_status", data: { video_id: videoId } },
          waitMs: FACEBOOK_LIMITS.pollMs,
        };
      }

      if (state.stage === "reel_status") {
        const videoId = str(d.video_id);
        if (!videoId) throw bad("video id");
        const until = pollUntil(d);
        if (Date.parse(until) < Date.now())
          throw new PublishError(
            "media_processing_timeout",
            "permanent",
            "Facebook media processing timed out",
          );
        // facebook.md section 4, Reels step 3 and section 9: wait for ready.
        // UNVERIFIED: the doc lists the values but not where in the response they sit; video_status is the usual field.
        const r = await getWithToken<{
          status?: { video_status?: string } | string;
        }>(f, "reel status", `${API}/${encodeURIComponent(videoId)}`, token, {
          fields: "status",
        });
        const s =
          typeof r.status === "string" ? r.status : r.status?.video_status;
        if (s === "ready")
          return {
            next: { stage: "reel_finish", data: { video_id: videoId } },
          };
        if (s === "upload_failed" || s === "error" || s === "expired")
          throw new PublishError(
            "media_failed",
            "permanent",
            "Facebook could not process the Reel",
          );
        return {
          next: {
            stage: "reel_status",
            data: { video_id: videoId, poll_until: until },
          },
          waitMs: FACEBOOK_LIMITS.pollMs,
        };
      }

      if (state.stage === "reel_finish") {
        const videoId = str(d.video_id);
        if (!videoId) throw bad("video id");
        const r = await final<{ success?: boolean }>(
          "reel finish",
          `${API}/${page}/video_reels`,
          token,
          {
            upload_phase: "finish",
            video_id: videoId,
            video_state: "PUBLISHED",
            ...title,
            ...(i.caption ? { description: i.caption } : {}),
          },
        );
        if (r.success !== true) throw unknown();
        return done(i, token, videoId);
      }
      throw bad("stage");
    },
  };
}

export const facebookAdapter = createFacebookAdapter();
