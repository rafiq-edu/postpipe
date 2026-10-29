import { ApiError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/api/schemas/common";
import { withApi } from "@/lib/api/with-api";
import {
  deleteAccount,
  getAccount,
  serializeAccount,
} from "@/lib/db/queries/social-accounts";

const notFound = () =>
  new ApiError(404, "not_found", "Social account not found");

export const GET = withApi(async (ctx) => {
  if (!UuidSchema.safeParse(ctx.params.id).success) throw notFound();
  const row = await getAccount(ctx.orgId, ctx.mode, ctx.params.id);
  if (!row) throw notFound();
  return Response.json(serializeAccount(row));
});

export const DELETE = withApi(async (ctx) => {
  if (!UuidSchema.safeParse(ctx.params.id).success) throw notFound();
  await deleteAccount(ctx.orgId, ctx.mode, ctx.params.id);
  return new Response(null, { status: 204 });
});
