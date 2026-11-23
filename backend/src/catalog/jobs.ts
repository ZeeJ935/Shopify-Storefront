import type { PgBoss } from "pg-boss";

export const FULL_SYNC_QUEUE = "catalog-full-sync";

/**
 * Full catalog sync on pg-boss: nightly safety net, debounced resync after
 * inventory changes, and on-demand runs. Needs pg-boss started (queue.init()).
 */
export function createCatalogJobs(boss: PgBoss) {
  return {
    async start(run: (reason: string) => Promise<unknown>) {
      await boss.createQueue(FULL_SYNC_QUEUE, { retryLimit: 2, retryDelay: 60, retryBackoff: true });
      await boss.work<{ reason?: string }>(FULL_SYNC_QUEUE, async (jobs) => {
        for (const job of jobs) await run(job.data?.reason ?? "unknown");
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
