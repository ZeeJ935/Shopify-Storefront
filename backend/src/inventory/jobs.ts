import type { PgBoss } from "pg-boss";
import type { ReportError } from "../report.js";
import { runSyncAttempt } from "../catalog/jobs.js";

export const INVENTORY_FULL_SYNC_QUEUE = "inventory-full-sync";
/** Retries after the first attempt (3 attempts in total). */
export const INVENTORY_FULL_SYNC_RETRY_LIMIT = 2;

export function createInventoryJobs(boss: PgBoss, report?: ReportError) {
  return {
    async start(run: (reason: string) => Promise<unknown>) {
      await boss.createQueue(INVENTORY_FULL_SYNC_QUEUE, {
        retryLimit: INVENTORY_FULL_SYNC_RETRY_LIMIT,
        retryDelay: 60,
        retryBackoff: true,
      });
      await boss.work<{ reason?: string }>(INVENTORY_FULL_SYNC_QUEUE, async (jobs) => {
        for (const job of jobs) {
          await runSyncAttempt(
            run,
            {
              reason: job.data?.reason ?? "unknown",
              retryCount: job.retryCount,
              retryLimit: INVENTORY_FULL_SYNC_RETRY_LIMIT,
              jobName: INVENTORY_FULL_SYNC_QUEUE,
            },
            report,
          );
        }
      });
      // Nightly at 03:30 UTC; if the service was asleep then, run once when it wakes.
      await boss.schedule(INVENTORY_FULL_SYNC_QUEUE, "30 3 * * *", { reason: "nightly" }, { tz: "UTC", missed: "once" });
    },
    /** Manual / initial / backfill — same singleton so restarts do not pile up jobs. */
    async enqueueFullSync(reason: string) {
      return boss.send(INVENTORY_FULL_SYNC_QUEUE, { reason }, { singletonKey: "inventory-full-sync", singletonSeconds: 30 });
    },
  };
}

export type InventoryJobs = ReturnType<typeof createInventoryJobs>;
