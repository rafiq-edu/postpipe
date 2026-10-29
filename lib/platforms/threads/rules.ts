import { threadsLength } from "../../text/length";
import type { PublishInput, RuleViolation } from "../types";

// Limits below: threads.md:100-104 (section 4, Limits [POSTS]).
export const THREADS_LIMITS = {
  textChars: 500, // threads.md section 4, Limits: text 500, emoji by UTF-8 bytes
  links: 5, // threads.md section 4, Limits: at most 5 unique links
  carouselMin: 2, // threads.md section 4, Limits: carousel 2 to 20 items
  carouselMax: 20, // threads.md section 4, Limits
  imageBytes: 8_000_000, // threads.md section 4, Limits: image 8 MB
  imageMinWidth: 320, // threads.md section 4, Limits: width 320 to 1440 px
  imageMaxWidth: 1440, // threads.md section 4, Limits
  videoBytes: 1_000_000_000, // threads.md section 4, Limits: video 1 GB
  videoMs: 300_000, // threads.md section 4, Limits: video up to 300 s
  videoMaxWidth: 1920, // threads.md section 4, Limits: video max width 1920 px
  pollMs: 5 * 60_000, // threads.md:87 (section 4, Step 2): poll at most 5 minutes
  altTextChars: 1000, // threads.md:79 (section 4, Step 1): alt_text max 1,000 chars
};

const IMAGE_MIMES = ["image/jpeg", "image/png"]; // threads.md section 4, Limits: JPEG or PNG
const VIDEO_MIMES = ["video/mp4", "video/quicktime"]; // threads.md section 4, Limits: MOV or MP4

// shortcut: bare domains (example.com) are not counted; Threads still rejects them with too_many_links.
const LINK_RE = /https?:\/\/[^\s]+/gi;
export const uniqueLinks = (text: string): number =>
  new Set(
    (text.match(LINK_RE) ?? []).map((u) => u.replace(/[.,;:!?)\]/]+$/, "")),
  ).size;

export function validatePost(i: PublishInput): RuleViolation[] {
  const v: RuleViolation[] = [];
  const L = THREADS_LIMITS;
  if (threadsLength(i.caption) > L.textChars)
    v.push({
      code: "caption_too_long",
      field: "caption",
      message:
        "Text is over 500 characters, emoji counted by UTF-8 bytes (threads.md section 4)",
    });
  if (uniqueLinks(i.caption) > L.links)
    v.push({
      code: "too_many_links",
      field: "caption",
      message: "More than 5 unique links (threads.md section 4)",
    });
  if (i.caption.trim() === "" && i.media.length === 0)
    v.push({
      code: "caption_required",
      field: "caption",
      message:
        "Text is required for a post without media (threads.md section 4)",
    });
  if (i.media.length > L.carouselMax)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "A carousel has 2 to 20 items (threads.md section 4)",
    });
  i.media.forEach((m, idx) => {
    const field = `media[${idx}]`;
    if ((m.altText?.length ?? 0) > L.altTextChars)
      v.push({
        code: "alt_text_too_long",
        field,
        message: "Alt text is over 1,000 characters (threads.md section 4)",
      });
    if (m.mime.startsWith("image/")) {
      if (!IMAGE_MIMES.includes(m.mime))
        v.push({
          code: "unsupported_media",
          field,
          message: "Images must be JPEG or PNG (threads.md section 4)",
        });
      if (m.bytes > L.imageBytes)
        v.push({
          code: "image_too_large",
          field,
          message: "Image is over 8 MB (threads.md section 4)",
        });
      if (
        m.width !== undefined &&
        (m.width < L.imageMinWidth || m.width > L.imageMaxWidth)
      )
        v.push({
          code: "image_dimensions",
          field,
          message: "Image width must be 320 to 1440 px (threads.md section 4)",
        });
    } else if (m.mime.startsWith("video/")) {
      if (!VIDEO_MIMES.includes(m.mime))
        v.push({
          code: "unsupported_media",
          field,
          message: "Videos must be MOV or MP4 (threads.md section 4)",
        });
      if (m.bytes > L.videoBytes)
        v.push({
          code: "video_too_large",
          field,
          message: "Video is over 1 GB (threads.md section 4)",
        });
      if ((m.durationMs ?? 0) > L.videoMs)
        v.push({
          code: "video_too_long",
          field,
          message: "Video is over 300 seconds (threads.md section 4)",
        });
      if (m.width !== undefined && m.width > L.videoMaxWidth)
        v.push({
          code: "video_dimensions",
          field,
          message: "Video width is over 1920 px (threads.md section 4)",
        });
    } else
      v.push({
        code: "unsupported_media",
        field,
        message: "Only images and video are supported",
      });
  });
  return v;
}
