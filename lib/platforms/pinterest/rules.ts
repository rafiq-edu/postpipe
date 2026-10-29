import type { PublishInput, RuleViolation } from "../types";

// Limits: docs/integrations/pinterest.md, section 4 "Publishing endpoints".
// UNVERIFIED and not checked (pinterest.md section 4): video file size, API image_url size and formats, carousel is not built (ours).
export const PINTEREST_LIMITS = {
  title: 100, // pinterest.md section 4, Create Pin: title 100
  description: 800, // pinterest.md section 4, Create Pin: description 800
  altText: 500, // pinterest.md section 4, Create Pin: alt_text 500
  link: 2048, // pinterest.md section 4, Create Pin: link 2048
  imageBytes: 20_000_000, // pinterest.md section 4, Media limits: 20 MB max (web; API limit UNVERIFIED)
  videoMinMs: 4_000, // pinterest.md section 4, Media limits: 4 seconds to 5 minutes
  videoMaxMs: 300_000,
  pollMs: 5_000, // ours: pinterest.md section 4 says processing "normally takes only a few seconds"
  pollDeadlineMs: 30 * 60_000, // ours: pinterest.md gives no processing deadline
};

// pinterest.md section 4, Media limits: BMP, JPEG, PNG, TIFF, WEBP.
const IMAGE_MIMES = [
  "image/bmp",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
];
// pinterest.md section 4, Media limits: .mp4, .mov, .m4v.
const VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/x-m4v"];

const len = (s: string) => [...s].length;

export const isVideo = (i: PublishInput) =>
  i.media[0]?.mime.startsWith("video/") === true;

/** config.board_id, else the board picked at connect (platform_data.target.id). */
export function boardId(i: PublishInput): string {
  if (typeof i.config.board_id === "string" && i.config.board_id)
    return i.config.board_id;
  const t = i.account.platformData.target;
  const id = t && typeof t === "object" && !Array.isArray(t) ? t.id : "";
  return typeof id === "string" ? id : "";
}

export function validatePost(i: PublishInput): RuleViolation[] {
  const v: RuleViolation[] = [];
  const L = PINTEREST_LIMITS;
  const c = i.config;
  if (!boardId(i))
    v.push({
      code: "board_required",
      field: "config.board_id",
      message: "A Pin needs a board (pinterest.md section 4, Create Pin)",
    });
  if (typeof c.title === "string" && len(c.title) > L.title)
    v.push({
      code: "title_too_long",
      field: "config.title",
      message: "Title is over 100 characters (pinterest.md section 4)",
    });
  if (len(i.caption) > L.description)
    v.push({
      code: "description_too_long",
      field: "caption",
      message: "Description is over 800 characters (pinterest.md section 4)",
    });
  if (typeof c.alt_text === "string" && len(c.alt_text) > L.altText)
    v.push({
      code: "alt_text_too_long",
      field: "config.alt_text",
      message: "Alt text is over 500 characters (pinterest.md section 4)",
    });
  if (typeof c.link === "string" && len(c.link) > L.link)
    v.push({
      code: "link_too_long",
      field: "config.link",
      message: "Link is over 2048 characters (pinterest.md section 4)",
    });
  if (i.media.length === 0)
    v.push({
      code: "media_required",
      field: "media",
      message: "A Pin needs one image or one video (pinterest.md section 1)",
    });
  if (i.media.length > 1)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "This adapter posts one image or one video per Pin",
    });
  const m = i.media[0];
  if (m?.mime.startsWith("image/")) {
    if (!IMAGE_MIMES.includes(m.mime))
      v.push({
        code: "unsupported_media",
        field: "media[0]",
        message:
          "Images must be BMP, JPEG, PNG, TIFF or WEBP (pinterest.md section 4)",
      });
    if (m.bytes > L.imageBytes)
      v.push({
        code: "image_too_large",
        field: "media[0]",
        message: "Image is over 20 MB (pinterest.md section 4)",
      });
  } else if (m?.mime.startsWith("video/")) {
    if (!VIDEO_MIMES.includes(m.mime))
      v.push({
        code: "unsupported_media",
        field: "media[0]",
        message: "Video must be MP4, MOV or M4V (pinterest.md section 4)",
      });
    const ms = m.durationMs;
    if (ms !== undefined && (ms < L.videoMinMs || ms > L.videoMaxMs))
      v.push({
        code: "video_duration",
        field: "media[0]",
        message:
          "Video must be 4 seconds to 5 minutes (pinterest.md section 4)",
      });
    if (!m.thumbnailUrl)
      v.push({
        code: "cover_required",
        field: "media[0]",
        message:
          "A video Pin needs a cover image, or the API returns 400 (pinterest.md section 4, step 4)",
      });
  } else if (m)
    v.push({
      code: "unsupported_media",
      field: "media[0]",
      message: "Only images and video are supported",
    });
  return v;
}
