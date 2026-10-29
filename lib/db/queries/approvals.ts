import { createServiceClient } from "../client";
import type { Tables } from "../types";

type Status = Tables<"platform_approvals">["status"];

export async function loadApprovals(): Promise<Record<string, Status>> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("platform_approvals")
    .select("platform, status");
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.platform, r.status]));
}

export function isApprovalLimited(status: Status | undefined): boolean {
  return status !== "approved" && status !== "not_needed";
}
