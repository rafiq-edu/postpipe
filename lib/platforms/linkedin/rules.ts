import type { PublishInput, RuleViolation } from "../types";

export const LINKEDIN_LIMITS = {
  // UNVERIFIED (Step 0): LinkedIn may count escaped text. linkedin.md section 1: "Commentary limit of 3000 characters: UNVERIFIED".
  commentaryChars: 3000,
  images: 20, // linkedin.md section 1 and section 4 "Multi-image": 2 to 20
  imagePixels: 36_152_320, // linkedin.md section 4, Image limits: "under 36,152,320 pixels"
  altTextChars: 4086, // linkedin.md section 4, Image limits
  videoMinMs: 3_000, // linkedin.md section 4, Video limits: 3 seconds
  videoMaxMs: 30 * 60_000, // linkedin.md section 4, Video limits: 30 minutes
  videoMinBytes: 75 * 1024, // linkedin.md section 4, Video limits: 75 KB
  videoMaxBytes: 500 * 1024 * 1024, // linkedin.md section 4: 500 MB (the 5GB figure conflicts; 500 MB is the safe limit)
  // Our own deadline for video processing, not a doc limit.
  videoPollMs: 30 * 60_000,
  partBytes: 4_194_304, // linkedin.md section 4, Video step 2: 4 MB parts
};

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif"]; // linkedin.md section 4: JPG, GIF, PNG

export function validatePost(i: PublishInput): RuleViolation[] {
  const v: RuleViolation[] = [];
  const L = LINKEDIN_LIMITS;
  if (Array.from(i.caption).length > L.commentaryChars)
    v.push({
      code: "caption_too_long",
      field: "caption",
      message: "Text is over 3000 characters (linkedin.md section 1)",
    });
  // UNVERIFIED: Step 0. linkedin.md has no line on empty commentary; text-only posts are rejected when empty.
  if (i.caption.trim() === "" && i.media.length === 0)
    v.push({
      code: "caption_required",
      field: "caption",
      message: "Text is required for a post without media",
    });
  const images = i.media.filter((m) => m.mime.startsWith("image/"));
  const videos = i.media.filter((m) => m.mime.startsWith("video/"));
  if (images.length + videos.length < i.media.length)
    v.push({
      code: "unsupported_media",
      field: "media",
      message: "Only images and video are supported",
    });
  if (images.length > 0 && videos.length > 0)
    v.push({
      code: "mixed_media",
      field: "media",
      message: "Images and video cannot be mixed (linkedin.md section 4)",
    });
  if (images.length > L.images || videos.length > 1)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "At most 20 images or 1 video (linkedin.md section 4)",
    });
  i.media.forEach((m, idx) => {
    const field = `media[${idx}]`;
    if (m.mime.startsWith("image/")) {
      if (!IMAGE_MIMES.includes(m.mime))
        v.push({
          code: "unsupported_media",
          field,
          message: "Images must be JPG, PNG or GIF (linkedin.md section 4)",
        });
      if ((m.width ?? 0) * (m.height ?? 0) >= L.imagePixels)
        v.push({
          code: "image_too_large",
          field,
          message: "Image is over 36,152,320 pixels (linkedin.md section 4)",
        });
      if (Array.from(m.altText ?? "").length > L.altTextChars)
        v.push({
          code: "alt_text_too_long",
          field,
          message: "Alt text is over 4,086 characters (linkedin.md section 4)",
        });
    }
    if (m.mime.startsWith("video/")) {
      if (m.mime !== "video/mp4")
        v.push({
          code: "unsupported_media",
          field,
          message: "Video must be MP4 (linkedin.md section 4)",
        });
      if (m.bytes > L.videoMaxBytes || m.bytes < L.videoMinBytes)
        v.push({
          code: "video_size",
          field,
          message: "Video must be 75 KB to 500 MB (linkedin.md section 4)",
        });
      if (
        m.durationMs !== undefined &&
        (m.durationMs < L.videoMinMs || m.durationMs > L.videoMaxMs)
      )
        v.push({
          code: "video_length",
          field,
          message:
            "Video must be 3 seconds to 30 minutes (linkedin.md section 4)",
        });
    }
  });
  return v;
}
