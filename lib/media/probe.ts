import { createServiceClient } from "../db/client";
import type { MediaInfo } from "../platforms/types";
import { fetchRange, getMediaRow, headMedia, signedReadUrl } from "./s3";

const MB = 1_048_576;
const ascii = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const view = (b: Uint8Array) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength);

export function parseDimensions(
  mime: string,
  chunk: Uint8Array,
): { width?: number; height?: number } {
  const v = view(chunk);
  if (mime === "image/png") {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (chunk.length < 24 || sig.some((s, i) => chunk[i] !== s)) return {};
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 4 <= chunk.length) {
      if (chunk[i] !== 0xff) return {};
      const m = chunk[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        if (i + 9 > chunk.length) return {};
        return { height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
      }
      i += 2 + v.getUint16(i + 2);
    }
  }
  return {};
}

function mvhdDuration(chunk: Uint8Array, start: number, end: number) {
  const v = view(chunk);
  for (let i = start; i + 8 <= end; ) {
    const size = v.getUint32(i);
    if (size < 8) return undefined;
    if (ascii(chunk, i + 4) === "mvhd") {
      const ver = chunk[i + 8];
      const ts = v.getUint32(i + (ver === 1 ? 28 : 20));
      const dur =
        ver === 1 ? Number(v.getBigUint64(i + 32)) : v.getUint32(i + 24);
      return ts ? Math.round((dur * 1000) / ts) : undefined;
    }
    i += size;
  }
  return undefined;
}

/** Top-level box walk; chunk starts at file offset 0. */
export function parseMp4Duration(chunk: Uint8Array): number | undefined {
  const v = view(chunk);
  for (let i = 0; i + 8 <= chunk.length; ) {
    let size = v.getUint32(i);
    let header = 8;
    if (size === 1) {
      if (i + 16 > chunk.length) return undefined;
      size = Number(v.getBigUint64(i + 8));
      header = 16;
    } else if (size === 0) size = chunk.length - i;
    if (size < header) return undefined;
    if (ascii(chunk, i + 4) === "moov")
      return mvhdDuration(chunk, i + header, Math.min(i + size, chunk.length));
    i += size;
  }
  return undefined;
}

/** The tail chunk starts mid-file: find `moov` by scanning, validate its size. */
export function findMoovInTail(chunk: Uint8Array): number | undefined {
  const text = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length);
  for (
    let at = text.indexOf("moov");
    at >= 4;
    at = text.indexOf("moov", at + 1)
  ) {
    const size = view(chunk).getUint32(at - 4);
    if (size >= 8 && at - 4 + size <= chunk.length)
      return mvhdDuration(chunk, at + 4, at - 4 + size);
  }
  return undefined;
}

export async function probeMedia(mediaId: string): Promise<MediaInfo> {
  const row = await getMediaRow(mediaId);
  const head = await headMedia(mediaId);
  const mime = row.mime || head.mime;
  const bytes = head.bytes;
  const first = await fetchRange(mediaId, 0, Math.min(MB, bytes) - 1);
  let dims: { width?: number; height?: number } = {};
  let durationMs: number | undefined;
  if (mime === "video/mp4" || mime === "video/quicktime") {
    durationMs = parseMp4Duration(first);
    if (durationMs === undefined && bytes > MB)
      durationMs = findMoovInTail(
        await fetchRange(mediaId, Math.max(0, bytes - MB), bytes - 1),
      );
  } else dims = parseDimensions(mime, first);

  const db = await createServiceClient();
  const { error } = await db
    .from("media")
    .update({
      status: "validated",
      width: dims.width ?? null,
      height: dims.height ?? null,
      duration_ms: durationMs ?? null,
    })
    .eq("id", mediaId);
  if (error) throw error;
  return {
    mediaId,
    signedUrl: await signedReadUrl(mediaId),
    mime,
    bytes,
    width: dims.width,
    height: dims.height,
    durationMs,
    altText: undefined,
  };
}
