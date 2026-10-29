"use server";

import { revalidatePath } from "next/cache";
import {
  type Branding,
  logoKey,
  parseBranding,
  validateLogo,
} from "@/lib/connect/branding";
import { createServiceClient } from "@/lib/db/client";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { deleteObject, putObject } from "@/lib/media/s3";

export type BrandingState = { ok?: boolean; error?: string };

export async function saveBrandingAction(
  _prev: BrandingState,
  formData: FormData,
): Promise<BrandingState> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") return { error: "Only the owner can change branding" };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length > 60) return { error: "Name must be 60 characters or less" };
  const file = formData.get("logo");
  const removeLogo = formData.get("remove_logo") === "1";

  const db = await createServiceClient();
  const { data, error } = await db
    .from("organizations")
    .select("branding")
    .eq("id", orgId)
    .single();
  if (error) throw error;
  const old = parseBranding(data.branding);
  const next: Branding = { ...old };
  if (name) next.name = name;
  else delete next.name;

  let newKey: string | undefined;
  if (file instanceof File && file.size > 0) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const v = validateLogo(bytes);
    if (!v.ok) return { error: v.error };
    newKey = logoKey(orgId, v.ext);
    await putObject(newKey, bytes, v.mime);
    next.logo_key = newKey;
  } else if (removeLogo) {
    delete next.logo_key;
  }

  const { error: upErr } = await db
    .from("organizations")
    .update({ branding: next })
    .eq("id", orgId);
  if (upErr) throw upErr;

  if (old.logo_key && old.logo_key !== next.logo_key)
    await deleteObject(old.logo_key).catch(() => {}); // best effort: old logo is already unlinked
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
