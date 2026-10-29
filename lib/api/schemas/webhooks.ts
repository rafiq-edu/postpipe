import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "./common";

export const WEBHOOK_EVENTS = [
  "social.post.created",
  "social.post.result.created",
  "social.account.created",
  "social.account.disconnected",
  "social.account.token_expiring",
] as const;

export const CreateWebhookEndpointSchema = z
  .object({
    url: z.url({ protocol: /^https?$/ }),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  })
  .strict()
  .meta({ id: "CreateWebhookEndpoint" });

export const WebhookEndpointSchema = z
  .object({
    id: UuidSchema,
    url: z.url(),
    events: z.array(z.enum(WEBHOOK_EVENTS)),
    enabled: z.boolean(),
    secret: z.string().optional(), // only in the create response
    created_at: IsoDateTimeSchema,
  })
  .meta({ id: "WebhookEndpoint" });
