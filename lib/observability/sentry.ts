// SENTRY_DSN is optional (unset means Sentry is off), so this reads process.env, not getSecret (which throws when a key is missing).
import type { ErrorEvent } from "@sentry/node";

/** Removes everything on the request that could hold a bearer key or token. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
  }
  // Breadcrumbs hold outgoing HTTP URLs; some platforms put access tokens in the query.
  delete event.breadcrumbs;
  return event;
}

export function sentryOptions() {
  return {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    release: process.env.GIT_SHA ?? "dev", // same source as /api/health
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  };
}
