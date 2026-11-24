import type pg from "pg";

export type QueueHealth = { name: string; queued: number; active: number; failed: number; oldestQueuedSeconds: number | null };

/** pg-boss schema (the library default). */
export const PGBOSS_SCHEMA = "pgboss";

/**
 * Depth and age per pg-boss queue in one query. "Queued" = created or retry; the oldest
 * waiting job's age counts from when it became due (start_after), so a job waiting out a
 * retry delay isn't reported as old. Empty when pg-boss hasn't created its schema yet.
 */
export async function queueHealth(pool: pg.Pool): Promise<QueueHealth[]> {
  const exists = await pool.query("select 1 from information_schema.tables where table_schema = $1 and table_name = 'job'", [PGBOSS_SCHEMA]);
  if (!exists.rowCount) return [];
  const { rows } = await pool.query<{ name: string; queued: string; active: string; failed: string; oldest_seconds: string | null }>(
    `select q.name,
            count(j.id) filter (where j.state in ('created', 'retry'))::text as queued,
            count(j.id) filter (where j.state = 'active')::text as active,
            count(j.id) filter (where j.state = 'failed')::text as failed,
            floor(extract(epoch from now() - min(j.start_after) filter (where j.state in ('created', 'retry') and j.start_after <= now())))::text as oldest_seconds
     from ${PGBOSS_SCHEMA}.queue q
     left join ${PGBOSS_SCHEMA}.job j on j.name = q.name
     where q.name not like '\\_\\_pgboss\\_\\_%'  -- pg-boss's own internal queues
     group by q.name
     order by q.name`,
  );
  return rows.map((r) => ({
    name: r.name,
    queued: Number(r.queued),
    active: Number(r.active),
    failed: Number(r.failed),
    oldestQueuedSeconds: r.oldest_seconds === null ? null : Number(r.oldest_seconds),
  }));
}
