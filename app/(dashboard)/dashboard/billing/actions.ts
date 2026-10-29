"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { billingProvider } from "@/lib/billing/provider";
import { getCurrentOrg } from "@/lib/db/queries/orgs";

export async function startCheckout(formData: FormData): Promise<void> {
  const { orgId, role } = await getCurrentOrg();
  if (role !== "owner") throw new Error("owner only");
  const plan = z.enum(["builder", "scale"]).parse(formData.get("plan"));
  const { url } = await billingProvider().createCheckout(orgId, plan);
  redirect(url);
}
