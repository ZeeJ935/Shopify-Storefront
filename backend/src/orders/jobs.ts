import type { PgBoss } from "pg-boss";
import type { ReportError } from "../report.js";
import { runSyncAttempt } from "../catalog/jobs.js";

export const ORDERS_SYNC_QUEUE = "orders-sync";
/** Retries after the first attempt (3 attempts in total). */
export const ORDERS_SYNC_RETRY_LIMIT = 2;

export function createOrdersJobs(boss: PgBoss, report?: ReportError) {
  return {
    async start(run: (reason: string) => Promise<unknown>) {
      await boss.createQueue(ORDERS_SYNC_QUEUE, {
        retryLimit: ORDERS_SYNC_RETRY_LIMIT,
        retryDelay: 60,
        retryBackoff: true,
      });
      await boss.work<{ reason?: string }>(ORDERS_SYNC_QUEUE, async (jobs) => {
        for (const job of jobs) {
          await runSyncAttempt(
            run,
            {
              reason: job.data?.reason ?? "unknown",
              retryCount: job.retryCount,
              retryLimit: ORDERS_SYNC_RETRY_LIMIT,
              jobName: ORDERS_SYNC_QUEUE,
            },
            report,
          );
        }
      });
      // Nightly at 04:00 UTC; if the service was asleep then, run once when it wakes.
      await boss.schedule(ORDERS_SYNC_QUEUE, "0 4 * * *", { reason: "nightly" }, { tz: "UTC", missed: "once" });
    },
    /** Manual / initial / backfill — same singleton so restarts do not pile up jobs. */
    async enqueueFullSync(reason: string) {
      return boss.send(ORDERS_SYNC_QUEUE, { reason }, { singletonKey: "orders-sync", singletonSeconds: 30 });
    },
  };
}

export type OrdersJobs = ReturnType<typeof createOrdersJobs>;
