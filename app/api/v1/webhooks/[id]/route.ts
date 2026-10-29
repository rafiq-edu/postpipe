import { ApiError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/api/schemas/common";
import { withApi } from "@/lib/api/with-api";
import { deleteEndpoint } from "@/lib/db/queries/webhooks";

export const DELETE = withApi(async (ctx) => {
  if (
    !UuidSchema.safeParse(ctx.params.id).success ||
    !(await deleteEndpoint(ctx.orgId, ctx.mode, ctx.params.id))
  )
    throw new ApiError(404, "not_found", "webhook endpoint not found");
  return new Response(null, { status: 204 });
});
