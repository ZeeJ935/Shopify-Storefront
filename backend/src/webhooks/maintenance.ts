import type pg from "pg";
import type { PgBoss } from "pg-boss";
import type { ReportError } from "../report.js";
import { MAX_ATTEMPTS } from "./topics.js";

/**
 * An event not processed or failed this long after it arrived is "stuck": all retries
 * (5 attempts, 30 s exponential backoff ≈ 8 min) should be over by then. Typical cause:
 * the worker died mid-attempt, so pg-boss never ran the next retry or the final markError.
 */
export const STUCK_AFTER_MINUTES = 30;
/** Processed events are kept this long for debugging, then deleted. */
export const PROCESSED_RETENTION_DAYS = 30;
/** Failed events are kept longer so they can be investigated. */
export const FAILED_RETENTION_DAYS = 90;
/** Rows deleted per statement, so a big backlog never holds one long lock. */
export const PURGE_BATCH = 5000;
/** Stuck events handled per maintenance run. */
export const STUCK_BATCH = 100;

export const WEBHOOK_MAINTENANCE_QUEUE = "webhook-maintenance";
export const WEBHOOK_PURGE_QUEUE = "webhook-purge";

export type StuckEvent = { id: number; topic: string; attempts: number };

export type WebhookMaintenanceStore = {
  /** Oldest stuck events first. */
  findStuck(limit?: number): Promise<StuckEvent[]>;
  /** Marks a stuck event failed (no attempts left), keeping why in last_error. */
  markStuckFailed(id: number): Promise<void>;
  /** Deletes old processed/failed events in batches. Pending events are never deleted. */
  purgeOld(): Promise<{ processed: number; failed: number }>;
};

export function createWebhookMaintenanceStore(pool: pg.Pool): WebhookMaintenanceStore {
  async function deleteInBatches(condition: string): Promise<number> {
    let total = 0;
    for (;;) {
      const { rowCount } = await pool.query(
        `delete from webhook_events where id in (
           select id from webhook_events where ${condition} limit ${PURGE_BATCH}
         )`,
      );
      total += rowCount ?? 0;
      if ((rowCount ?? 0) < PURGE_BATCH) return total;
    }
  }

  return {
    async findStuck(limit = STUCK_BATCH) {
      const { rows } = await pool.query<{ id: string; topic: string; attempts: number }>(
        `select id, topic, attempts from webhook_events
         where processed_at is null and failed_at is null
           and received_at < now() - make_interval(mins => $1)
         order by received_at asc
         limit $2`,
        [STUCK_AFTER_MINUTES, limit],
      );
      return rows.map((r) => ({ id: Number(r.id), topic: r.topic, attempts: r.attempts }));
    },

    async markStuckFailed(id) {
      await pool.query(
        `update webhook_events
         set failed_at = now(), last_error = coalesce(last_error || ' | ', '') || 'stuck: no attempts left'
         where id = $1 and processed_at is null and failed_at is null`,
        [id],
      );
    },

    async purgeOld() {
      const processed = await deleteInBatches(
        `processed_at is not null and received_at < now() - interval '${PROCESSED_RETENTION_DAYS} days'`,
      );
      const failed = await deleteInBatches(
        `failed_at is not null and received_at < now() - interval '${FAILED_RETENTION_DAYS} days'`,
      );
      return { processed, failed };
    },
  };
}

export type RecoverDeps = {
  store: Pick<WebhookMaintenanceStore, "findStuck" | "markStuckFailed">;
  /** Queues the event again (idempotent handlers make a re-run safe). */
  requeue: (eventId: number) => Promise<unknown>;
  report?: ReportError;
  /** Log line with topic + id only (no payload). */
  log?: (line: { msg: string; topic: string; event_id: number; attempts: number }) => void;
  maxAttempts?: number;
};

/**
 * Stuck events with attempts left are queued again; those with none left are marked
 * failed and reported once, like a normal final failure.
 */
export async function recoverStuckWebhooks(deps: RecoverDeps): Promise<{ requeued: number; failed: number }> {
  const max = deps.maxAttempts ?? MAX_ATTEMPTS;
  let requeued = 0;
  let failed = 0;
  for (const event of await deps.store.findStuck()) {
    if (event.attempts >= max) {
      await deps.store.markStuckFailed(event.id);
      deps.report?.(new Error(`webhook stuck after its last attempt (${event.topic})`), {
        kind: "webhook",
        topic: event.topic,
        event_id: String(event.id),
        reason: "stuck",
      });
      deps.log?.({ msg: "stuck webhook marked failed", topic: event.topic, event_id: event.id, attempts: event.attempts });
      failed++;
    } else {
      await deps.requeue(event.id);
      deps.log?.({ msg: "stuck webhook requeued", topic: event.topic, event_id: event.id, attempts: event.attempts });
      requeued++;
    }
  }
  return { requeued, failed };
}

/**
 * pg-boss schedules: stuck-event recovery every 15 minutes, purge daily at 05:00 UTC.
 * Failures on the last retry are reported (same pattern as the sync jobs).
 */
export function createWebhookMaintenanceJobs(boss: PgBoss, report?: ReportError) {
  const RETRY_LIMIT = 2;

  async function work(queue: string, run: () => Promise<unknown>) {
    await boss.createQueue(queue, { retryLimit: RETRY_LIMIT, retryDelay: 60, retryBackoff: true });
    await boss.work(queue, async (jobs) => {
      for (const job of jobs) {
        try {
          await run();
        } catch (error) {
          if (job.retryCount >= RETRY_LIMIT) report?.(error, { kind: "job", job: queue });
          throw error;
        }
      }
    });
  }

  return {
    async start(opts: { recover: () => Promise<unknown>; purge: () => Promise<unknown> }) {
      await work(WEBHOOK_MAINTENANCE_QUEUE, opts.recover);
      await work(WEBHOOK_PURGE_QUEUE, opts.purge);
      await boss.schedule(WEBHOOK_MAINTENANCE_QUEUE, "*/15 * * * *", {}, { tz: "UTC" });
      await boss.schedule(WEBHOOK_PURGE_QUEUE, "0 5 * * *", {}, { tz: "UTC", missed: "once" });
    },
  };
}
