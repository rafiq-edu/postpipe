import { graphemeLength, utf8ByteLength } from "../../text/length";
import type { PublishInput, RuleViolation } from "../types";

export const BLUESKY_LIMITS = {
  graphemes: 300, // bluesky.md section 1
  bytes: 3000, // bluesky.md section 1
  images: 4, // bluesky.md section 1
  videos: 1, // bluesky.md section 1
  langs: 3, // bluesky.md section 1
  tags: 8, // bluesky.md section 1
  imageTargetBytes: 1_000_000, // bluesky.md section 4 (we resize to this to be safe)
  imageBlobMaxBytes: 52_428_800, // bluesky.md section 4 (PDS blob cap)
  videoBytes: 300_000_000, // bluesky.md section 4
  videoMs: 600_000, // bluesky.md section 4 (10 minutes)
  dailyCreates: 11_666, // bluesky.md section 5 (35,000 points per day / 3 per create)
};

export function validatePost(i: PublishInput): RuleViolation[] {
  const v: RuleViolation[] = [];
  const L = BLUESKY_LIMITS;
  if (graphemeLength(i.caption) > L.graphemes)
    v.push({
      code: "caption_too_long",
      field: "caption",
      message: "Text is over 300 characters (bluesky.md section 1)",
    });
  if (utf8ByteLength(i.caption) > L.bytes)
    v.push({
      code: "caption_too_many_bytes",
      field: "caption",
      message: "Text is over 3,000 bytes (bluesky.md section 1)",
    });
  const images = i.media.filter((m) => m.mime.startsWith("image/"));
  const videos = i.media.filter((m) => m.mime.startsWith("video/"));
  if (images.length + videos.length < i.media.length)
    v.push({
      code: "unsupported_media",
      field: "media",
      message: "Only images and mp4 video are supported",
    });
  if (images.length > L.images)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "More than 4 images (bluesky.md section 1)",
    });
  if (videos.length > L.videos)
    v.push({
      code: "too_many_videos",
      field: "media",
      message: "More than 1 video (bluesky.md section 1)",
    });
  if (images.length > 0 && videos.length > 0)
    v.push({
      code: "mixed_media",
      field: "media",
      message: "Images and video cannot be mixed (bluesky.md section 1)",
    });
  i.media.forEach((m, idx) => {
    const field = `media[${idx}]`;
    if (m.mime.startsWith("image/") && m.bytes > L.imageBlobMaxBytes)
      v.push({
        code: "image_too_large",
        field,
        message: "Image is over 50 MB (bluesky.md section 4)",
      });
    if (m.mime.startsWith("video/")) {
      if (m.mime !== "video/mp4")
        v.push({
          code: "video_not_mp4",
          field,
          message: "Video must be video/mp4 (bluesky.md section 4)",
        });
      if (m.bytes > L.videoBytes)
        v.push({
          code: "video_too_large",
          field,
          message: "Video is over 300 MB (bluesky.md section 4)",
        });
      if ((m.durationMs ?? 0) > L.videoMs)
        v.push({
          code: "video_too_long",
          field,
          message: "Video is over 10 minutes (bluesky.md section 4)",
        });
    }
  });
  const { langs, tags } = i.config;
  if (Array.isArray(langs) && langs.length > L.langs)
    v.push({
      code: "too_many_langs",
      field: "config.langs",
      message: "More than 3 languages (bluesky.md section 1)",
    });
  if (Array.isArray(tags) && tags.length > L.tags)
    v.push({
      code: "too_many_tags",
      field: "config.tags",
      message: "More than 8 tags (bluesky.md section 1)",
    });
  return v;
}
