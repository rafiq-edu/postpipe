import { PULL_TTL_SECONDS, signPullPath } from "../../media/pull-url";
import { getSecret, MissingSecret } from "../../secrets";
import type { PublishInput, RuleViolation } from "../types";

// Limits: docs/integrations/tiktok.md, section 4 "Publishing endpoints".
export const TIKTOK_LIMITS = {
  videoTitle: 2200, // tiktok.md section 4, Init body for video: title max 2200 UTF-16 runes
  photoTitle: 90, // tiktok.md section 4, Photo limits: title max 90 runes
  photoDescription: 4000, // tiktok.md section 4, Photo limits: description max 4000 runes
  photos: 35, // tiktok.md section 4, Photo limits: up to 35 images
  photoBytes: 20_000_000, // tiktok.md section 4, Photo limits: up to 20 MB each
  videoBytes: 4_000_000_000, // tiktok.md section 4, Video limits: size up to 4 GB (read as 10^9, the safe side)
  videoMaxMs: 600_000, // tiktok.md section 4, Video limits: up to 10 minutes via the upload endpoint
  chunkMin: 5 * 1024 * 1024, // tiktok.md section 4, Chunk rules: each chunk 5 MB to 64 MB (MB read as MiB: the safe side for the max)
  chunkMax: 64 * 1024 * 1024, // tiktok.md section 4, Chunk rules
  finalChunkMax: 128 * 1024 * 1024, // tiktok.md section 4, Chunk rules: the final chunk may be up to 128 MB
  chunkCountMax: 1000, // tiktok.md section 4, Chunk rules: total_chunk_count 1 to 1000
  chunkBytes: 10 * 1024 * 1024, // ours: inside the 5 to 64 MB window (tiktok.md section 4, Chunk rules)
  statusWaitMs: 10_000, // ours: 6 status calls a minute, under the 30 per minute limit (tiktok.md section 5)
  pollDeadlineMs: 30 * 60_000, // ours: tiktok.md gives no processing deadline
  idFallbackMs: 10 * 60_000, // implementation plan Task 28 (not in tiktok.md): settle without the post id 10 minutes after the first PUBLISH_COMPLETE
  maxRestarts: 2, // ours: new uploads after a lost chunk
  signatureToleranceMs: 5 * 60_000, // ours: tiktok.md section 6 gives no time window
};

// tiktok.md section 4, Chunk rules: Content-Type video/mp4, video/quicktime or video/webm.
const VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm"];
// tiktok.md section 4, Photo limits: WebP or JPEG.
const IMAGE_MIMES = ["image/jpeg", "image/webp"];

const len = (s: string) => [...s].length;

export const isDirect = (c: PublishInput["config"]) =>
  c.post_mode !== "MEDIA_UPLOAD";
export const isVideo = (i: PublishInput) =>
  i.media[0]?.mime.startsWith("video/") === true;

export interface ChunkPlan {
  chunkSize: number;
  count: number;
}

/**
 * tiktok.md section 4, Chunk rules: under one chunk, upload whole; else
 * total_chunk_count = floor(size / chunk_size) and the final chunk takes the rest
 * (so it is larger, at most 128 MB). 70 MiB gives 7 chunks of 10 MiB.
 */
export function chunkPlan(size: number): ChunkPlan {
  const L = TIKTOK_LIMITS;
  if (!Number.isInteger(size) || size <= 0 || size > L.videoBytes)
    throw new RangeError("bad video size");
  if (size < L.chunkBytes) return { chunkSize: size, count: 1 };
  return { chunkSize: L.chunkBytes, count: Math.floor(size / L.chunkBytes) };
}

/** Inclusive byte range of chunk `index`. The final chunk runs to the end of the file. */
export function chunkRange(
  size: number,
  p: ChunkPlan,
  index: number,
): { start: number; end: number; last: boolean } {
  const last = index === p.count - 1;
  return {
    start: index * p.chunkSize,
    end: last ? size - 1 : (index + 1) * p.chunkSize - 1,
    last,
  };
}

/**
 * Base URL of the DNS-verified media domain (tiktok.md section 2, Domain
 * verification), https with no query or fragment. Undefined = photo posts are off.
 */
export async function mediaBase(): Promise<string | undefined> {
  const raw = await getSecret("TIKTOK_MEDIA_URL_BASE").catch((e) => {
    if (e instanceof MissingSecret) return "";
    throw e;
  });
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.search || u.hash) return undefined;
    return u.href.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Signed pull URL for one photo, valid 24h. tiktok.md section 4: HTTPS, no redirects,
 * on the verified domain. The signature sits in the path because mediaBase() rejects queries.
 */
export const pullUrl = async (base: string, mediaId: string) =>
  base +
  (await signPullPath(
    mediaId,
    Math.floor(Date.now() / 1000) + PULL_TTL_SECONDS,
  ));

export async function validatePost(i: PublishInput): Promise<RuleViolation[]> {
  const v: RuleViolation[] = [];
  const L = TIKTOK_LIMITS;
  const c = i.config;
  const direct = isDirect(c);
  if (direct) {
    if (typeof c.privacy_level !== "string")
      v.push({
        code: "privacy_level_required",
        field: "config.privacy_level",
        message:
          "privacy_level is required for a direct post (tiktok.md section 1, Privacy levels)",
      });
    // tiktok.md section 7: the audit wants an explicit choice of the commercial content toggles.
    for (const f of ["brand_content_toggle", "brand_organic_toggle"])
      if (typeof c[f] !== "boolean")
        v.push({
          code: "commercial_content_required",
          field: `config.${f}`,
          message: `${f} must be true or false (tiktok.md section 7)`,
        });
    // tiktok.md section 7: branded content cannot be private.
    if (c.brand_content_toggle === true && c.privacy_level === "SELF_ONLY")
      v.push({
        code: "branded_content_not_private",
        field: "config.privacy_level",
        message: "Branded content cannot be private (tiktok.md section 7)",
      });
  }
  if (i.media.length === 0)
    v.push({
      code: "media_required",
      field: "media",
      message: "A TikTok post needs a video or photos (tiktok.md section 1)",
    });
  const m = i.media[0];
  if (!m) return v;
  if (isVideo(i)) {
    if (i.media.length > 1)
      v.push({
        code: "too_many_media",
        field: "media",
        message: "A TikTok video post has one video",
      });
    if (!VIDEO_MIMES.includes(m.mime))
      v.push({
        code: "unsupported_media",
        field: "media[0]",
        message: "Video must be MP4, MOV or WebM (tiktok.md section 4)",
      });
    if (m.bytes <= 0 || m.bytes > L.videoBytes)
      v.push({
        code: "video_too_large",
        field: "media[0]",
        message: "Video must be at most 4 GB (tiktok.md section 4)",
      });
    if (m.durationMs !== undefined && m.durationMs > L.videoMaxMs)
      v.push({
        code: "video_too_long",
        field: "media[0]",
        message: "Video is over 10 minutes (tiktok.md section 4)",
      });
    const title = typeof c.title === "string" ? c.title : i.caption;
    if (len(title) > L.videoTitle)
      v.push({
        code: "caption_too_long",
        field: typeof c.title === "string" ? "config.title" : "caption",
        message: "Video title is over 2200 characters (tiktok.md section 4)",
      });
    return v;
  }
  // Photo post (tiktok.md section 4, Photo limits).
  if (i.media.length > L.photos)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "A photo post has at most 35 images (tiktok.md section 4)",
    });
  i.media.forEach((p, n) => {
    if (!IMAGE_MIMES.includes(p.mime))
      v.push({
        code: "unsupported_media",
        field: `media[${n}]`,
        message:
          "Photos must be JPEG or WebP, and a post cannot mix photos and video (tiktok.md section 4)",
      });
    else if (p.bytes > L.photoBytes)
      v.push({
        code: "image_too_large",
        field: `media[${n}]`,
        message: "A photo is over 20 MB (tiktok.md section 4)",
      });
  });
  if (c.disable_duet !== undefined || c.disable_stitch !== undefined)
    v.push({
      code: "unsupported_option",
      field: "config",
      message: "Photo posts only have disable_comment (tiktok.md section 1)",
    });
  if (
    typeof c.photo_cover_index === "number" &&
    c.photo_cover_index >= i.media.length
  )
    v.push({
      code: "invalid_cover_index",
      field: "config.photo_cover_index",
      message: "photo_cover_index must point at one of the photos",
    });
  if (typeof c.title === "string" && len(c.title) > L.photoTitle)
    v.push({
      code: "title_too_long",
      field: "config.title",
      message: "Photo title is over 90 characters (tiktok.md section 4)",
    });
  if (len(i.caption) > L.photoDescription)
    v.push({
      code: "caption_too_long",
      field: "caption",
      message:
        "Photo description is over 4000 characters (tiktok.md section 4)",
    });
  // tiktok.md section 2 and 9: photos only via PULL_FROM_URL from a verified domain.
  if (!(await mediaBase()))
    v.push({
      code: "tiktok_photo_unavailable",
      field: "media",
      message:
        "TikTok photo posts need a DNS-verified media domain (TIKTOK_MEDIA_URL_BASE), which is not set up",
    });
  return v;
}
