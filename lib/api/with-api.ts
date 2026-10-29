import { PLANS, planOf } from "../billing/plans";
import { createServiceClient } from "../db/client";
import { authenticate } from "./auth";
import { problem, problemFromError } from "./errors";
import {
  findIdempotent,
  releaseIdempotent,
  requestHash,
  reserveIdempotent,
  storeIdempotent,
} from "./idempotency";
import { rateLimit, rateLimitHeaders } from "./rate-limit";

export interface ApiContext {
  req: Request;
  orgId: string;
  apiKeyId: string;
  mode: "live" | "test";
  body: unknown;
  params: Record<string, string>;
}

type RouteArg = { params: Promise<Record<string, string>> };

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export function withApi(
  handler: (ctx: ApiContext) => Promise<Response>,
  opts?: { idempotent?: boolean },
): (req: Request, route?: RouteArg) => Promise<Response> {
  return async (req, route) => {
    try {
      const { orgId, apiKeyId, mode } = await authenticate(req);

      const db = await createServiceClient();
      const { data: org, error } = await db
        .from("organizations")
        .select("plan")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      const rl = await rateLimit(
        apiKeyId,
        PLANS[planOf(org.plan)].ratePerMinute,
      );
      const rlHeaders = rateLimitHeaders(rl);
      if (!rl.ok)
        return withHeaders(
          problem(
            429,
            "rate_limited",
            "Rate limit exceeded, retry after the Retry-After seconds",
          ),
          rlHeaders,
        );

      const raw = await req.text();
      let body: unknown;
      if (raw !== "") {
        try {
          body = JSON.parse(raw);
        } catch {
          return withHeaders(
            problem(400, "validation_failed", "Body must be valid JSON"),
            rlHeaders,
          );
        }
      }

      const key = opts?.idempotent ? req.headers.get("Idempotency-Key") : null;
      let hash = "";
      if (key !== null) {
        if (key.length > 255)
          return withHeaders(
            problem(
              400,
              "validation_failed",
              "Idempotency-Key must be at most 255 characters",
            ),
            rlHeaders,
          );
        hash = requestHash(req.method, new URL(req.url).pathname, mode, raw);
        if (!(await reserveIdempotent(orgId, key, hash))) {
          const found = await findIdempotent(orgId, key);
          if (found) {
            if (found.request_hash !== hash)
              return withHeaders(
                problem(
                  422,
                  "idempotency_key_reused",
                  "Idempotency-Key was already used with a different request",
                ),
                rlHeaders,
              );
            if (!found.response)
              return withHeaders(
                problem(
                  409,
                  "idempotency_key_in_use",
                  "A request with this Idempotency-Key is still running. Retry later.",
                ),
                rlHeaders,
              );
            return new Response(found.response.body, {
              status: found.response.status,
              headers: {
                ...found.response.headers,
                ...rlHeaders,
                "Idempotent-Replayed": "true",
              },
            });
          }
          // Row vanished between reserve and read: let the client retry.
          return withHeaders(
            problem(
              409,
              "idempotency_key_in_use",
              "A request with this Idempotency-Key is still running. Retry later.",
            ),
            rlHeaders,
          );
        }
      }

      let res: Response;
      try {
        res = await handler({
          req,
          orgId,
          apiKeyId,
          mode,
          body,
          params: (await route?.params) ?? {},
        });
      } catch (e) {
        if (key !== null) await releaseIdempotent(orgId, key, hash);
        throw e;
      }

      if (key !== null && res.status >= 500)
        await releaseIdempotent(orgId, key, hash);
      else if (key !== null)
        await storeIdempotent(orgId, key, hash, {
          status: res.status,
          headers: {
            "content-type":
              res.headers.get("content-type") ?? "application/json",
          },
          body: await res.clone().text(),
        });
      return withHeaders(res, rlHeaders);
    } catch (e) {
      return problemFromError(e);
    }
  };
}
