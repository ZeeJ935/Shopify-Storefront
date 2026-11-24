import type pg from "pg";
import type { PgBoss } from "pg-boss";
import type { ReportError } from "../report.js";
import { ItemBusyError } from "./push.js";

export const PUSH_ITEM_QUEUE = "warehouse-push-item";
export const RECONCILE_QUEUE = "warehouse-reconcile";
export const PUSH_RETRY_LIMIT = 2;

type ItemJob = { pushId: number; itemGid: string };

/**
 * Push jobs use the "stately" policy keyed by inventory item: at most one active and one
 * queued job per item, so two pushes for one item never run at the same time, and a third
 * push for an item that already has a queued job gets null (logged as skipped_already_queued).
 */
export function createWarehouseJobs(boss: PgBoss, report?: ReportError) {
  return {
    async start(opts: {
      runItem: (data: ItemJob) => Promise<unknown>;
      onFinalFailure: (data: ItemJob, error: unknown) => Promise<void>;
      reconcile?: () => Promise<unknown>;
    }) {
      await boss.createQueue(PUSH_ITEM_QUEUE, { policy: "stately", retryLimit: PUSH_RETRY_LIMIT, retryDelay: 30, retryBackoff: true });
      await boss.work<ItemJob>(PUSH_ITEM_QUEUE, { localConcurrency: 4 }, async (jobs) => {
        for (const job of jobs) {
          try {
            await opts.runItem(job.data);
          } catch (error) {
            // Lock busy: let pg-boss retry later without counting it as a real failure report.
            if (!(error instanceof ItemBusyError) && job.retryCount >= PUSH_RETRY_LIMIT) {
              await opts.onFinalFailure(job.data, error);
              report?.(error, { kind: "job", job: "warehouse-push", result: "failed" });
            }
            throw error;
          }
        }
      });
      if (opts.reconcile) {
        const reconcile = opts.reconcile;
        await boss.createQueue(RECONCILE_QUEUE, { retryLimit: 2, retryDelay: 60, retryBackoff: true });
        await boss.work(RECONCILE_QUEUE, async (jobs) => {
          for (const job of jobs) {
            try {
              await reconcile();
            } catch (error) {
              if (job.retryCount >= 2) report?.(error, { kind: "job", job: "warehouse-reconcile" });
              throw error;
            }
          }
        });
        await boss.schedule(RECONCILE_QUEUE, "*/30 * * * *", {}, { tz: "UTC" });
      }
    },
    async enqueueItemOnClient(client: pg.PoolClient, data: ItemJob): Promise<string | null> {
      return boss.send(PUSH_ITEM_QUEUE, data, {
        singletonKey: `warehouse-item:${data.itemGid}`,
        db: { executeSql: (text, values) => client.query(text, values) },
      });
    },
    enqueueReconcile: () => boss.send(RECONCILE_QUEUE, {}, { singletonKey: "warehouse-reconcile", singletonSeconds: 60 }),
  };
}

export type WarehouseJobs = ReturnType<typeof createWarehouseJobs>;
