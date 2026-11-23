import type pg from "pg";
import type { PgBoss } from "pg-boss";
import type { ReportError } from "../report.js";

export const FULFILLMENT_QUEUE = "fulfillment-create";
/** Retries after the first attempt (3 attempts in total). */
export const FULFILLMENT_RETRY_LIMIT = 2;

/**
 * pg-boss queue for fulfillment actions. Jobs are sent on the caller's transaction,
 * so an action row and its job commit together.
 */
export function createFulfillmentJobs(boss: PgBoss, report?: ReportError) {
  return {
    async start(opts: {
      run: (actionId: number) => Promise<unknown>;
      /** Called once when the last attempt fails. */
      onFinalFailure: (actionId: number, error: unknown) => Promise<void>;
    }) {
      await boss.createQueue(FULFILLMENT_QUEUE, { retryLimit: FULFILLMENT_RETRY_LIMIT, retryDelay: 30, retryBackoff: true });
      await boss.work<{ actionId: number }>(FULFILLMENT_QUEUE, async (jobs) => {
        for (const job of jobs) {
          try {
            await opts.run(job.data.actionId);
          } catch (error) {
            if (job.retryCount >= FULFILLMENT_RETRY_LIMIT) {
              await opts.onFinalFailure(job.data.actionId, error);
              report?.(error, { kind: "job", job: FULFILLMENT_QUEUE, action_id: String(job.data.actionId) });
            }
            throw error;
          }
        }
      });
    },
    async enqueueOnClient(client: pg.PoolClient, actionId: number) {
      await boss.send(FULFILLMENT_QUEUE, { actionId }, { db: { executeSql: (text, values) => client.query(text, values) } });
    },
  };
}
