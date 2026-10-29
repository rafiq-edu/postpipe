import * as Sentry from "@sentry/node";
import { createServiceClient } from "../db/client";
import { runBillingDaily } from "../jobs/billing";
import { runMediaGc } from "../jobs/media-gc";
import { runTokenHealth } from "../jobs/token-health";
import { logger } from "../log/logger";
import { claimDue } from "./lock";
import { publishTarget } from "./steps";

const configured = Number(process.env.WORKER_CONCURRENCY ?? 5);
export const WORKER_CONCURRENCY =
  Number.isInteger(configured) && configured >= 1 ? configured : 5;

/** A full batch means more work is likely due, so the worker skips its sleep. */
export const shouldSleep = (claimed: number, limit: number): boolean =>
  claimed < limit;

export async function runPublishTick(opts: {
  now: Date;
  limit?: number;
}): Promise<{
  claimed: number;
  success: number;
  wait: number;
  retry: number;
  error: number;
  quota: number;
  maxLatenessMs: number | null;
}> {
  const rows = await claimDue(opts.limit ?? WORKER_CONCURRENCY, opts.now);
  const out = {
    claimed: rows.length,
    success: 0,
    wait: 0,
    retry: 0,
    error: 0,
    quota: 0,
    maxLatenessMs: null as number | null,
  };
  const settled = await Promise.allSettled(
    rows.map((r) => publishTarget(r, { now: opts.now })),
  );
  settled.forEach((s, i) => {
    if (s.status === "rejected") {
      Sentry.captureException(s.reason);
      logger.error("publish.target_crashed", {
        target_id: rows[i].id,
        message:
          s.reason instanceof Error ? s.reason.message : String(s.reason),
      });
      out.error++;
      return;
    }
    if (s.value.outcome !== "skipped") out[s.value.outcome]++;
    const l = s.value.latenessMs;
    if (l !== null) out.maxLatenessMs = Math.max(out.maxLatenessMs ?? l, l);
  });
  logger.info("publish.tick", {
    claimed: out.claimed,
    success: out.success,
    wait: out.wait,
    retry: out.retry,
    error: out.error,
    quota: out.quota,
    max_lateness_ms: out.maxLatenessMs,
  });
  return out;
}

export const DAILY_JOBS: Record<string, (now: Date) => Promise<unknown>> = {
  "media-gc": runMediaGc,
  "token-health": runTokenHealth,
  billing: runBillingDaily,
};

/** Runs each job whose last run is over 24 hours old. Returns the names that ran. */
export async function runDailyJobs(
  now: Date,
  jobs: Record<string, (now: Date) => Promise<unknown>> = DAILY_JOBS,
): Promise<string[]> {
  const db = await createServiceClient();
  const ran: string[] = [];
  for (const [name, job] of Object.entries(jobs)) {
    const { data: won, error } = await db.rpc("claim_daily_job", {
      p_name: name,
      p_now: now.toISOString(),
    });
    if (error) throw error;
    if (!won) continue;
    ran.push(name);
    try {
      await job(now);
    } catch (e) {
      // last_run_at already moved, so the job retries in 24 hours
      Sentry.captureException(e);
      logger.error("job.failed", {
        name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return ran;
}
