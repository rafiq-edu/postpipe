import { ApiError } from "@/lib/api/errors";
import { CreateWebhookEndpointSchema } from "@/lib/api/schemas/webhooks";
import { parseBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/with-api";
import { createEndpoint, listEndpoints } from "@/lib/db/queries/webhooks";
import { assertPublicUrl } from "@/lib/webhooks/url-guard";

export const POST = withApi(
  async (ctx) => {
    const input = parseBody(CreateWebhookEndpointSchema, ctx.body);
    if (ctx.mode === "live" && new URL(input.url).protocol !== "https:")
      throw new ApiError(
        422,
        "validation_failed",
        "url must use https in live mode",
      );
    await assertPublicUrl(input.url).catch(() => {
      throw new ApiError(
        400,
        "validation_failed",
        "url must resolve to a public address",
      );
    });
    const ep = await createEndpoint(
      ctx.orgId,
      ctx.mode,
      input.url,
      input.events,
    );
    return Response.json(ep, { status: 201 });
  },
  { idempotent: true },
);

export const GET = withApi(async (ctx) =>
  Response.json({
    data: await listEndpoints(ctx.orgId, ctx.mode),
    next_cursor: null,
  }),
);
