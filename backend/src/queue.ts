import { PgBoss } from "pg-boss";
import type pg from "pg";
import { MAX_ATTEMPTS } from "./webhooks/topics.js";

export const WEBHOOK_QUEUE = "shopify-webhook";

type WebhookJob = { eventId: number };

/**
 * Postgres-backed queue (pg-boss) for webhook processing. Runs in the API
 * process. Failed jobs are retried with exponential backoff, MAX_ATTEMPTS in total.
 */
export function createWebhookQueue(
  databaseUrl: string,
  { name = WEBHOOK_QUEUE, retryDelaySeconds = 30 }: { name?: string; retryDelaySeconds?: number } = {},
) {
  const boss = new PgBoss({ connectionString: databaseUrl, max: 3 });
  boss.on("error", (error) => console.error("[queue]", error instanceof Error ? error.message : error));

  return {
    name,
    async start(handle: (eventId: number) => Promise<unknown>) {
      await boss.start();
      await boss.createQueue(name, {
        retryLimit: MAX_ATTEMPTS - 1,
        retryDelay: retryDelaySeconds,
        retryBackoff: true,
      });
      await boss.work<WebhookJob>(name, async (jobs) => {
        for (const job of jobs) await handle(job.data.eventId);
      });
    },
    /** Sends on the caller's connection, so the job commits or rolls back with their transaction. */
    async enqueueOnClient(client: pg.PoolClient, eventId: number) {
      await boss.send(name, { eventId }, { db: { executeSql: (text, values) => client.query(text, values) } });
    },
    stop: () => boss.stop({ graceful: true, timeout: 10_000 }),
    /** For tests: removes the queue and its jobs. */
    deleteQueue: () => boss.deleteQueue(name),
  };
}
