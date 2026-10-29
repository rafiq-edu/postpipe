import { z } from "zod";

export const BrandingSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  logo_key: z.string().optional(),
});
export type Branding = z.infer<typeof BrandingSchema>;

export function parseBranding(json: unknown): Branding {
  const r = BrandingSchema.safeParse(json);
  return r.success ? r.data : {};
}

export const logoKey = (orgId: string, ext: string) =>
  `branding/${orgId}/logo-${Date.now()}.${ext}`;

export const MAX_LOGO_BYTES = 512 * 1024;

const SIGNATURES: {
  ext: string;
  mime: string;
  test: (b: Uint8Array) => boolean;
}[] = [
  {
    ext: "png",
    mime: "image/png",
    test: (b) =>
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (v, i) => b[i] === v,
      ),
  },
  {
    ext: "jpg",
    mime: "image/jpeg",
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "webp",
    mime: "image/webp",
    test: (b) =>
      Buffer.from(b.subarray(0, 4)).toString("latin1") === "RIFF" &&
      Buffer.from(b.subarray(8, 12)).toString("latin1") === "WEBP",
  },
];

/** Checks size and magic bytes (never the client mime). SVG is rejected. */
export function validateLogo(
  bytes: Uint8Array,
): { ok: true; ext: string; mime: string } | { ok: false; error: string } {
  if (bytes.length === 0) return { ok: false, error: "Logo file is empty" };
  if (bytes.length > MAX_LOGO_BYTES)
    return { ok: false, error: "Logo must be 512 KB or less" };
  const hit = SIGNATURES.find((s) => s.test(bytes));
  if (!hit)
    return { ok: false, error: "Logo must be a PNG, JPEG or WebP image" };
  return { ok: true, ext: hit.ext, mime: hit.mime };
}
