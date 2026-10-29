import { createHmac, timingSafeEqual } from "node:crypto";
import { PublishError } from "../platforms/types";
import { getSecret, MissingSecret } from "../secrets";

/** Lifetime of a signed pull path, in seconds. */
export const PULL_TTL_SECONDS = 86_400;
const SKEW_SECONDS = 60;

const mac = async (mediaId: string, exp: string) =>
  createHmac("sha256", await getSecret("MEDIA_URL_SIGNING_KEY"))
    .update(`${mediaId}.${exp}`)
    .digest("base64url");

/** Returns `/media/<id>/<exp>/<sig>`. Throws a permanent config_error when the key is missing. */
export async function signPullPath(
  mediaId: string,
  exp: number,
): Promise<string> {
  try {
    const e = String(exp);
    return `/media/${encodeURIComponent(mediaId)}/${e}/${await mac(mediaId, e)}`;
  } catch (e) {
    if (e instanceof MissingSecret)
      throw new PublishError(
        "config_error",
        "permanent",
        "MEDIA_URL_SIGNING_KEY is not set",
      );
    throw e;
  }
}

/** `now` is unix seconds. Any failure, including a missing key, returns false. */
export async function verifyPull(
  mediaId: string,
  exp: string,
  sig: string,
  now: number,
): Promise<boolean> {
  if (!/^\d{1,15}$/.test(exp)) return false;
  const t = Number(exp);
  if (!(now < t && t <= now + PULL_TTL_SECONDS + SKEW_SECONDS)) return false;
  let want: Buffer;
  try {
    want = Buffer.from(await mac(mediaId, exp));
  } catch {
    return false;
  }
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
}
