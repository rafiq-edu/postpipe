import type { ZodTypeAny } from "zod";
export type Platform =
  | "tiktok"
  | "instagram"
  | "facebook"
  | "x"
  | "linkedin"
  | "youtube"
  | "pinterest"
  | "threads"
  | "bluesky"
  | "mock";
export const PLATFORMS = [
  "tiktok",
  "instagram",
  "facebook",
  "x",
  "linkedin",
  "youtube",
  "pinterest",
  "threads",
  "bluesky",
  "mock",
] as const satisfies readonly Platform[];
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  scopes: string[];
  platformData?: Record<string, Json>;
}
export interface Target {
  id: string;
  kind: "page" | "organization" | "board" | "channel";
  name: string;
}
export interface MediaInfo {
  mediaId: string;
  signedUrl: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  altText?: string;
  thumbnailUrl?: string;
}
export interface PublishInput {
  caption: string;
  media: MediaInfo[];
  config: Record<string, Json>;
  account: { platformUserId: string; platformData: Record<string, Json> };
  /** Stable per publish target, for idempotent platform calls. */
  target?: { id: string; createdAt: string };
}
export interface RuleViolation {
  code: string;
  message: string;
  field?: string;
}
// No parameter properties: Node strips types only, so the worker needs erasable syntax.
export class PublishError extends Error {
  code: string;
  kind: "retryable" | "permanent" | "auth";
  retryAfterMs?: number;
  raw?: Json;
  constructor(
    code: string,
    kind: "retryable" | "permanent" | "auth",
    message: string,
    retryAfterMs?: number,
    raw?: Json,
  ) {
    super(message);
    this.code = code;
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
    this.raw = raw;
  }
}
export type PublishResult =
  | {
      ok: true;
      platformPostId: string;
      platformPostUrl?: string;
      meta?: { hasUrl?: boolean };
      raw?: Json;
    }
  | { ok: false; error: PublishError };
export interface PublishState {
  stage: string;
  data: Record<string, Json>;
}
export type PublishStepOutcome =
  | {
      next: PublishState;
      waitMs?: number;
      /** The platform id of this publish; the worker stores it so an inbound event can find the target. */
      platformPublishId?: string;
    }
  | { result: PublishResult };
export interface QuotaRule {
  scope: "account" | "project";
  dailyCap: number;
  sourceLine: string;
  /** IANA zone of the platform's quota day. Absent = UTC. */
  timeZone?: string;
  /** Absent = the cap applies to every post. Only the config is known at quota time (before media is probed). */
  appliesTo?(i: Pick<PublishInput, "config">): boolean;
}
export interface PlatformAdapter {
  platform: Platform;
  getAuthUrl(i: {
    state: string;
    redirectUri: string;
    codeChallenge?: string;
    platformData?: Record<string, Json>;
  }): Promise<{ url: string }>;
  exchangeCode(i: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<TokenSet>;
  refreshToken(t: TokenSet): Promise<TokenSet>;
  revoke(t: TokenSet): Promise<void>;
  getProfile(t: TokenSet): Promise<{
    platformUserId: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  }>;
  listTargets?(t: TokenSet): Promise<Target[]>;
  /**
   * Token to store for the chosen target (Facebook: the Page token). Called
   * server-side after the pick; the result replaces the connection token.
   */
  targetToken?(t: TokenSet, targetId: string): Promise<TokenSet>;
  handleInput?: boolean;
  configSchema: ZodTypeAny;
  quota?: QuotaRule;
  /** Usage the platform itself reports for the account (optional). */
  reportedUsage?(
    t: TokenSet,
    account: { platformUserId: string; platformData: Record<string, Json> },
  ): Promise<{ used: number; total: number }>;
  /** Refresh this long before expiry. Default: 10 minutes. */
  refreshWindowMs?: number;
  validatePost(i: PublishInput): RuleViolation[] | Promise<RuleViolation[]>;
  publishStep(
    state: PublishState,
    i: PublishInput,
    t: TokenSet,
    fetchRange: (
      mediaId: string,
      start: number,
      end: number,
    ) => Promise<Uint8Array>,
  ): Promise<PublishStepOutcome>;
}
