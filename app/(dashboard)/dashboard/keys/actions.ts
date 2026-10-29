"use server";

import { revalidatePath } from "next/cache";
import { UuidSchema } from "@/lib/api/schemas/common";
import { createApiKey, revokeApiKey } from "@/lib/db/queries/api-keys";
import { getCurrentOrg } from "@/lib/db/queries/orgs";

export type CreateKeyState = { plaintext?: string; error?: string };

export async function createKey(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") return { error: "Only the owner can do this" };
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 60) return { error: "Name is required" };
  const mode = formData.get("mode") === "live" ? "live" : "test";
  const { plaintext } = await createApiKey(orgId, mode, name);
  revalidatePath("/dashboard/keys");
  return { plaintext };
}

export async function revokeKey(formData: FormData): Promise<void> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") throw new Error("owner only");
  const id = UuidSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await revokeApiKey(orgId, id.data);
  revalidatePath("/dashboard/keys");
}
