import { createServiceClient } from "../lib/db/client";

export const hasDb = Boolean(
  process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export async function testDb() {
  return createServiceClient();
}
