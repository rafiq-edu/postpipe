import {
  type Json,
  type MediaInfo,
  type PlatformAdapter,
  PublishError,
  type PublishInput,
  type PublishStepOutcome,
} from "../types";
import {
  refreshAppPasswordSession,
  resolveHandle,
  resolvePds,
} from "./app-password";
import { BlueskyConfigSchema } from "./config";
import { buildFacets } from "./facets";
import { shrinkImage } from "./image";
import { BLUESKY_LIMITS, validatePost } from "./rules";
import { tidFor } from "./tid";
import { type Fetch, PUBLIC_API, VIDEO_API, xrpc } from "./xrpc";

/** `at://did/app.bsky.feed.post/rkey` to the public web URL (bluesky.md section 4, Post URL). */
export function postUrl(uri: string): string {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
  if (!m) throw new PublishError("bad_uri", "permanent", "unexpected post URI");
  return `https://bsky.app/profile/${m[1]}/post/${m[2]}`;
}

type Blob = Record<string, Json>;
type JobStatus = {
  jobStatus: { jobId: string; state: string; blob?: Blob; error?: string };
};

const VIDEO_POLL_MS = 3000;

// Pure over the injected fetch. The default reads the global lazily, so test servers can patch it.
export function createBlueskyAdapter(
  f: Fetch = (...a) => fetch(...a),
): PlatformAdapter {
  const oauthLater = () =>
    new PublishError(
      "oauth_not_available",
      "permanent",
      "Bluesky OAuth is not enabled yet; use an app password",
    );

  async function createPost(
    pds: string,
    token: string,
    did: string,
    i: PublishInput,
    embed?: Json,
  ): Promise<PublishStepOutcome> {
    const facets = await buildFacets(i.caption, async (h) => {
      try {
        return await resolveHandle(f, h);
      } catch {
        return null;
      }
    });
    const record: Record<string, Json> = {
      $type: "app.bsky.feed.post",
      text: i.caption,
      createdAt: new Date().toISOString(),
      facets: facets as unknown as Json,
    };
    if (embed) record.embed = embed;
    if (Array.isArray(i.config.langs)) record.langs = i.config.langs;
    if (Array.isArray(i.config.tags)) record.tags = i.config.tags;
    const collection = "app.bsky.feed.post";
    const rkey = i.target ? tidFor(i.target.id, i.target.createdAt) : undefined;
    let r: { uri: string; cid: string };
    try {
      r = await xrpc(f, pds, "com.atproto.repo.createRecord", {
        method: "POST",
        token,
        json: { repo: did, collection, rkey, record },
      });
    } catch (e) {
      // A retry after a lost response finds the first post. Error name UNVERIFIED (bluesky.md section 4).
      const dup =
        rkey &&
        e instanceof PublishError &&
        e.kind === "permanent" &&
        (e.code === "RecordAlreadyExists" || e.code === "InvalidRequest"); // the message is not trusted, so getRecord plus the text check below confirm it
      if (!dup) throw e;
      const existing = await xrpc<{
        uri: string;
        cid: string;
        value?: { text?: unknown };
      }>(f, pds, "com.atproto.repo.getRecord", {
        token,
        query: { repo: did, collection, rkey },
      }).catch(() => {
        throw e; // no record under this rkey, so the first error was the real one
      });
      // Same rkey but other text means a different post took it, so do not report it as ours.
      if (existing.value?.text !== i.caption)
        throw new PublishError(
          "rkey_conflict",
          "permanent",
          "a different post already uses this record key",
        );
      r = existing;
    }
    return {
      result: {
        ok: true,
        platformPostId: r.uri,
        platformPostUrl: postUrl(r.uri),
        meta: { hasUrl: /https?:\/\//i.test(i.caption) },
      },
    };
  }

  const aspect = (m: MediaInfo): Record<string, Json> =>
    m.width && m.height
      ? { aspectRatio: { width: m.width, height: m.height } }
      : {};

  return {
    platform: "bluesky",
    async getAuthUrl() {
      throw oauthLater();
    },
    async exchangeCode() {
      throw oauthLater();
    },
    async refreshToken(t) {
      if (t.platformData?.auth !== "app_password") throw oauthLater();
      return refreshAppPasswordSession(f, t);
    },
    async revoke(t) {
      if (t.platformData?.auth !== "app_password" || !t.refreshToken) return;
      const did = t.platformData.did;
      if (typeof did !== "string") return;
      await xrpc(
        f,
        await resolvePds(f, did),
        "com.atproto.server.deleteSession",
        {
          method: "POST",
          token: t.refreshToken,
        },
      );
    },
    async getProfile(t) {
      const did = t.platformData?.did;
      if (typeof did !== "string")
        throw new PublishError("bad_token_set", "permanent", "missing DID");
      const p = await xrpc<{
        handle: string;
        displayName?: string;
        avatar?: string;
      }>(f, PUBLIC_API, "app.bsky.actor.getProfile", { query: { actor: did } });
      return {
        platformUserId: did,
        username: p.handle,
        displayName: p.displayName || p.handle,
        avatarUrl: p.avatar,
      };
    },
    configSchema: BlueskyConfigSchema,
    quota: {
      scope: "account",
      dailyCap: BLUESKY_LIMITS.dailyCreates,
      sourceLine: "bluesky.md section 5",
    },
    validatePost,
    async publishStep(state, i, t, fetchRange) {
      const did = i.account.platformUserId;
      const token = t.accessToken;
      const pds = await resolvePds(f, did);
      const video = i.media.find((m) => m.mime.startsWith("video/"));

      if (state.stage === "processing") {
        const job = state.data.job_id;
        if (typeof job !== "string" || !video)
          throw new PublishError("bad_state", "permanent", "no video job");
        const s = (
          await xrpc<JobStatus>(f, VIDEO_API, "app.bsky.video.getJobStatus", {
            query: { jobId: job },
          })
        ).jobStatus;
        if (s.state === "JOB_STATE_FAILED" || s.state === "FAILED")
          throw new PublishError(
            "video_failed",
            "permanent",
            "Bluesky could not process the video",
          );
        if (!s.blob) return { next: state, waitMs: VIDEO_POLL_MS };
        return createPost(pds, token, did, i, {
          $type: "app.bsky.embed.video",
          video: s.blob,
          ...aspect(video),
        });
      }

      if (video) {
        // shortcut: whole file in memory (max 300 MB), stream it in chunks if workers get tight.
        const bytes = await fetchRange(video.mediaId, 0, video.bytes - 1);
        const host = new URL(pds).host;
        const auth = await xrpc<{ token: string }>(
          f,
          pds,
          "com.atproto.server.getServiceAuth",
          {
            token,
            query: {
              aud: `did:web:${host}`,
              lxm: "com.atproto.repo.uploadBlob",
              exp: String(Math.floor(Date.now() / 1000) + 30 * 60), // bluesky.md section 4, video step 1
            },
          },
        );
        const up = await xrpc<JobStatus>(
          f,
          VIDEO_API,
          "app.bsky.video.uploadVideo",
          {
            method: "POST",
            token: auth.token,
            query: { did, name: `${video.mediaId}.mp4` },
            body: bytes,
            contentType: "video/mp4",
          },
        );
        return {
          next: { stage: "processing", data: { job_id: up.jobStatus.jobId } },
          waitMs: VIDEO_POLL_MS,
        };
      }

      const images: Json[] = [];
      for (const m of i.media) {
        let data = await fetchRange(m.mediaId, 0, m.bytes - 1);
        let mime = m.mime;
        if (data.length > BLUESKY_LIMITS.imageTargetBytes) {
          data = await shrinkImage(data, BLUESKY_LIMITS.imageTargetBytes);
          mime = "image/jpeg";
        }
        const up = await xrpc<{ blob: Blob }>(
          f,
          pds,
          "com.atproto.repo.uploadBlob",
          { method: "POST", token, body: data, contentType: mime },
        );
        images.push({ alt: m.altText ?? "", image: up.blob, ...aspect(m) });
      }
      return createPost(
        pds,
        token,
        did,
        i,
        images.length ? { $type: "app.bsky.embed.images", images } : undefined,
      );
    },
  };
}

export const blueskyAdapter = createBlueskyAdapter();
