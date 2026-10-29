import type { PublishInput, RuleViolation } from "../types";

// Limits below: docs/integrations/instagram.md, section "Publishing endpoints" (Media requirements, Text limits, Carousel).
export const INSTAGRAM_LIMITS = {
  captionChars: 2200, // instagram.md Text limits: caption max 2200 characters
  hashtags: 30, // instagram.md Text limits: 30 hashtags
  carouselMax: 20, // instagram.md Carousel: up to 20 items
  imageBytes: 8_000_000, // instagram.md Media requirements: image max 8 MB
  altTextChars: 1000, // instagram.md Text limits: alt text max 1000 chars
  reelBytes: 300_000_000, // instagram.md Media requirements: Reels file size max 300 MB
  reelMinMs: 3_000, // instagram.md Media requirements: Reels duration 3 s to 15 min
  reelMaxMs: 900_000,
  storyVideoBytes: 100_000_000, // instagram.md Media requirements: Story video max 100 MB
  storyVideoMinMs: 3_000, // instagram.md Media requirements: Story video 3 to 60 s
  storyVideoMaxMs: 60_000,
  pollMs: 5 * 60_000, // instagram.md Container flow, step 2: poll once a minute, at most 5 minutes
};

const VIDEO_MIMES = ["video/mp4", "video/quicktime"]; // instagram.md Media requirements: MP4 or MOV

export type InstagramKind = "IMAGE" | "REELS" | "STORIES" | "CAROUSEL";

/** Single media is a feed image or a Reel unless config asks for a Story. */
export function postKind(i: PublishInput): InstagramKind {
  const [first] = i.media;
  if (i.media.length > 1) return "CAROUSEL";
  if (i.config.media_type === "STORIES") return "STORIES";
  return first?.mime.startsWith("video/") ? "REELS" : "IMAGE";
}

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

export function validatePost(i: PublishInput): RuleViolation[] {
  const v: RuleViolation[] = [];
  const L = INSTAGRAM_LIMITS;
  // shortcut: counts code points; instagram.md says "characters" only, so the unit is UNVERIFIED.
  if ([...i.caption].length > L.captionChars)
    v.push({
      code: "caption_too_long",
      field: "caption",
      message: "Caption is over 2,200 characters (instagram.md Text limits)",
    });
  if ((i.caption.match(HASHTAG_RE) ?? []).length > L.hashtags)
    v.push({
      code: "too_many_hashtags",
      field: "caption",
      message: "More than 30 hashtags (instagram.md Text limits)",
    });
  if (i.media.length === 0)
    v.push({
      code: "media_required",
      field: "media",
      message:
        "Instagram needs an image or a video (instagram.md Container flow)",
    });
  if (i.media.length > L.carouselMax)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "A carousel has up to 20 items (instagram.md Carousel)",
    });
  const kind = postKind(i);
  const cfg = i.config.media_type;
  if (
    (cfg && i.media.length > 1) ||
    (cfg === "REELS" && i.media[0] && !i.media[0].mime.startsWith("video/"))
  )
    v.push({
      code: "config_media_mismatch",
      field: "config.media_type",
      message:
        "media_type does not fit the media: Reels need one video, Stories one item, carousels no media_type (instagram.md Overview, What we can publish)",
    });
  i.media.forEach((m, idx) => {
    const field = `media[${idx}]`;
    if (m.mime.startsWith("image/")) {
      if (m.mime !== "image/jpeg")
        v.push({
          code: "image_not_jpeg",
          field,
          message: "Images must be JPEG (instagram.md Media requirements)",
        });
      if (m.bytes > L.imageBytes)
        v.push({
          code: "image_too_large",
          field,
          message: "Image is over 8 MB (instagram.md Media requirements)",
        });
      if ((m.altText?.length ?? 0) > L.altTextChars)
        v.push({
          code: "alt_text_too_long",
          field,
          message:
            "Alt text is over 1,000 characters (instagram.md Text limits)",
        });
    } else if (m.mime.startsWith("video/")) {
      if (!VIDEO_MIMES.includes(m.mime))
        v.push({
          code: "unsupported_media",
          field,
          message:
            "Videos must be MP4 or MOV (instagram.md Media requirements)",
        });
      if (kind === "REELS" || kind === "STORIES") {
        const story = kind === "STORIES";
        if (m.bytes > (story ? L.storyVideoBytes : L.reelBytes))
          v.push({
            code: "video_too_large",
            field,
            message: story
              ? "Story video is over 100 MB (instagram.md Media requirements)"
              : "Reel is over 300 MB (instagram.md Media requirements)",
          });
        const ms = m.durationMs;
        if (
          ms !== undefined &&
          (ms < (story ? L.storyVideoMinMs : L.reelMinMs) ||
            ms > (story ? L.storyVideoMaxMs : L.reelMaxMs))
        )
          v.push({
            code: "video_duration",
            field,
            message: story
              ? "Story video must be 3 to 60 seconds (instagram.md Media requirements)"
              : "Reel must be 3 seconds to 15 minutes (instagram.md Media requirements)",
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
