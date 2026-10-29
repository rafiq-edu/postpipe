import { ApiError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/api/schemas/common";
import { withApi } from "@/lib/api/with-api";
import {
  disconnectAccount,
  serializeAccount,
} from "@/lib/db/queries/social-accounts";

export const POST = withApi(
  async (ctx) => {
    if (!UuidSchema.safeParse(ctx.params.id).success)
      throw new ApiError(404, "not_found", "Social account not found");
    return Response.json(
      serializeAccount(
        await disconnectAccount(ctx.orgId, ctx.mode, ctx.params.id),
      ),
    );
  },
  { idempotent: true },
);
