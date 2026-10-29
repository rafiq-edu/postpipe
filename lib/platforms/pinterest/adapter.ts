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
  AUTHORIZE_URL,
  apiEnv,
  appCreds,
  baseUrl,
  bearer,
  call,
  type Fetch,
  PIN_URL,
  rawCall,
} from "./api";
import { PinterestConfigSchema } from "./config";
import { boardId, isVideo, PINTEREST_LIMITS, validatePost } from "./rules";

// pinterest.md section 3, Scopes we need.
export const PINTEREST_SCOPES = [
  "boards:read",
  "boards:write",
  "pins:read",
  "pins:write",
  "user_accounts:read",
];

const BOARD_PAGE_SIZE = "250"; // pinterest.md section 4, Boards: page_size max 250
const BOARD_MAX_PAGES = 20; // ours: stops a bookmark loop

const bad = (what: string) =>
  new PublishError("bad_state", "permanent", `bad publish state: ${what}`);
const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const unknown = () =>
  new PublishError(
    "post_outcome_unknown",
    "permanent",
    "Pinterest may have created the Pin; check the board before retrying",
  );

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
};
type Register = {
  media_id?: string;
  upload_url?: string;
  upload_parameters?: Record<string, unknown>;
};

const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createPinterestAdapter(
  f: Fetch = (...a) => fetch(...a),
): PlatformAdapter {
  async function tokenCall(
    op: string,
    fields: Record<string, string>,
    prev?: TokenSet,
  ): Promise<TokenSet> {
    const c = await appCreds();
    // The env is fixed at connect and kept on refresh, so a token goes back to the host that issued it.
    const env = await apiEnv(prev?.platformData);
    const r = await call<TokenResponse>(
      f,
      op,
      `${await baseUrl({ api_env: env })}/oauth/token`,
      {
        method: "POST",
        headers: {
          authorization: c.basic,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields),
      },
    );
    if (!r.access_token)
      throw new PublishError(
        "bad_token_response",
        "permanent",
        `pinterest ${op} response has no access token`,
      );
    return {
      accessToken: r.access_token,
      // pinterest.md section 3: each refresh returns a new refresh token; store it every time.
      refreshToken: r.refresh_token ?? prev?.refreshToken,
      expiresAt: r.expires_in ? at(r.expires_in) : undefined,
      // pinterest.md section 3: refresh token lives 60 days (refresh_token_expires_in).
      refreshExpiresAt: r.refresh_token_expires_in
        ? at(r.refresh_token_expires_in)
        : undefined,
      // UNVERIFIED: pinterest.md does not show the scope field's format; space or comma assumed.
      platformData: { ...prev?.platformData, api_env: env },
      scopes: r.scope
        ? r.scope.split(/[\s,]+/)
        : (prev?.scopes ?? PINTEREST_SCOPES),
    };
  }

  /**
   * The last call that makes the Pin. A lost response, a 5xx or a 200 without
   * an id may still have created it: pinterest.md section 4 has no idempotency key.
   */
  async function createPin(
    i: PublishInput,
    token: string,
    mediaSource: Record<string, Json>,
  ): Promise<PublishStepOutcome> {
    const c = i.config;
    const body: Record<string, Json> = {
      board_id: boardId(i),
      media_source: mediaSource,
    };
    for (const k of ["board_section_id", "title", "link", "alt_text"])
      if (typeof c[k] === "string" && c[k]) body[k] = c[k];
    if (i.caption) body.description = i.caption;
    const r = await call<{ id?: string }>(
      f,
      "create pin",
      `${await baseUrl(i.account.platformData)}/pins`,
      {
        method: "POST",
        headers: { ...bearer(token), "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ).catch((e) => {
      if (!(e instanceof PublishError)) throw unknown();
      if (e.code.startsWith("http_5") || e.code === "network_error")
        throw unknown();
      throw e;
    });
    if (!r.id) throw unknown();
    return {
      result: {
        ok: true,
        platformPostId: r.id,
        platformPostUrl: `${PIN_URL}${encodeURIComponent(r.id)}/`,
        meta: { hasUrl: /https?:\/\//i.test(i.caption) || !!c.link },
      },
    };
  }

  return {
    platform: "pinterest",
    async getAuthUrl({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      // pinterest.md section 3: PKCE is UNVERIFIED, so none is sent.
      url.search = new URLSearchParams({
        client_id: (await appCreds()).id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: PINTEREST_SCOPES.join(" "),
        state,
      }).toString();
      return { url: url.toString() };
    },
    exchangeCode: ({ code, redirectUri }) =>
      tokenCall("token exchange", {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        continuous_refresh: "true", // pinterest.md section 3: needed by apps made before 2025-09-25
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
    async revoke() {
      // pinterest.md section 3: no revoke endpoint documented.
    },
    async getProfile(t) {
      // UNVERIFIED: pinterest.md names the scope user_accounts:read but not GET /user_account or its fields.
      const r = await call<{
        id?: string;
        username?: string;
        profile_image?: string;
      }>(f, "get profile", `${await baseUrl(t.platformData)}/user_account`, {
        headers: bearer(t.accessToken),
      });
      if (!r.username)
        throw new PublishError(
          "bad_response",
          "permanent",
          "pinterest profile response has no username",
        );
      return {
        // UNVERIFIED: the id field is not shown in pinterest.md; fall back to the username if absent.
        platformUserId: r.id || r.username,
        username: r.username,
        displayName: r.username,
        ...(r.profile_image ? { avatarUrl: r.profile_image } : {}),
      };
    },
    // No token here: the picker list is rendered into HTML.
    async listTargets(t): Promise<Target[]> {
      const out: Target[] = [];
      let bookmark = "";
      for (let n = 0; n < BOARD_MAX_PAGES; n++) {
        const u = new URL(`${await baseUrl(t.platformData)}/boards`);
        u.searchParams.set("page_size", BOARD_PAGE_SIZE);
        if (bookmark) u.searchParams.set("bookmark", bookmark);
        const r = await call<{
          items?: { id?: string; name?: string }[];
          bookmark?: string | null;
        }>(f, "list boards", u.toString(), { headers: bearer(t.accessToken) });
        for (const b of r.items ?? [])
          if (b.id) out.push({ id: b.id, kind: "board", name: b.name || b.id });
        // pinterest.md section 9: sandbox can return empty pages with a bookmark; keep paging.
        if (!r.bookmark) break;
        bookmark = r.bookmark;
      }
      return out;
    },
    configSchema: PinterestConfigSchema,
    // No quota: the 300 writes per day is Trial only; Standard has none (pinterest.md section 5).
    validatePost,
    async publishStep(state: PublishState, i, t, fetchRange) {
      const token = t.accessToken;
      const d = state.data;
      const m = i.media[0];
      if (!m) throw bad("media");

      if (state.stage === "start") {
        if (!isVideo(i))
          return createPin(i, token, {
            source_type: "image_url",
            url: m.signedUrl,
          });
        // pinterest.md section 4, video steps 1 and 2. Register and upload run in one step so the upload form is never stored.
        const reg = await call<Register>(
          f,
          "register media",
          `${await baseUrl(i.account.platformData)}/media`,
          {
            method: "POST",
            headers: { ...bearer(token), "content-type": "application/json" },
            body: JSON.stringify({ media_type: "video" }),
          },
        );
        if (!reg.media_id || !reg.upload_url?.startsWith("https://"))
          throw new PublishError(
            "bad_response",
            "permanent",
            "pinterest register media returned no upload target",
          );
        const form = new FormData();
        for (const [k, v] of Object.entries(reg.upload_parameters ?? {}))
          form.set(k, String(v));
        // shortcut: whole file in memory, the form upload is one request; add chunking if a size cap appears (size limit UNVERIFIED).
        const bytes = await fetchRange(m.mediaId, 0, m.bytes - 1);
        form.set("file", new Blob([bytes as BlobPart]));
        // pinterest.md section 4, step 2: no Bearer token to the upload URL; success is 204.
        await rawCall(f, "media upload", reg.upload_url, {
          method: "POST",
          body: form,
        });
        return {
          next: {
            stage: "video_status",
            data: {
              media_id: reg.media_id,
              poll_until: new Date(
                Date.now() + PINTEREST_LIMITS.pollDeadlineMs,
              ).toISOString(),
            },
          },
          waitMs: PINTEREST_LIMITS.pollMs,
        };
      }

      if (state.stage === "video_status") {
        const id = str(d.media_id);
        if (!id) throw bad("media id");
        const until = Date.parse(str(d.poll_until));
        if (Number.isNaN(until)) throw bad("poll_until");
        if (until < Date.now())
          throw new PublishError(
            "media_processing_timeout",
            "permanent",
            "Pinterest media processing timed out",
          );
        // pinterest.md section 4, step 3: registered, processing, succeeded, failed.
        const r = await call<{ status?: string }>(
          f,
          "media status",
          `${await baseUrl(i.account.platformData)}/media/${encodeURIComponent(id)}`,
          { headers: bearer(token) },
        );
        if (r.status === "succeeded")
          return { next: { stage: "video_pin", data: { media_id: id } } };
        if (r.status === "failed")
          throw new PublishError(
            "media_failed",
            "permanent",
            "Pinterest could not process the video",
          );
        return { next: state, waitMs: PINTEREST_LIMITS.pollMs };
      }

      if (state.stage === "video_pin") {
        const id = str(d.media_id);
        if (!id || !m.thumbnailUrl) throw bad("video pin");
        // pinterest.md section 4, step 4: the cover image is required.
        return createPin(i, token, {
          source_type: "video_id",
          media_id: id,
          cover_image_url: m.thumbnailUrl,
        });
      }
      throw bad("stage");
    },
  };
}

export const pinterestAdapter = createPinterestAdapter();
