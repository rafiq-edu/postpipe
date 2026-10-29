import { z } from "zod";
import { PLATFORMS } from "../../platforms/types";
import { IsoDateTimeSchema, UuidSchema } from "./common";
import { PlatformConfigurationsSchema } from "./platform-config";

const MAX_AHEAD_MS = 7_776_000_000; // 90 days
const PAST_GRACE_MS = 60_000;

export const MediaItemSchema = z
  .object({
    url: z.url(),
    thumbnail_url: z.url().optional(),
    alt_text: z.string().max(1000).optional(),
  })
  .meta({ id: "MediaItem" });

// Checked against the account's platform schema at creation (Task 14).
export const AccountConfigurationSchema = z
  .object({
    social_account_id: UuidSchema,
    configuration: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "AccountConfiguration" });

// Unrefined object: Zod 4 refuses .partial() on refined schemas (used for PATCH).
export const CreateSocialPostBaseSchema = z
  .object({
    caption: z.string().max(10_000).default(""),
    media: z.array(MediaItemSchema).max(20).default([]),
    social_accounts: z.array(UuidSchema).min(1).max(50),
    scheduled_at: IsoDateTimeSchema.optional(),
    platform_configurations: PlatformConfigurationsSchema.optional(),
    account_configurations: z
      .array(AccountConfigurationSchema)
      .max(50)
      .optional(),
    external_id: z.string().max(255).optional(),
    is_draft: z.boolean().default(false),
  })
  .strict();

export const CreateSocialPostSchema = CreateSocialPostBaseSchema.superRefine(
  (v, ctx) => {
    if (v.caption === "" && v.media.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["caption"],
        message: "caption or media is required",
      });
    if (v.scheduled_at !== undefined) {
      const delta = Date.parse(v.scheduled_at) - Date.now();
      if (delta < -PAST_GRACE_MS)
        ctx.addIssue({
          code: "custom",
          path: ["scheduled_at"],
          message: "scheduled_at must be in the future",
        });
      else if (delta > MAX_AHEAD_MS)
        ctx.addIssue({
          code: "custom",
          path: ["scheduled_at"],
          message: "scheduled_at must be within 90 days",
        });
    }
  },
).meta({ id: "CreateSocialPost" });

export const SocialPostStatusSchema = z.enum([
  "draft",
  "scheduled",
  "processing",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

export const SocialPostSchema = z
  .object({
    id: UuidSchema,
    external_id: z.string().nullable(),
    caption: z.string(),
    media: z.array(MediaItemSchema),
    social_accounts: z.array(UuidSchema),
    scheduled_at: IsoDateTimeSchema.nullable(),
    status: SocialPostStatusSchema,
    platform_configurations: z.record(z.string(), z.unknown()),
    account_configurations: z.array(AccountConfigurationSchema),
    is_draft: z.boolean(),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
  })
  .meta({ id: "SocialPost" });

export const SocialPostResultSchema = z
  .object({
    id: UuidSchema,
    post_id: UuidSchema,
    social_account_id: UuidSchema,
    platform: z.enum(PLATFORMS),
    status: z.enum(["pending", "running", "success", "error", "cancelled"]),
    platform_post_id: z.string().nullable(),
    platform_post_url: z.string().nullable(),
    error_code: z.string().nullable(),
    error_message: z.string().nullable(),
    attempts: z.number().int(),
    published_at: IsoDateTimeSchema.nullable(),
    approval_limited: z.boolean(),
  })
  .meta({ id: "SocialPostResult" });
