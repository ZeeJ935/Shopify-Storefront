// Real Postgres, in a throwaway database (purge deletes by age, so never run it on dev data).
// Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { createWebhookMaintenanceStore, PURGE_BATCH } from "../src/webhooks/maintenance.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("webhook maintenance in Postgres", () => {
  const dbName = `webhook_maint_test_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  const store = createWebhookMaintenanceStore(pool);
  const db = createDb(testUrl);

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  });

  afterAll(async () => {
    await db.close();
    await pool.end();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  /** Inserts an event `ageMinutes` old in the given state. */
  async function event(id: string, ageMinutes: number, state: "pending" | "processed" | "failed", attempts = 1) {
    await pool.query(
      `insert into webhook_events (webhook_id, topic, shop_domain, received_at, processed_at, failed_at, attempts)
       values ($1, 'orders/updated', 's', now() - make_interval(mins => $2),
               case when $3 = 'processed' then now() end, case when $3 = 'failed' then now() end, $4)`,
      [id, ageMinutes, state, attempts],
    );
  }

  it("finds stuck events (pending, older than 30 min), marks failed, and shows them on /health details", async () => {
    await pool.query("truncate webhook_events");
    await event("stuck-old", 120, "pending", 5);
    await event("stuck-newer", 45, "pending", 2);
    await event("pending-recent", 5, "pending"); // still within its retries
    await event("done-old", 120, "processed");
    await event("failed-old", 120, "failed");

    const stuck = await store.findStuck();
    expect(stuck.map((s) => s.attempts)).toEqual([5, 2]); // oldest first

    const details = await db.healthDetails();
    expect(details.stuckWebhooks).toBe(2);
    expect(details.oldestStuckWebhookAt).toBeInstanceOf(Date);

    await store.markStuckFailed(stuck[0].id);
    const row = await pool.query("select failed_at, last_error from webhook_events where id = $1", [stuck[0].id]);
    expect(row.rows[0].failed_at).not.toBeNull();
    expect(row.rows[0].last_error).toContain("stuck");
    expect((await store.findStuck()).length).toBe(1);
  });

  it("purges only old processed (30d) and old failed (90d) events; never pending", async () => {
    await pool.query("truncate webhook_events");
    const day = 24 * 60;
    await event("processed-31d", 31 * day, "processed");
    await event("processed-29d", 29 * day, "processed");
    await event("failed-91d", 91 * day, "failed");
    await event("failed-60d", 60 * day, "failed");
    await event("pending-120d", 120 * day, "pending");

    expect(await store.purgeOld()).toEqual({ processed: 1, failed: 1 });
    const left = await pool.query<{ webhook_id: string }>("select webhook_id from webhook_events order by webhook_id");
    expect(left.rows.map((r) => r.webhook_id)).toEqual(["failed-60d", "pending-120d", "processed-29d"]);
  });

  it("purges more than one batch", async () => {
    await pool.query("truncate webhook_events");
    await pool.query(
      `insert into webhook_events (webhook_id, topic, shop_domain, received_at, processed_at)
       select 'bulk-' || g, 'products/update', 's', now() - interval '40 days', now()
       from generate_series(1, $1) g`,
      [PURGE_BATCH + 10],
    );
    expect((await store.purgeOld()).processed).toBe(PURGE_BATCH + 10);
  });
});
