import sharp from "sharp";

/**
 * Re-encode as JPEG under maxBytes. sharp drops metadata by default
 * (bluesky.md section 4: strip metadata).
 */
export async function shrinkImage(
  input: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  const meta = await sharp(input).metadata();
  let width = Math.min(meta.width ?? 2048, 2048);
  for (let quality = 85; ; quality -= 10) {
    if (quality < 35) {
      quality = 85;
      width = Math.floor(width * 0.8);
      if (width < 200) throw new Error("image cannot be shrunk enough");
    }
    const out = await sharp(input)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (out.length < maxBytes) return new Uint8Array(out);
  }
}
