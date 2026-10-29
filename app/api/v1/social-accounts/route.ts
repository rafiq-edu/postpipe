import { z } from "zod";
import { parseListQuery } from "@/lib/api/pagination";
import { withApi } from "@/lib/api/with-api";
import {
  listAccounts,
  serializeAccount,
} from "@/lib/db/queries/social-accounts";
import { PLATFORMS } from "@/lib/platforms/types";

export const GET = withApi(async (ctx) => {
  const q = parseListQuery(
    new URL(ctx.req.url),
    z.object({
      external_id: z.string().min(1).max(255).optional(),
      platform: z.enum(PLATFORMS).optional(),
    }),
  );
  const page = await listAccounts(ctx.orgId, ctx.mode, q);
  return Response.json({
    data: page.data.map(serializeAccount),
    next_cursor: page.next_cursor,
  });
});
