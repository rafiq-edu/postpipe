import { CreateUploadUrlSchema } from "@/lib/api/schemas/media";
import { parseBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/with-api";
import { createUploadUrl } from "@/lib/media/s3";

export const POST = withApi(
  async (ctx) => {
    const input = parseBody(CreateUploadUrlSchema, ctx.body);
    const r = await createUploadUrl(ctx.orgId, ctx.mode, input);
    return Response.json({
      media_id: r.mediaId,
      upload_url: r.uploadUrl,
      media_url: r.mediaUrl,
      expires_at: r.expiresAt,
    });
  },
  { idempotent: true },
);
