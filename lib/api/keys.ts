import { createHash, randomInt } from "node:crypto";

export const API_KEY_RE = /^pp_(live|test)_[A-Za-z0-9]{32}$/;
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function randomBase62(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += BASE62[randomInt(62)];
  return out;
}

export function generateApiKey(mode: "live" | "test"): {
  plaintext: string;
  hash: string;
  prefix: string;
  last4: string;
} {
  const prefix = `pp_${mode}_`;
  const plaintext = prefix + randomBase62(32);
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix,
    last4: plaintext.slice(-4),
  };
}
