import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "./common";

export const CreateUploadUrlSchema = z
  .object({
    mime: z.string().regex(/^(image|video)\/[a-z0-9.+-]+$/i),
    bytes: z.number().int().positive().max(1_073_741_824),
  })
  .strict()
  .meta({ id: "CreateUploadUrl" });

export const UploadUrlSchema = z
  .object({
    media_id: UuidSchema,
    upload_url: z.url(),
    media_url: z.url(),
    expires_at: IsoDateTimeSchema,
  })
  .meta({ id: "UploadUrl" });
