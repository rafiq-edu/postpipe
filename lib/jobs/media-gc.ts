import { createServiceClient } from "../db/client";
import { deleteMediaObject } from "../media/s3";

const DAY_MS = 86_400_000;

export async function runMediaGc(
  now = new Date(),
): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const db = await createServiceClient();
  const { data, error } = await db
    .from("media")
    .select("id, storage_path")
    .or(
      `last_used_at.lt.${cutoff},and(last_used_at.is.null,created_at.lt.${cutoff})`,
    )
    .limit(500);
  if (error) throw error;
  let deleted = 0;
  for (const m of data) {
    const { count, error: e2 } = await db
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .contains("media_ids", [m.id])
      .in("status", ["draft", "scheduled", "processing"]);
    if (e2) throw e2;
    if (count) continue;
    try {
      await deleteMediaObject(m.storage_path);
    } catch (e) {
      const err = e as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (err.$metadata?.httpStatusCode !== 404 && err.name !== "NotFound")
        throw e;
    }
    const { error: e3 } = await db.from("media").delete().eq("id", m.id);
    if (e3) throw e3;
    deleted++;
  }
  return { deleted };
}
