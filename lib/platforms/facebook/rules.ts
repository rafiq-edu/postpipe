import type { PublishInput, RuleViolation } from "../types";

// Limits: docs/integrations/facebook.md, section 4 "Publishing endpoints".
// UNVERIFIED and not checked (facebook.md section 4): caption and text length, photo count per post,
// video size, duration and chunk size. Reel file size is also UNVERIFIED.
export const FACEBOOK_LIMITS = {
  photoBytes: 10_000_000, // facebook.md section 4, Photo: max 10 MB
  reelMinMs: 3_000, // facebook.md section 4, Reel specs: duration 3 to 90 seconds
  reelMaxMs: 90_000,
  // Ours, not in facebook.md: the doc gives no chunk size for videos. Used when the start/transfer
  // responses give no offsets (their shape is UNVERIFIED too).
  chunkBytes: 4 * 1024 * 1024,
  pollMs: 30_000, // ours: facebook.md section 9 says wait for ready but gives no interval
  pollDeadlineMs: 30 * 60_000, // ours: no processing time in facebook.md
};

const PHOTO_MIMES = [
  "image/jpeg",
  "image/bmp",
  "image/png",
  "image/gif",
  "image/tiff",
]; // facebook.md section 4, Photo: .jpeg, .bmp, .png, .gif, .tiff
const REEL_MIME = "video/mp4"; // facebook.md section 4, Reel specs: MP4

export type FacebookKind = "TEXT" | "PHOTOS" | "VIDEO" | "REEL";

export function postKind(i: PublishInput): FacebookKind {
  const first = i.media[0];
  if (!first) return "TEXT";
  if (first.mime.startsWith("video/"))
    return i.config.reel === true ? "REEL" : "VIDEO";
  return "PHOTOS";
}

export function validatePost(i: PublishInput): RuleViolation[] {
  const v: RuleViolation[] = [];
  const L = FACEBOOK_LIMITS;
  const kind = postKind(i);
  const videos = i.media.filter((m) => m.mime.startsWith("video/")).length;
  if (i.media.length === 0 && !i.caption && !i.config.link)
    v.push({
      code: "content_required",
      field: "caption",
      message: "A post needs a message or a link (facebook.md section 1)",
    });
  if (i.config.link && i.media.length > 0)
    v.push({
      code: "config_media_mismatch",
      field: "config.link",
      message:
        "link works only on a post without media (facebook.md section 4, Text or link post)",
    });
  if (videos > 0 && (videos > 1 || i.media.length > 1))
    v.push({
      code: "too_many_media",
      field: "media",
      message: "A video post takes exactly one video and no other media",
    });
  if (i.config.reel === true && kind !== "REEL")
    v.push({
      code: "config_media_mismatch",
      field: "config.reel",
      message: "reel needs one video (facebook.md section 4, Reels)",
    });
  i.media.forEach((m, idx) => {
    const field = `media[${idx}]`;
    if (m.mime.startsWith("image/")) {
      if (!PHOTO_MIMES.includes(m.mime))
        v.push({
          code: "unsupported_media",
          field,
          message:
            "Photos must be JPEG, BMP, PNG, GIF or TIFF (facebook.md section 4)",
        });
      if (m.bytes > L.photoBytes)
        v.push({
          code: "image_too_large",
          field,
          message: "Photo is over 10 MB (facebook.md section 4)",
        });
    } else if (m.mime.startsWith("video/")) {
      if (kind === "REEL") {
        if (m.mime !== REEL_MIME)
          v.push({
            code: "unsupported_media",
            field,
            message: "Reels must be MP4 (facebook.md section 4, Reel specs)",
          });
        const ms = m.durationMs;
        if (ms !== undefined && (ms < L.reelMinMs || ms > L.reelMaxMs))
          v.push({
            code: "video_duration",
            field,
            message:
              "Reel must be 3 to 90 seconds (facebook.md section 4, Reel specs)",
          });
      }
    } else
      v.push({
        code: "unsupported_media",
        field,
        message: "Only images and video are supported",
      });
  });
  return v;
}
