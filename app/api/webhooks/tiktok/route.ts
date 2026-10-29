import { z } from "zod";
import { problem, problemFromError } from "@/lib/api/errors";
import { createServiceClient } from "@/lib/db/client";
import { logger } from "@/lib/log/logger";
import { verifySignature } from "@/lib/platforms/tiktok/api";
import { settleExternalSuccess } from "@/lib/publish/steps";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

// tiktok.md section 6, Body fields. content is a JSON string.
const EnvelopeSchema = z.object({
  event: z.string(),
  user_openid: z.string().optional(),
  content: z.string().optional(),
});
// tiktok.md section 6, post.publish.publicly_available: publish_id, post_id.
const PublicSchema = z.object({
  publish_id: z.string().min(1).max(64),
  // A string up to 64 characters, or a safe integer. A rounded 19-digit number is not an id.
  // A bad id becomes undefined: the event is acknowledged and the status poll settles the target later.
  post_id: z
    .union([z.string().min(1).max(64), z.number().refine(Number.isSafeInteger)])
    .transform(String)
    .optional()
    .catch(undefined),
});

// Ours: events are small JSON. Read no more than this before the signature is checked.
const MAX_BODY = 64 * 1024;

/** The raw body, or null when it is over MAX_BODY (checked by header, then while streaming). */
async function readCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Public route: TikTok sends no API key. The signature is checked on the raw body before any parse.
export async function POST(req: Request): Promise<Response> {
  try {
    const raw = await readCapped(req);
    if (raw === null)
      return problem(413, "validation_failed", "body is too large");
    const secret = await getSecret("TIKTOK_CLIENT_SECRET");
    if (
      !verifySignature(
        raw,
        req.headers.get("tiktok-signature"),
        secret,
        Date.now(),
      )
    )
      return problem(401, "invalid_signature", "invalid signature");

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return problem(400, "validation_failed", "body is not JSON");
    }
    const env = EnvelopeSchema.safeParse(json);
    if (!env.success)
      return problem(400, "validation_failed", "unexpected event shape");
    // Other event types are acknowledged and ignored (tiktok.md section 6: reply 200 at once).
    if (env.data.event !== "post.publish.publicly_available")
      return Response.json({ ok: true });
    let content: unknown;
    try {
      content = JSON.parse(env.data.content ?? "");
    } catch {
      return problem(400, "validation_failed", "content is not JSON");
    }
    const ev = PublicSchema.safeParse(content);
    if (!ev.success)
      return problem(400, "validation_failed", "unexpected event content");

    if (!ev.data.post_id) return Response.json({ ok: true });
    const db = await createServiceClient();
    const { data: target, error } = await db
      .from("social_post_targets")
      .select("id, org_id, post_id, mode, platform, social_account_id")
      .eq("platform", "tiktok")
      .eq("platform_publish_id", ev.data.publish_id)
      .maybeSingle();
    if (error) throw error;
    if (!target) return Response.json({ ok: true });
    // tiktok.md section 6, Body fields: user_openid is part of every event, so a missing one is not trusted.
    const { data: acct, error: ae } = await db
      .from("social_accounts")
      .select("platform_user_id")
      .eq("id", target.social_account_id)
      .maybeSingle();
    if (ae) throw ae;
    if (
      !env.data.user_openid ||
      acct?.platform_user_id !== env.data.user_openid
    ) {
      logger.warn("tiktok.webhook.user_mismatch", { target_id: target.id });
      return Response.json({ ok: true });
    }
    // The post URL needs the username, which user.info.basic does not give (tiktok.md section 3): only the id is set.
    const outcome = await settleExternalSuccess(
      target,
      ev.data.post_id,
      ev.data.publish_id,
      new Date(),
    );
    logger.info("tiktok.webhook", { target_id: target.id, outcome });
    return Response.json({ ok: true });
  } catch (e) {
    return problemFromError(e);
  }
}
