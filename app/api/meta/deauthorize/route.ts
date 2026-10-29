import { problem, problemFromError } from "@/lib/api/errors";
import { createServiceClient } from "@/lib/db/client";
import { revokeMetaUser } from "@/lib/meta/deletion";
import { appSecretName, parseSignedRequest } from "@/lib/meta/signed-request";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const value = form.get("signed_request");
    if (typeof value !== "string" || !value)
      return problem(400, "validation_failed", "signed_request is required");
    const app = new URL(req.url).searchParams.get("app");
    const parsed = parseSignedRequest(
      value,
      await getSecret(appSecretName(app)),
    );
    if (!parsed)
      return problem(
        400,
        "validation_failed",
        "signed_request signature is invalid",
      );
    await revokeMetaUser(await createServiceClient(), parsed.user_id);
    return Response.json({ ok: true });
  } catch (e) {
    return problemFromError(e);
  }
}
