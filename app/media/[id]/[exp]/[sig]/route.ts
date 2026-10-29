import { logger } from "@/lib/log/logger";
import { verifyPull } from "@/lib/media/pull-url";
import { getMediaRow, getObjectStream } from "@/lib/media/s3";
import { PublishError } from "@/lib/platforms/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; exp: string; sig: string }> };

// tiktok.md section 4: photos must be JPEG or WebP. The 20 MB cap is enforced by validatePost before signing.
const MIMES = new Set(["image/jpeg", "image/webp"]);

// One identical 404 for every check failure so a caller cannot tell which check failed.
const notFound = () => new Response("Not Found", { status: 404 });

async function serve({ params }: Ctx, withBody: boolean) {
  let id: string;
  try {
    const p = await params;
    id = p.id;
    if (!(await verifyPull(id, p.exp, p.sig, Math.floor(Date.now() / 1000))))
      return notFound();
  } catch {
    return notFound();
  }
  try {
    const row = await getMediaRow(id);
    if (
      row.mode !== "live" ||
      row.status !== "validated" ||
      !MIMES.has(row.mime)
    )
      return notFound();
    // HEAD uses row.bytes: no extra S3 call and the body stream stays closed.
    const obj = withBody ? await getObjectStream(row.storage_path) : undefined;
    return new Response(obj?.body ?? null, {
      status: 200,
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(obj?.length ?? row.bytes),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof PublishError && e.code === "media_unreachable")
      return notFound();
    // Name and code only: the error text could carry the id, signature or URL.
    const x = e as { name?: unknown; code?: unknown };
    logger.error("media.pull_failed", {
      event: "media.pull_failed",
      error_name: typeof x.name === "string" ? x.name : "unknown",
      error_code: typeof x.code === "string" ? x.code : undefined,
    });
    return new Response("Service Unavailable", { status: 503 });
  }
}

export const GET = (_req: Request, ctx: Ctx) => serve(ctx, true);
export const HEAD = (_req: Request, ctx: Ctx) => serve(ctx, false);
