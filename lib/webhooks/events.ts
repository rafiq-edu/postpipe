import { randomUUID } from "node:crypto";
import { type ZodTypeAny, z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "../api/schemas/common";
import { SocialAccountSchema } from "../api/schemas/social-accounts";
import {
  SocialPostResultSchema,
  SocialPostStatusSchema,
} from "../api/schemas/social-posts";
import type { WEBHOOK_EVENTS } from "../api/schemas/webhooks";
import { createServiceClient } from "../db/client";
import type { Json } from "../db/types";
import { PLATFORMS } from "../platforms/types";

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const EVENT_SCHEMAS: Record<WebhookEvent, ZodTypeAny> = {
  "social.post.created": z.object({
    post_id: UuidSchema,
    external_id: z.string().nullable(),
    status: SocialPostStatusSchema,
    scheduled_at: IsoDateTimeSchema.nullable(),
    social_accounts: z.array(UuidSchema),
  }),
  "social.post.result.created": z.object({
    post_id: UuidSchema,
    result: SocialPostResultSchema,
  }),
  "social.account.created": z.object({ account: SocialAccountSchema }),
  "social.account.disconnected": z.object({
    account_id: UuidSchema,
    platform: z.enum(PLATFORMS),
    external_id: z.string(),
  }),
  "social.account.token_expiring": z.object({
    account_id: UuidSchema,
    platform: z.enum(PLATFORMS),
    external_id: z.string(),
    expires_at: IsoDateTimeSchema,
    connect_url: z.url(),
  }),
};

export async function emit(
  orgId: string,
  mode: "live" | "test",
  event: WebhookEvent,
  payload: Json,
): Promise<void> {
  EVENT_SCHEMAS[event].parse(payload);
  const db = await createServiceClient();
  const { data: endpoints, error } = await db
    .from("webhook_endpoints")
    .select("id")
    .eq("org_id", orgId)
    .eq("mode", mode)
    .eq("enabled", true)
    .contains("events", [event]);
  if (error) throw error;
  if (!endpoints.length) return;
  const now = new Date().toISOString();
  const rows = endpoints.map((e) => ({
    org_id: orgId,
    mode,
    endpoint_id: e.id,
    event,
    payload: { id: randomUUID(), event, created_at: now, data: payload },
    status: "pending" as const,
    attempt: 0,
    next_attempt_at: now,
  }));
  const { error: e2 } = await db.from("webhook_deliveries").insert(rows);
  if (e2) throw e2;
}
