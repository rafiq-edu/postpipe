import {
  blueskyOAuthMode,
  getBlueskyOAuthClient,
} from "@/lib/connect/bluesky-oauth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (blueskyOAuthMode() === "loopback")
    return new Response("Not found", { status: 404 });
  // `jwks` holds public keys only
  return Response.json((await getBlueskyOAuthClient()).jwks, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
