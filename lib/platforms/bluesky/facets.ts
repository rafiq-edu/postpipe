import { graphemeLength, utf8ByteLength } from "../../text/length";

export type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: (
    | { $type: "app.bsky.richtext.facet#link"; uri: string }
    | { $type: "app.bsky.richtext.facet#mention"; did: string }
    | { $type: "app.bsky.richtext.facet#tag"; tag: string }
  )[];
};

export type ResolveHandle = (handle: string) => Promise<string | null>;

const LINK_RE = /https?:\/\/[^\s]+/g;
const MENTION_RE =
  /(^|\s|\()@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})/gi;
const TAG_RE = /(^|\s)#([^\s#]+)/g;
const TRAILING = /[.,;:!?'")\]]+$/;

/**
 * Link, mention and tag facets. Offsets are UTF-8 bytes, end exclusive
 * (bluesky.md section 4, Facets). Unresolvable mentions stay plain text.
 */
export async function buildFacets(
  text: string,
  resolveHandle: ResolveHandle,
): Promise<Facet[]> {
  const facets: Facet[] = [];
  const at = (start: number, end: number) => ({
    byteStart: utf8ByteLength(text.slice(0, start)),
    byteEnd: utf8ByteLength(text.slice(0, end)),
  });
  for (const m of text.matchAll(LINK_RE)) {
    const url = m[0].replace(TRAILING, "");
    facets.push({
      index: at(m.index, m.index + url.length),
      features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
    });
  }
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[2].toLowerCase();
    const did = await resolveHandle(handle);
    if (!did) continue;
    const start = m.index + m[1].length;
    facets.push({
      index: at(start, start + 1 + m[2].length),
      features: [{ $type: "app.bsky.richtext.facet#mention", did }],
    });
  }
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[2].replace(TRAILING, "");
    // Tag max 64 graphemes: docs/integrations/bluesky.md, "Hashtags" line (lexicon richtext.facet#tag) [S9].
    if (tag === "" || /^\d+$/.test(tag) || graphemeLength(tag) > 64) continue;
    const start = m.index + m[1].length;
    facets.push({
      index: at(start, start + 1 + tag.length),
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}
