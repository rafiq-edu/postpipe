import { createHash } from "node:crypto";
import type { Platform } from "../platforms/types";

export const CONNECT_SESSION_TTL_MS = 600_000;

export function appUrl(): string {
  const v = process.env.NEXT_PUBLIC_APP_URL;
  if (!v) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return v;
}

export function connectPageUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_CONNECT_URL || appUrl();
  return `${base.replace(/\/+$/, "")}/connect/${token}`;
}

export function callbackUrl(adapterPlatform: Platform): string {
  return `${appUrl().replace(/\/+$/, "")}/api/oauth/${adapterPlatform}/callback`;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
