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
  appCreds,
  bearer,
  call,
  type Fetch,
  failure,
  isUploadSession,
  QUOTA_TZ,
  REVOKE_URL,
  rawCall,
  retryAfterMs,
  send,
  TOKEN_URL,
  UPLOAD_URL,
  WATCH_URL,
} from "./api";
import { YoutubeConfigSchema } from "./config";
import { descriptionOf, validatePost, YOUTUBE_LIMITS } from "./rules";

// youtube.md section 3, Scopes: narrowest set for upload and channel info.
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

const bad = (what: string) =>
  new PublishError("bad_state", "permanent", `bad publish state: ${what}`);
const unknown = () =>
  new PublishError(
    "post_outcome_unknown",
    "permanent",
    "YouTube may have created the video; check the channel before retrying",
  );

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

// The resumable upload state. Holds the session URI (a secret-like URL): never logged, hidden by migration 0015.
interface Up {
  session: string;
  offset: number;
  /** The last chunk was sent at least once: the video may exist, so a 404 is not a restart. */
  finalSent: boolean;
  stalls: number;
  restarts: number;
  tries: number;
  authRetry: number;
  /** A chunk got an unexpected 4xx and we already asked for status once. */
  probed: boolean;
}

const pack = (u: Up): Record<string, Json> => ({
  session: u.session,
  offset: u.offset,
  final_sent: u.finalSent,
  stalls: u.stalls,
  restarts: u.restarts,
  tries: u.tries,
  auth_retry: u.authRetry,
  probed: u.probed,
});

const num = (v: Json | undefined) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;

function readUp(d: Record<string, Json>, total: number): Up {
  if (!isUploadSession(d.session)) throw bad("session");
  const offset = num(d.offset);
  if (offset >= total) throw bad("offset");
  return {
    session: d.session,
    offset,
    finalSent: d.final_sent === true,
    stalls: num(d.stalls),
    restarts: num(d.restarts),
    tries: num(d.tries),
    authRetry: num(d.auth_retry),
    probed: d.probed === true,
  };
}

const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createYoutubeAdapter(
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
        client_id: c.id,
        client_secret: c.secret,
        ...fields,
      }),
    });
    if (!r.access_token)
      throw new PublishError(
        "bad_token_response",
        "permanent",
        `youtube ${op} response has no access token`,
      );
    return {
      accessToken: r.access_token,
      // youtube.md section 3: a refresh token comes only on first consent; keep the old one otherwise.
      refreshToken: r.refresh_token ?? prev?.refreshToken,
      // youtube.md section 3: lifetime varies; always read expires_in.
      expiresAt: r.expires_in ? at(r.expires_in) : undefined,
      scopes: r.scope ? r.scope.split(/\s+/) : (prev?.scopes ?? YOUTUBE_SCOPES),
    };
  }

  async function start(
    i: PublishInput,
    m: MediaInfo,
    token: string,
    restarts: number,
  ): Promise<PublishStepOutcome> {
    const c = i.config;
    const snippet: Record<string, Json> = {
      title: String(c.title ?? ""),
      description: descriptionOf(i),
    };
    if (Array.isArray(c.tags) && c.tags.length) snippet.tags = c.tags;
    const status: Record<string, Json> = {
      // youtube.md section 4, Fields: an omitted privacyStatus means public; we default to private instead of guessing.
      privacyStatus:
        typeof c.privacy_status === "string" ? c.privacy_status : "private",
      selfDeclaredMadeForKids: c.made_for_kids === true,
    };
    if (typeof c.contains_synthetic_media === "boolean")
      status.containsSyntheticMedia = c.contains_synthetic_media;
    const res = await rawCall(f, "start upload", UPLOAD_URL, {
      method: "POST",
      headers: {
        ...bearer(token),
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(m.bytes),
        "x-upload-content-type": m.mime,
      },
      body: JSON.stringify({ snippet, status }),
    });
    const session = res.headers.get("location");
    // The token goes only to a Google upload host.
    if (!isUploadSession(session))
      throw new PublishError(
        "bad_upload_url",
        "permanent",
        "youtube start upload returned an unexpected upload URL",
      );
    return {
      next: {
        stage: "upload",
        data: pack({
          session,
          offset: 0,
          finalSent: false,
          stalls: 0,
          restarts,
          tries: 0,
          authRetry: 0,
          probed: false,
        }),
      },
    };
  }

  /** One chunk PUT (stage upload) or one status query (stage status). */
  async function transfer(
    isStatus: boolean,
    u: Up,
    m: MediaInfo,
    token: string,
    fetchRange: (id: string, s: number, e: number) => Promise<Uint8Array>,
  ): Promise<PublishStepOutcome> {
    const L = YOUTUBE_LIMITS;
    const total = m.bytes;
    // youtube.md section 4, Resume after failure: empty PUT with Content-Range: bytes */TOTAL.
    const end = isStatus ? -1 : Math.min(u.offset + L.chunkBytes, total) - 1;
    const finalSent = u.finalSent || (!isStatus && end === total - 1);
    const op = isStatus ? "upload status" : "upload chunk";
    const init: RequestInit = isStatus
      ? {
          method: "PUT",
          headers: { ...bearer(token), "content-range": `bytes */${total}` },
        }
      : {
          method: "PUT",
          headers: {
            ...bearer(token),
            "content-range": `bytes ${u.offset}-${end}/${total}`,
            "content-type": m.mime,
          },
          body: (await fetchRange(m.mediaId, u.offset, end)) as BodyInit,
        };
    let res: Response | undefined;
    try {
      res = await send(f, op, u.session, init);
    } catch (e) {
      if (!(e instanceof PublishError)) throw e;
    }
    // Lost response, 429 or 5xx: the chunk may or may not have arrived. Never restart; ask for status.
    if (!res || res.status === 429 || res.status >= 500) {
      const tries = u.tries + 1;
      if (tries > L.maxStatusTries) {
        if (finalSent) throw unknown();
        throw new PublishError(
          "network_error",
          "retryable",
          `youtube ${op} failed: gave up after ${L.maxStatusTries} tries`,
        );
      }
      return {
        next: { stage: "status", data: pack({ ...u, finalSent, tries }) },
        waitMs: (res && retryAfterMs(res)) || L.statusWaitMs,
      };
    }
    if (res.status === 200 || res.status === 201) {
      const r = (await res.json().catch(() => ({}))) as { id?: unknown };
      if (typeof r.id !== "string" || !r.id) throw unknown();
      return {
        result: {
          ok: true,
          platformPostId: r.id,
          platformPostUrl: `${WATCH_URL}${encodeURIComponent(r.id)}`,
        },
      };
    }
    if (res.status === 308) {
      // youtube.md section 4: Range: bytes=0-N means send from N+1; no Range means nothing arrived.
      const h = res.headers.get("range");
      const mt = h === null ? null : /^bytes=0-(\d+)$/.exec(h);
      if (h !== null && !mt)
        throw new PublishError(
          "bad_response",
          "permanent",
          "youtube upload returned an unreadable Range header",
        );
      const offset = mt ? Number(mt[1]) + 1 : 0;
      if (offset >= total) throw unknown(); // every byte is there but no video came back
      const stalls = offset <= u.offset ? u.stalls + 1 : u.stalls;
      if (stalls > L.maxStalls)
        throw new PublishError(
          "upload_stalled",
          "permanent",
          "youtube upload is not moving forward",
        );
      return {
        next: {
          stage: "upload",
          data: pack({
            ...u,
            offset,
            finalSent,
            stalls,
            tries: 0,
            authRetry: 0,
          }),
        },
      };
    }
    if (res.status === 404) {
      // youtube.md section 4: 404 = session expired, start again from byte 0. Not after the last chunk was sent.
      if (finalSent) throw unknown();
      if (u.restarts >= L.maxRestarts)
        throw new PublishError(
          "session_expired",
          "permanent",
          "youtube upload session expired too many times",
        );
      return { next: { stage: "start", data: { restarts: u.restarts + 1 } } };
    }
    if (res.status === 401 && u.authRetry < 1)
      // The token may have run out during a long upload: wait, so the next run refreshes it.
      return {
        next: {
          stage: isStatus ? "status" : "upload",
          data: pack({ ...u, finalSent, authRetry: 1 }),
        },
        waitMs: 1_000,
      };
    const e = await failure(op, res);
    // After the last chunk was sent the video may exist: no retry (it would upload twice) and no auth flip.
    if (finalSent) throw unknown();
    const quota =
      e.code === "quota_exceeded" || e.code === "upload_limit_exceeded";
    // youtube.md section 9 (Gotchas, Content-Range math): after any error, ask for status before resuming; once per session so it cannot loop.
    if (
      !isStatus &&
      !u.probed &&
      !quota &&
      res.status !== 401 &&
      res.status >= 400 &&
      res.status < 500
    )
      return {
        next: { stage: "status", data: pack({ ...u, probed: true }) },
      };
    throw e;
  }

  return {
    platform: "youtube",
    async getAuthUrl({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      // youtube.md section 3: PKCE is UNVERIFIED, so none is sent. offline + consent give a refresh token every time.
      url.search = new URLSearchParams({
        client_id: (await appCreds()).id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: YOUTUBE_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        state,
      }).toString();
      return { url: url.toString() };
    },
    exchangeCode: ({ code, redirectUri }) =>
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
      // youtube.md section 3: revoke right away when the user disconnects.
      await rawCall(f, "revoke", REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: t.refreshToken ?? t.accessToken }),
      });
    },
    async getProfile(t) {
      // UNVERIFIED: youtube.md names no channels.list call; mine=true is the usual form.
      const r = await call<{
        items?: {
          id?: string;
          snippet?: {
            title?: string;
            customUrl?: string;
            thumbnails?: { default?: { url?: string } };
          };
        }[];
      }>(f, "get profile", `${API}/channels?part=snippet&mine=true`, {
        headers: bearer(t.accessToken),
      });
      const ch = r.items?.[0];
      if (!ch?.id)
        throw new PublishError(
          "no_channel",
          "permanent",
          "this Google account has no YouTube channel",
        );
      const name = ch.snippet?.title || ch.id;
      const avatar = ch.snippet?.thumbnails?.default?.url;
      return {
        platformUserId: ch.id,
        username: ch.snippet?.customUrl || name,
        displayName: name,
        ...(avatar ? { avatarUrl: avatar } : {}),
      };
    },
    configSchema: YoutubeConfigSchema,
    // youtube.md section 5: videos.insert has its own bucket of 100 calls per day per project; the day resets at Pacific midnight.
    quota: {
      scope: "project",
      dailyCap: 100,
      timeZone: QUOTA_TZ,
      sourceLine: "youtube.md section 5",
    },
    validatePost,
    async publishStep(state: PublishState, i, t, fetchRange) {
      const m = i.media[0];
      if (!m || m.bytes <= 0) throw bad("media");
      const restarts = num(state.data.restarts);
      if (state.stage === "start") return start(i, m, t.accessToken, restarts);
      if (state.stage === "upload" || state.stage === "status")
        return transfer(
          state.stage === "status",
          readUp(state.data, m.bytes),
          m,
          t.accessToken,
          fetchRange,
        );
      throw bad("stage");
    },
  };
}

export const youtubeAdapter = createYoutubeAdapter();
