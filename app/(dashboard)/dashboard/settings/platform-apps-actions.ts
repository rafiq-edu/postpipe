"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import {
  deletePlatformApp,
  upsertPlatformApp,
} from "@/lib/db/queries/platform-apps";
import {
  BYO_PLATFORMS,
  PlatformAppInputSchema,
} from "@/lib/platforms/byo-keys";

// Short message per field. Never built from the submitted values, so a secret cannot leak into state.
export type PlatformAppState = {
  ok: boolean;
  platform?: string;
  error?: string;
  fields?: { client_id?: string; client_secret?: string; extra?: string };
};

const FIELD_MESSAGES = {
  client_id: "Client ID is required (200 characters max).",
  client_secret: "Client secret is required (500 characters max).",
  extra: "Login config ID is required.",
} as const;

const OWNER_ONLY = "Only the owner can change platform apps.";

export async function savePlatformApp(
  _prev: PlatformAppState,
  formData: FormData,
): Promise<PlatformAppState> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") return { ok: false, error: OWNER_ONLY };
  const raw = Object.fromEntries(
    ["platform", "client_id", "client_secret", "extra"].flatMap((k) => {
      const v = formData.get(k);
      return typeof v === "string" ? [[k, v]] : [];
    }),
  );
  const parsed = PlatformAppInputSchema.safeParse(raw);
  const platform = typeof raw.platform === "string" ? raw.platform : undefined;
  if (!parsed.success) {
    const fields: NonNullable<PlatformAppState["fields"]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "client_id" || key === "client_secret" || key === "extra")
        fields[key] = FIELD_MESSAGES[key];
    }
    return Object.keys(fields).length > 0
      ? { ok: false, platform, fields }
      : { ok: false, platform, error: "Could not save this app." };
  }
  try {
    await upsertPlatformApp(orgId, parsed.data.platform, {
      clientId: parsed.data.client_id,
      clientSecret: parsed.data.client_secret,
      extra: parsed.data.extra ?? null,
    });
  } catch {
    return {
      ok: false,
      platform,
      error: "Could not save this app. Try again.",
    };
  }
  revalidatePath("/dashboard/settings");
  return { ok: true, platform: parsed.data.platform };
}

export async function removePlatformApp(
  _prev: PlatformAppState,
  formData: FormData,
): Promise<PlatformAppState> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") return { ok: false, error: OWNER_ONLY };
  const platform = z.enum(BYO_PLATFORMS).safeParse(formData.get("platform"));
  if (!platform.success) return { ok: false, error: "Unknown platform." };
  try {
    await deletePlatformApp(orgId, platform.data);
  } catch {
    return {
      ok: false,
      platform: platform.data,
      error: "Could not remove this app. Try again.",
    };
  }
  revalidatePath("/dashboard/settings");
  return { ok: true, platform: platform.data };
}
