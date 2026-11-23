import type pg from "pg";
import { safeError } from "../errors.js";

export type IncomingWebhook = {
  webhookId: string;
  topic: string;
  shopDomain: string;
  /** Null for topics we only record; catalog keeps the body; others may be `{ id }` only. */
  payload: unknown;
  /** True when a handler is registered: queued for processing. */
  handled: boolean;
  triggeredAt?: string | null;
  apiVersion?: string | null;
};

/** Records a webhook and (for handled topics) queues it, atomically. */
export type WebhookIntake = (event: IncomingWebhook) => Promise<{ duplicate: boolean; eventId?: number }>;

/** Sends a queue job on the given connection, so it commits or rolls back with the insert. */
export type EnqueueOnClient = (client: pg.PoolClient, eventId: number) => Promise<void>;

/** What processing needs from the database. Tests pass a fake. */
export type WebhookStore = {
  /** Counts an attempt. Null when the event is missing, already processed, or already failed. */
  beginAttempt(id: number): Promise<{
    topic: string;
    attempts: number;
    payload: unknown;
    triggeredAt: string | null;
    apiVersion: string | null;
  } | null>;
  markProcessed(id: number): Promise<void>;
  /** Keeps the error; `final` also marks the event failed. */
  markError(id: number, error: string, final: boolean): Promise<void>;
};

export function createWebhookIntake(pool: pg.Pool, enqueue: EnqueueOnClient): WebhookIntake {
  return async (event) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<{ id: string }>(
        `insert into webhook_events (webhook_id, topic, shop_domain, payload, processed_at, triggered_at, api_version)
         values ($1, $2, $3, $4, case when $5::boolean then null else now() end, $6::timestamptz, $7)
         on conflict (webhook_id) do nothing
         returning id`,
        [
          event.webhookId,
          event.topic,
          event.shopDomain,
          event.payload === null ? null : JSON.stringify(event.payload),
          event.handled,
          event.triggeredAt ?? null,
          event.apiVersion ?? null,
        ],
      );
      if (inserted.rowCount === 0) {
        await client.query("rollback");
        return { duplicate: true };
      }
      const eventId = Number(inserted.rows[0].id);
      if (event.handled) await enqueue(client, eventId);
      await client.query("commit");
      return { duplicate: false, eventId };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
}

export function createWebhookStore(pool: pg.Pool): WebhookStore {
  return {
    async beginAttempt(id) {
      const { rows } = await pool.query<{
        topic: string;
        attempts: number;
        payload: unknown;
        triggered_at: Date | null;
        api_version: string | null;
      }>(
        `update webhook_events set attempts = attempts + 1
         where id = $1 and processed_at is null and failed_at is null
         returning topic, attempts, payload, triggered_at, api_version`,
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        topic: row.topic,
        attempts: row.attempts,
        payload: row.payload,
        triggeredAt: row.triggered_at ? row.triggered_at.toISOString() : null,
        apiVersion: row.api_version,
      };
    },
    async markProcessed(id) {
      await pool.query("update webhook_events set processed_at = now(), last_error = null where id = $1", [id]);
    },
    async markError(id, error, final) {
      await pool.query(
        `update webhook_events set last_error = $2, failed_at = case when $3::boolean then now() else failed_at end
         where id = $1`,
        [id, error, final],
      );
    },
  };
}

/** Log-safe text for last_error. */
export function errorText(error: unknown) {
  const e = safeError(error);
  return [e.type, e.code, e.message].filter(Boolean).join(": ").slice(0, 500);
}
