import * as Sentry from "@sentry/node";
import { logger } from "./lib/log/logger";
import { sentryOptions } from "./lib/observability/sentry";
import {
  runDailyJobs,
  runPublishTick,
  shouldSleep,
  WORKER_CONCURRENCY,
} from "./lib/publish/worker";
import { runWebhookTick } from "./lib/webhooks/deliver";

// Inert without a DSN: no init, no network.
if (process.env.SENTRY_DSN) Sentry.init(sentryOptions());

const TICK_MS = 10_000;
let stopping = false;
let wake: (() => void) | undefined;
let inFlight: Promise<number> = Promise.resolve(0);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });

// One stage failing must not stop the others.
async function stage<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    Sentry.captureException(e);
    logger.error("worker.stage_failed", {
      stage: name,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// Returns the number of targets the publish stage claimed.
async function tick(): Promise<number> {
  const publish = await stage("publish", () =>
    runPublishTick({ now: new Date() }),
  );
  const webhooks = await stage("webhooks", () =>
    runWebhookTick({ now: new Date() }),
  );
  const jobs = await stage("jobs", () => runDailyJobs(new Date()));
  logger.info("worker.heartbeat", { publish, webhooks, jobs });
  return publish?.claimed ?? 0;
}

function stop() {
  stopping = true;
  wake?.();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

async function fatal(e: unknown) {
  Sentry.captureException(e);
  logger.error("worker.fatal", {
    message: e instanceof Error ? e.message : String(e),
  });
  await Sentry.flush(2000);
  process.exit(1);
}
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

logger.info("worker.start", { concurrency: WORKER_CONCURRENCY });
while (!stopping) {
  inFlight = tick();
  const claimed = await inFlight;
  if (!stopping && shouldSleep(claimed, WORKER_CONCURRENCY))
    await sleep(TICK_MS);
}
await inFlight;
await Sentry.flush(2000);
process.exit(0);
