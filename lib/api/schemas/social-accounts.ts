import { z } from "zod";
import { PLATFORMS } from "../../platforms/types";
import { IsoDateTimeSchema, UuidSchema } from "./common";

export const CreateAuthUrlSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    external_id: z.string().min(1).max(255),
    redirect_url: z.url({ protocol: /^https?$/ }),
    platform_data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .meta({ id: "CreateAuthUrl" });

export const AuthUrlSchema = z
  .object({ url: z.url(), expires_at: IsoDateTimeSchema })
  .meta({ id: "AuthUrl" });

export const SocialAccountSchema = z
  .object({
    id: UuidSchema,
    platform: z.enum(PLATFORMS),
    external_id: z.string(),
    platform_user_id: z.string(),
    username: z.string().nullable(),
    display_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    status: z.enum(["connected", "expired", "revoked", "disconnected"]),
    token_expires_at: IsoDateTimeSchema.nullable(),
    created_at: IsoDateTimeSchema,
  })
  .meta({ id: "SocialAccount" });
