import { createHmac, timingSafeEqual } from "node:crypto";

function mac(secret: string, timestamp: number | string, body: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function signWebhook(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${mac(secret, timestamp, body)}`;
}

export function verifyWebhook(
  body: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  try {
    let t = "";
    const sigs: string[] = [];
    for (const part of header.split(",")) {
      const i = part.indexOf("=");
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k === "t") t = v;
      else if (k === "v1") sigs.push(v);
    }
    if (!/^\d+$/.test(t) || sigs.length === 0) return false;
    if (Math.abs(now - Number(t)) > toleranceSeconds) return false;
    const expected = Buffer.from(mac(secret, t, body), "hex");
    return sigs.some((s) => {
      const got = Buffer.from(s, "hex");
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
  } catch {
    return false;
  }
}
