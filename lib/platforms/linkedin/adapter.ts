import { getSecret } from "../../secrets";
import {
  type Json,
  type PlatformAdapter,
  PublishError,
  type PublishInput,
  type PublishState,
  type PublishStepOutcome,
} from "../types";
import {
  AUTHORIZE_URL,
  call,
  clientCreds,
  type Fetch,
  REST,
  raw,
  restHeaders,
  TOKEN_URL,
  USERINFO_URL,
} from "./api";
import { LinkedInConfigSchema } from "./config";
import { LINKEDIN_LIMITS, validatePost } from "./rules";

// Scopes from linkedin.md section 3.
export const LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "w_member_social",
];

// Reserved characters from linkedin.md section 9, "Escaping".
const RESERVED = /[|{}@[\]()<>#\\*_~]/g;
export const escapeCommentary = (s: string) => s.replace(RESERVED, "\\$&");

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
};
type PartInfo = { firstByte: number; lastByte: number; uploadUrl: string };
type VideoInit = {
  value?: {
    video?: string;
    uploadToken?: string;
    uploadInstructions?: PartInfo[];
  };
};

const bad = (what: string) =>
  new PublishError("bad_state", "permanent", `bad publish state: ${what}`);
const num = (v: Json | undefined) => (typeof v === "number" ? v : 0);
const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const ids = (v: Json | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const noResponse = (what: string) =>
  new PublishError(
    "bad_response",
    "permanent",
    `linkedin ${what} returned no id`,
  );

// Bearer goes only to LinkedIn hosts (linkedin.md section 4, Image step 2 sends it).
const isLinkedIn = (u: string) => {
  const url = new URL(u);
  return (
    url.protocol === "https:" &&
    /(^|\.)(linkedin|licdn)\.com$/.test(url.hostname)
  );
};

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createLinkedInAdapter(
  f: Fetch = (...a) => fetch(...a),
): PlatformAdapter {
  async function put(
    op: string,
    url: string,
    token: string,
    body: Uint8Array,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/octet-stream",
    };
    if (isLinkedIn(url)) headers.authorization = `Bearer ${token}`;
    return raw(f, op, url, { method: "PUT", headers, body: body as BodyInit });
  }

  async function createPost(
    i: PublishInput,
    token: string,
    mediaIds: string[],
  ): Promise<PublishStepOutcome> {
    const body: Record<string, Json> = {
      author: `urn:li:person:${i.account.platformUserId}`, // UNVERIFIED: measure in Step 0 (linkedin.md section 3, Member URN)
      commentary: escapeCommentary(i.caption),
      visibility:
        typeof i.config.visibility === "string"
          ? i.config.visibility
          : "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor:
        i.config.is_reshare_disabled_by_author === true,
    };
    const isVideo = i.media[0]?.mime.startsWith("video/");
    const alt = (n: number) => i.media[n]?.altText;
    if (mediaIds.length === 1)
      body.content = {
        media: isVideo
          ? { id: mediaIds[0] }
          : { id: mediaIds[0], ...(alt(0) ? { altText: alt(0) } : {}) },
      };
    else if (mediaIds.length > 1)
      body.content = {
        multiImage: {
          images: mediaIds.map((id, n) => ({
            id,
            ...(alt(n) ? { altText: alt(n) } : {}),
          })),
        },
      };
    // A lost response or 5xx may still have created the post; no idempotency key is documented (linkedin.md section 4).
    const unknown = () =>
      new PublishError(
        "post_outcome_unknown",
        "permanent",
        "LinkedIn may have created the post; check the account before retrying",
      );
    const res = await raw(f, "create post", `${REST}/posts`, {
      method: "POST",
      headers: restHeaders(token),
      body: JSON.stringify(body),
    }).catch((e) => {
      if (!(e instanceof PublishError)) throw unknown();
      if (e.code.startsWith("http_5")) throw unknown();
      throw e;
    });
    const id = res.headers.get("x-restli-id");
    if (!id) throw noResponse("create post");
    return {
      result: {
        ok: true,
        platformPostId: id,
        platformPostUrl: `https://www.linkedin.com/feed/update/${id}/`, // linkedin.md section 4, Post URL
        meta: { hasUrl: /https?:\/\//i.test(i.caption) },
      },
    };
  }

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
    platform: "linkedin",
    async getAuthUrl({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: await getSecret("LINKEDIN_CLIENT_ID"),
        redirect_uri: redirectUri,
        scope: LINKEDIN_SCOPES.join(" "),
        state,
      }).toString(); // no PKCE: linkedin.md section 3 does not mention it
      return { url: url.toString() };
    },
    async exchangeCode({ code, redirectUri }) {
      const c = await clientCreds();
      const r = await call<TokenResponse>(f, "token exchange", TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: c.id,
          client_secret: c.secret,
          redirect_uri: redirectUri,
        }),
      });
      if (!r.access_token)
        throw new PublishError(
          "bad_token_response",
          "permanent",
          "linkedin token response has no access token",
        );
      return {
        accessToken: r.access_token,
        // No refresh token for self-serve apps (linkedin.md section 3, Token lifetime).
        expiresAt: new Date(
          Date.now() + (r.expires_in ?? 5_184_000) * 1000, // 60 days: linkedin.md section 3
        ).toISOString(),
        scopes: r.scope ? r.scope.split(/[ ,]+/) : LINKEDIN_SCOPES,
      };
    },
    async refreshToken() {
      throw new PublishError(
        "account_reauth_required",
        "auth",
        "linkedin has no refresh token for this app",
      );
    },
    async revoke() {
      // linkedin.md names no revocation endpoint: nothing to call.
    },
    async getProfile(t) {
      const r = await call<{ sub?: string; name?: string; picture?: string }>(
        f,
        "get profile",
        USERINFO_URL,
        { headers: { authorization: `Bearer ${t.accessToken}` } },
      );
      if (!r.sub)
        throw new PublishError(
          "bad_response",
          "permanent",
          "linkedin profile response has no sub",
        );
      return {
        platformUserId: r.sub,
        username: r.name || r.sub, // LinkedIn has no handle
        displayName: r.name || r.sub,
        avatarUrl: r.picture,
      };
    },
    configSchema: LinkedInConfigSchema,
    validatePost,
    async publishStep(state: PublishState, i, t, fetchRange) {
      const token = t.accessToken;
      if (t.expiresAt && Date.parse(t.expiresAt) <= Date.now())
        throw new PublishError(
          "account_reauth_required",
          "auth",
          "linkedin token expired",
        );
      const d = state.data;
      const done = ids(d.ids);
      const idx = num(d.idx);

      if (state.stage === "post") return createPost(i, token, done);
      if (i.media.length === 0) return createPost(i, token, []);
      const m = i.media[idx];
      if (!m) throw bad("media index");
      const owner = `urn:li:person:${i.account.platformUserId}`;

      if (state.stage === "start" || state.stage === "init") {
        if (!m.mime.startsWith("video/")) {
          // Image: init and the PUT in one step, so the upload URL never reaches state.
          const r = await call<{
            value?: { uploadUrl?: string; image?: string };
          }>(f, "image init", `${REST}/images?action=initializeUpload`, {
            method: "POST",
            headers: restHeaders(token),
            body: JSON.stringify({ initializeUploadRequest: { owner } }),
          });
          const { uploadUrl, image } = r.value ?? {};
          if (!uploadUrl || !image) throw noResponse("image init");
          await put(
            "image upload",
            uploadUrl,
            token,
            await fetchRange(m.mediaId, 0, m.bytes - 1),
          );
          // w_member_social cannot GET /rest/images (linkedin.md section 4), so no status poll.
          // No status poll is possible, so wait before posting (AVAILABLE first: linkedin.md section 9).
          const next = afterMedia(i, idx, [...done, image]);
          return "next" in next && next.next.stage === "post"
            ? { ...next, waitMs: 5000 }
            : next;
        }
        const r = await call<VideoInit>(
          f,
          "video init",
          `${REST}/videos?action=initializeUpload`,
          {
            method: "POST",
            headers: restHeaders(token),
            body: JSON.stringify({
              initializeUploadRequest: { owner, fileSizeBytes: m.bytes },
            }),
          },
        );
        const v = r.value;
        const parts = v?.uploadInstructions;
        if (!v?.video || !v.uploadToken || !parts?.length)
          throw noResponse("video init");
        // Part URLs are signed by LinkedIn; linkedin.md does not say they carry the user token. UNVERIFIED.
        // The upload token is needed again at finalize, so it stays in state.
        return {
          next: {
            stage: "part",
            data: {
              idx,
              ids: done,
              video: v.video,
              upload_token: v.uploadToken,
              parts: parts.map((p) => [p.firstByte, p.lastByte, p.uploadUrl]),
              seg: 0,
              etags: [],
            },
          },
        };
      }

      const video = str(d.video);
      if (!video) throw bad("video id");
      const waitData = { idx, ids: done, video };

      if (state.stage === "part") {
        const parts = Array.isArray(d.parts) ? d.parts : [];
        const seg = num(d.seg);
        const p = parts[seg];
        if (!Array.isArray(p)) throw bad("segment");
        const [first, last, url] = p;
        if (
          typeof first !== "number" ||
          typeof last !== "number" ||
          typeof url !== "string" ||
          last - first + 1 > LINKEDIN_LIMITS.partBytes
        )
          throw bad("segment");
        const res = await put(
          "video part",
          url,
          token,
          await fetchRange(m.mediaId, first, last),
        );
        const etag = res.headers.get("etag");
        if (!etag) throw noResponse("video part");
        const etags = [...ids(d.etags), etag];
        return seg + 1 < parts.length
          ? { next: { stage: "part", data: { ...d, seg: seg + 1, etags } } }
          : {
              next: {
                stage: "finalize",
                data: { ...waitData, upload_token: str(d.upload_token), etags },
              },
            };
      }

      if (state.stage === "finalize") {
        await raw(f, "video finalize", `${REST}/videos?action=finalizeUpload`, {
          method: "POST",
          headers: restHeaders(token),
          body: JSON.stringify({
            finalizeUploadRequest: {
              video,
              uploadToken: str(d.upload_token),
              uploadedPartIds: ids(d.etags),
            },
          }),
        });
        return { next: { stage: "status", data: waitData }, waitMs: 5000 }; // poll interval is ours, not a doc limit
      }

      if (state.stage === "status") {
        const until =
          str(d.poll_until) ||
          new Date(Date.now() + LINKEDIN_LIMITS.videoPollMs).toISOString();
        if (Date.parse(until) < Date.now())
          throw new PublishError(
            "media_processing_timeout",
            "permanent",
            "LinkedIn media processing timed out",
          );
        const pending = { idx, ids: done, video, poll_until: until };
        const r = await call<{ status?: string }>(
          f,
          "video status",
          `${REST}/videos/${encodeURIComponent(video)}`, // URN must be URL-encoded: linkedin.md section 9
          { headers: restHeaders(token) },
        );
        if (r.status === "PROCESSING_FAILED")
          throw new PublishError(
            "media_failed",
            "permanent",
            "LinkedIn could not process the media",
          );
        if (r.status !== "AVAILABLE")
          return { next: { stage: "status", data: pending }, waitMs: 5000 };
        return afterMedia(i, idx, [...done, video]);
      }
      throw bad("stage");
    },
  };
}

export const linkedinAdapter = createLinkedInAdapter();
