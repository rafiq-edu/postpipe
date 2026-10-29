const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** User-visible characters. A joined emoji is 1. */
export const graphemeLength = (s: string): number =>
  [...segmenter.segment(s)].length;

export const utf8ByteLength = (s: string): number =>
  new TextEncoder().encode(s).length;

const URL_RE = /https?:\/\/\S+/g;
const WIDE_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/**
 * X weighted length: every URL is 23, emoji and CJK are 2, the rest 1
 * (docs/integrations/x.md section 4, "Text").
 * shortcut: schemeless URLs (example.com) count as plain text, replace with X's twitter-text rules if it matters.
 */
export function xWeightedLength(text: string): number {
  let n = 0;
  const rest = text.normalize("NFC").replace(URL_RE, () => {
    n += 23;
    return "";
  });
  for (const { segment } of segmenter.segment(rest)) {
    if (EMOJI_RE.test(segment)) n += 2;
    else for (const ch of segment) n += WIDE_RE.test(ch) ? 2 : 1;
  }
  return n;
}

/**
 * Threads length: 500 limit counts emoji by their UTF-8 bytes, the rest as
 * code points (docs/integrations/threads.md section 4, Limits).
 */
export function threadsLength(text: string): number {
  let n = 0;
  for (const { segment } of segmenter.segment(text.normalize("NFC")))
    n += EMOJI_RE.test(segment) ? utf8ByteLength(segment) : [...segment].length;
  return n;
}
