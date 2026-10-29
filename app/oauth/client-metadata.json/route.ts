import {
  blueskyClientMetadata,
  blueskyOAuthMode,
} from "@/lib/connect/bluesky-oauth";

export const dynamic = "force-dynamic";

export function GET(): Response {
  if (blueskyOAuthMode() === "loopback")
    return new Response("Not found", { status: 404 });
  return Response.json(blueskyClientMetadata(), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
