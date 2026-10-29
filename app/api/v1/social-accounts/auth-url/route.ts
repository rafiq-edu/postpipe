import { ApiError } from "@/lib/api/errors";
import { CreateAuthUrlSchema } from "@/lib/api/schemas/social-accounts";
import { parseBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/with-api";
import { connectPageUrl } from "@/lib/connect/oauth";
import { createConnectSession } from "@/lib/db/queries/connect-sessions";
import {
  notAvailableMessage,
  platformAvailable,
} from "@/lib/platforms/availability";
import { PLATFORM_LABELS } from "@/lib/platforms/labels";
import { hasAdapter } from "@/lib/platforms/registry";
import type { Json } from "@/lib/platforms/types";

export const POST = withApi(
  async (ctx) => {
    const input = parseBody(CreateAuthUrlSchema, ctx.body);
    if (
      ctx.mode === "live" &&
      (input.platform === "mock" || !hasAdapter(input.platform))
    )
      throw new ApiError(
        422,
        "validation_failed",
        `Platform ${input.platform} is not available in live mode yet`,
        {
          errors: [
            { path: ["platform"], message: "not available in live mode" },
          ],
        },
      );
    if (
      ctx.mode === "live" &&
      !(await platformAvailable(ctx.orgId, input.platform))
    )
      throw new ApiError(
        422,
        "platform_not_available",
        notAvailableMessage(PLATFORM_LABELS[input.platform]),
      );
    const s = await createConnectSession({
      orgId: ctx.orgId,
      mode: ctx.mode,
      platform: input.platform,
      externalId: input.external_id,
      redirectUrl: input.redirect_url,
      platformData: (input.platform_data ?? {}) as Record<string, Json>, // parsed JSON is Json
    });
    return Response.json({
      url: connectPageUrl(s.token),
      expires_at: s.expiresAt,
    });
  },
  { idempotent: true },
);
