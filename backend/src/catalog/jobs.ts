import type { PgBoss } from "pg-boss";
import type { ReportError } from "../report.js";

export const FULL_SYNC_QUEUE = "catalog-full-sync";
/** Retries after the first attempt (3 attempts in total). */
export const FULL_SYNC_RETRY_LIMIT = 2;

/**
 * Runs one full-sync attempt. A failure is reported only on the last attempt
 * (earlier ones are retried by pg-boss), tagged with the job name and reason;
 * it's rethrown either way so pg-boss records it.
 */
export async function runSyncAttempt(
  run: (reason: string) => Promise<unknown>,
  job: { reason: string; retryCount: number; retryLimit?: number; jobName?: string },
  report?: ReportError,
) {
  try {
    await run(job.reason);
  } catch (error) {
    if (job.retryCount >= (job.retryLimit ?? FULL_SYNC_RETRY_LIMIT)) {
      report?.(error, {
        kind: "job",
        job: job.jobName ?? FULL_SYNC_QUEUE,
        reason: job.reason,
        attempt: String(job.retryCount + 1),
      });
    }
    throw error;
  }
}

/**
 * Full catalog sync on pg-boss: nightly safety net, debounced resync after
 * inventory changes, and on-demand runs. Needs pg-boss started (queue.init()).
 */
export function createCatalogJobs(boss: PgBoss, report?: ReportError) {
  return {
    async start(run: (reason: string) => Promise<unknown>) {
      await boss.createQueue(FULL_SYNC_QUEUE, { retryLimit: FULL_SYNC_RETRY_LIMIT, retryDelay: 60, retryBackoff: true });
      await boss.work<{ reason?: string }>(FULL_SYNC_QUEUE, async (jobs) => {
        for (const job of jobs) {
          await runSyncAttempt(run, { reason: job.data?.reason ?? "unknown", retryCount: job.retryCount }, report);
        }
      });
      // Nightly at 03:00 UTC; if the service was asleep then, run once when it wakes.
      await boss.schedule(FULL_SYNC_QUEUE, "0 3 * * *", { reason: "nightly" }, { tz: "UTC", missed: "once" });
    },
    /** At most one queued resync per minute: bursts of inventory webhooks collapse into one. */
    async scheduleFullSync(reason: string) {
      await boss.send(FULL_SYNC_QUEUE, { reason }, { singletonKey: "catalog-resync", singletonSeconds: 60, singletonNextSlot: true });
    },
    /** Runs a full sync now (for example the first backfill, or POST /v1/catalog/sync). */
    async enqueueFullSync(reason: string) {
      return boss.send(FULL_SYNC_QUEUE, { reason }, { singletonKey: `catalog-now-${reason}`, singletonSeconds: 30 });
    },
  };
}

export type CatalogJobs = ReturnType<typeof createCatalogJobs>;
