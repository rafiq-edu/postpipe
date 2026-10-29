import { ApiError } from "../../api/errors";
import { randomBase62 } from "../../api/keys";
import { encryptToken } from "../../crypto/tokens";
import { createServiceClient } from "../client";

type Mode = "live" | "test";

export async function createEndpoint(
  orgId: string,
  mode: Mode,
  url: string,
  events: string[],
) {
  const secret = `whsec_${randomBase62(32)}`;
  const db = await createServiceClient();
  const { data, error } = await db
    .from("webhook_endpoints")
    .insert({
      org_id: orgId,
      mode,
      url,
      events,
      secret_enc: await encryptToken(secret),
    })
    .select("id, url, events, enabled, created_at")
    .single();
  if (error) throw error;
  return { ...data, secret };
}

export async function listEndpoints(orgId: string, mode: Mode) {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("webhook_endpoints")
    .select("id, url, events, enabled, created_at")
    .eq("org_id", orgId)
    .eq("mode", mode)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function deleteEndpoint(
  orgId: string,
  mode: Mode,
  id: string,
): Promise<boolean> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("webhook_endpoints")
    .delete()
    .eq("org_id", orgId)
    .eq("mode", mode)
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return data.length > 0;
}

export async function listDeliveries(orgId: string, mode: Mode, limit = 50) {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("webhook_deliveries")
    .select(
      "id, endpoint_id, event, status, attempt, response_code, next_attempt_at, delivered_at, created_at",
    )
    .eq("org_id", orgId)
    .eq("mode", mode)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function replayDelivery(
  orgId: string,
  id: string,
): Promise<string> {
  const db = await createServiceClient();
  const { data: d, error } = await db
    .from("webhook_deliveries")
    .select("org_id, mode, endpoint_id, event, payload")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!d) throw new ApiError(404, "not_found", "webhook delivery not found");
  const { data, error: e2 } = await db
    .from("webhook_deliveries")
    .insert({
      ...d,
      status: "pending",
      attempt: 0,
      next_attempt_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (e2) throw e2;
  return data.id;
}
