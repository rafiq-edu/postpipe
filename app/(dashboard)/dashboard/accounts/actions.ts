"use server";

import { revalidatePath } from "next/cache";
import { UuidSchema } from "@/lib/api/schemas/common";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { disconnectAccount } from "@/lib/db/queries/social-accounts";
import { parseMode } from "../mode";

export async function disconnectAccountAction(
  formData: FormData,
): Promise<void> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") throw new Error("owner only");
  const id = UuidSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await disconnectAccount(
    orgId,
    parseMode(String(formData.get("mode"))),
    id.data,
  );
  revalidatePath("/dashboard/accounts");
}
