import type { PublishInput, RuleViolation } from "../types";

// Limits: docs/integrations/youtube.md, section 4 "Publishing endpoints".
export const YOUTUBE_LIMITS = {
  title: 100, // youtube.md section 4, Fields: snippet.title max 100 characters
  descriptionBytes: 5000, // youtube.md section 4, Fields: snippet.description max 5000 BYTES
  tagsChars: 500, // youtube.md section 4, Fields: snippet.tags[] max 500 characters in total
  fileBytes: 256 * 1024 ** 3, // youtube.md section 4, Limits: max file size 256 GB (GB read as GiB; UNVERIFIED)
  chunkBytes: 8 * 1024 * 1024, // ours: youtube.md section 4, Chunked upload: a multiple of 256 KB (8 MiB = 32 x 256 KiB)
  statusWaitMs: 5_000, // ours: youtube.md section 4 says retry with backoff, gives no delay
  maxStatusTries: 5, // ours
  maxStalls: 5, // ours: stops a loop where the server never advances
  maxRestarts: 2, // ours: new sessions after a 404
};

const len = (s: string) => [...s].length;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** config.description, else the post caption. */
export const descriptionOf = (i: PublishInput): string =>
  typeof i.config.description === "string" ? i.config.description : i.caption;

export function validatePost(i: PublishInput): RuleViolation[] {
  const v: RuleViolation[] = [];
  const L = YOUTUBE_LIMITS;
  const c = i.config;
  if (typeof c.made_for_kids !== "boolean")
    v.push({
      code: "made_for_kids_required",
      field: "config.made_for_kids",
      message:
        "made_for_kids must be true or false (youtube.md section 4, selfDeclaredMadeForKids)",
    });
  if (typeof c.title !== "string" || !c.title.trim())
    v.push({
      code: "title_required",
      field: "config.title",
      message: "A video needs a title (youtube.md section 4, snippet.title)",
    });
  else {
    if (len(c.title) > L.title)
      v.push({
        code: "title_too_long",
        field: "config.title",
        message: "Title is over 100 characters (youtube.md section 4)",
      });
    if (/[<>]/.test(c.title))
      v.push({
        code: "title_invalid_chars",
        field: "config.title",
        message: "Title cannot contain < or > (youtube.md section 4)",
      });
  }
  const d = descriptionOf(i);
  if (bytes(d) > L.descriptionBytes)
    v.push({
      code: "description_too_long",
      field:
        typeof c.description === "string" ? "config.description" : "caption",
      message: "Description is over 5000 bytes (youtube.md section 4)",
    });
  if (/[<>]/.test(d))
    v.push({
      code: "description_invalid_chars",
      field:
        typeof c.description === "string" ? "config.description" : "caption",
      message: "Description cannot contain < or > (youtube.md section 4)",
    });
  if (Array.isArray(c.tags)) {
    // youtube.md section 4: commas count; a tag with a space counts 2 extra (quotes).
    const tags = c.tags.filter((t): t is string => typeof t === "string");
    const total =
      tags.reduce((n, t) => n + len(t) + (t.includes(" ") ? 2 : 0), 0) +
      Math.max(0, tags.length - 1);
    if (total > L.tagsChars)
      v.push({
        code: "tags_too_long",
        field: "config.tags",
        message: "Tags are over 500 characters in total (youtube.md section 4)",
      });
  }
  if (i.media.length === 0)
    v.push({
      code: "media_required",
      field: "media",
      message: "A YouTube post needs one video (youtube.md section 4)",
    });
  if (i.media.length > 1)
    v.push({
      code: "too_many_media",
      field: "media",
      message: "This adapter posts one video per upload",
    });
  const m = i.media[0];
  if (m) {
    // youtube.md section 4, Limits: MIME types video/* and application/octet-stream.
    if (!m.mime.startsWith("video/"))
      v.push({
        code: "unsupported_media",
        field: "media[0]",
        message: "Only video can be posted to YouTube",
      });
    else if (m.bytes <= 0 || m.bytes > L.fileBytes)
      v.push({
        code: "video_too_large",
        field: "media[0]",
        message: "Video must be 1 byte to 256 GB (youtube.md section 4)",
      });
  }
  return v;
}
