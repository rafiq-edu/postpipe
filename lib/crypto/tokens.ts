import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSecret } from "@/lib/secrets";

const BLOB_RE =
  /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)$/;
const FAIL = "token decrypt failed";

export function currentKeyVersion(): number {
  const n = Number(process.env.CURRENT_TOKEN_KEY_VERSION ?? "1");
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("CURRENT_TOKEN_KEY_VERSION must be a positive integer");
  }
  return n;
}

async function keyFor(version: number): Promise<Buffer> {
  const key = Buffer.from(await getSecret(`TOKEN_KEY_V${version}`), "base64");
  if (key.length !== 32)
    throw new Error(`TOKEN_KEY_V${version} must be 32 bytes base64`);
  return key;
}

export async function encryptToken(
  plain: string,
  keyVersion = currentKeyVersion(),
): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await keyFor(keyVersion), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${keyVersion}.${iv.toString("base64url")}.${ct.toString("base64url")}.${tag.toString("base64url")}`;
}

export function keyVersionOf(blob: string): number {
  const m = BLOB_RE.exec(blob);
  if (!m) throw new Error(FAIL);
  return Number(m[1]);
}

export async function decryptToken(blob: string): Promise<string> {
  const m = BLOB_RE.exec(blob);
  if (!m) throw new Error(FAIL);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await keyFor(Number(m[1])),
      Buffer.from(m[2], "base64url"),
    );
    decipher.setAuthTag(Buffer.from(m[4], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(m[3], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(FAIL);
  }
}
