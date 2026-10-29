import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/observability/sentry";

export function register() {
  // Inert without a DSN: no init, no network.
  if (process.env.SENTRY_DSN && process.env.NEXT_RUNTIME === "nodejs")
    Sentry.init(sentryOptions());
}

export const onRequestError = Sentry.captureRequestError;
