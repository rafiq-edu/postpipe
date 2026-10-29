"use server";

import { revalidatePath } from "next/cache";
import { UuidSchema } from "@/lib/api/schemas/common";
import { CreateWebhookEndpointSchema } from "@/lib/api/schemas/webhooks";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import {
  createEndpoint,
  deleteEndpoint,
  replayDelivery,
} from "@/lib/db/queries/webhooks";
import { assertPublicUrl } from "@/lib/webhooks/url-guard";

export type CreateEndpointState = { secret?: string; error?: string };

const PATH = "/dashboard/webhooks";
const modeOf = (v: FormDataEntryValue | null) =>
  v === "live" ? "live" : "test";

export async function createEndpointAction(
  _prev: CreateEndpointState,
  formData: FormData,
): Promise<CreateEndpointState> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") return { error: "Only the owner can do this" };
  const mode = modeOf(formData.get("mode"));
  const parsed = CreateWebhookEndpointSchema.safeParse({
    url: String(formData.get("url") ?? ""),
    events: formData.getAll("events").map(String),
  });
  if (!parsed.success)
    return { error: "Enter a valid URL and pick at least one event" };
  if (mode === "live" && new URL(parsed.data.url).protocol !== "https:")
    return { error: "url must use https in live mode" };
  try {
    await assertPublicUrl(parsed.data.url);
  } catch {
    return { error: "url must resolve to a public address" };
  }
  const ep = await createEndpoint(
    orgId,
    mode,
    parsed.data.url,
    parsed.data.events,
  );
  revalidatePath(PATH);
  return { secret: ep.secret };
}

export async function deleteEndpointAction(formData: FormData): Promise<void> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") throw new Error("owner only");
  const id = UuidSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await deleteEndpoint(orgId, modeOf(formData.get("mode")), id.data);
  revalidatePath(PATH);
}

export async function replayDeliveryAction(formData: FormData): Promise<void> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") throw new Error("owner only");
  const id = UuidSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await replayDelivery(orgId, id.data);
  revalidatePath(PATH);
}
