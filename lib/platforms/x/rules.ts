import { xWeightedLength } from "../../text/length";
import type { PublishInput, RuleViolation } from "../types";

export const X_LIMITS = {
  weightedChars: 280, // x.md section 4, Text
  images: 4, // x.md section 1: "up to 4 photos, 1 animated GIF, or 1 video"
  gifs: 1, // x.md section 1
  videos: 1, // x.md section 1
  imageBytes: 5_000_000, // x.md section 4, Media limits: image 5 MB
  gifBytes: 15_000_000, // x.md section 4, Media limits: GIF 15 MB
  videoBytes: 8_000_000_000, // x.md section 4, Media limits: video 8 GB default (125 min / 16 GB for Premium is not assumed)
  videoMs: 20 * 60_000, // x.md section 4, Media limits: video 20 min default
  chunkBytes: 5_000_000, // x.md section 4: "keep each at or below 5 MB"
};

export function validatePost(i: PublishInput): RuleViolation[] {
  const v: RuleViolation[] = [];
  const L = X_LIMITS;
  if (xWeightedLength(i.caption) > L.weightedChars)
    v.push({
      code: "caption_too_long",
      field: "caption",
      message: "Text is over 280 weighted characters (x.md section 4)",
    });
  if (i.caption.trim() === "" && i.media.length === 0)
    v.push({
      code: "caption_required",
      field: "caption",
      message: "Text is required unless media is given (x.md section 1)",
    });
  const gifs = i.media.filter((m) => m.mime === "image/gif");
  const images = i.media.filter(
    (m) => m.mime.startsWith("image/") && m.mime !== "image/gif",
  );
  const videos = i.media.filter((m) => m.mime.startsWith("video/"));
  if (images.length + gifs.length + videos.length < i.media.length)
    v.push({
      code: "unsupported_media",
      field: "media",
      message: "Only images, GIF and video are supported",
    });
  if (images.length > L.images)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "More than 4 images (x.md section 1)",
    });
  if (gifs.length > L.gifs || videos.length > L.videos)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "Only 1 GIF or 1 video per post (x.md section 1)",
    });
  if (
    [images.length, gifs.length, videos.length].filter((n) => n > 0).length > 1
  )
    v.push({
      code: "mixed_media",
      field: "media",
      message: "Images, GIF and video cannot be mixed (x.md section 1)",
    });
  i.media.forEach((m, idx) => {
    const field = `media[${idx}]`;
    if (m.mime === "image/gif" && m.bytes > L.gifBytes)
      v.push({
        code: "gif_too_large",
        field,
        message: "GIF is over 15 MB (x.md section 4)",
      });
    else if (m.mime.startsWith("image/") && m.bytes > L.imageBytes)
      v.push({
        code: "image_too_large",
        field,
        message: "Image is over 5 MB (x.md section 4)",
      });
    if (m.mime.startsWith("video/")) {
      if (m.bytes > L.videoBytes)
        v.push({
          code: "video_too_large",
          field,
          message: "Video is over 8 GB (x.md section 4)",
        });
      if ((m.durationMs ?? 0) > L.videoMs)
        v.push({
          code: "video_too_long",
          field,
          message: "Video is over 20 minutes (x.md section 4)",
        });
    }
  });
  return v;
}
