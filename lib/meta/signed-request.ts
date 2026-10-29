import { createHmac, timingSafeEqual } from "node:crypto";

export function appSecretName(app: string | null) {
  return app === "threads" ? "THREADS_APP_SECRET" : "META_APP_SECRET";
}

/** Verifies a Meta signed_request. Returns null on any problem, never throws. */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): { user_id: string; issued_at: number } | null {
  try {
    const parts = signedRequest.split(".");
    if (parts.length !== 2) return null;
    const [sig, payload] = parts;
    const got = Buffer.from(sig, "base64url");
    const want = createHmac("sha256", appSecret).update(payload).digest();
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (String(data?.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
    if (!data.user_id || typeof data.issued_at !== "number") return null;
    return { user_id: String(data.user_id), issued_at: data.issued_at };
  } catch {
    return null;
  }
}
