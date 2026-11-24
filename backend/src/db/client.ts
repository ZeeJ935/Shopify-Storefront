import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { STUCK_AFTER_MINUTES } from "../webhooks/maintenance.js";
import { createFavouritesRepo } from "./favourites.js";
import { queueHealth } from "./queue-health.js";
import { customers } from "./schema.js";

export type CustomerRecord = { customerId: string; firstSeenAt: Date };

/** What the routes need from the database. Tests pass a fake. */
export type CustomersRepo = {
  /** Creates the customer on first sight, otherwise updates last_seen_at. */
  touch(customerId: string): Promise<CustomerRecord>;
};

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool);

  const customersRepo: CustomersRepo = {
    async touch(customerId) {
      const [row] = await db
        .insert(customers)
        .values({ customerId })
        .onConflictDoUpdate({ target: customers.customerId, set: { lastSeenAt: sql`now()` } })
        .returning({ customerId: customers.customerId, firstSeenAt: customers.firstSeenAt });
      return row;
    },
  };

  return {
    pool,
    db,
    customers: customersRepo,
    favourites: createFavouritesRepo(db),
    async ping() {
      await pool.query("select 1");
    },
    /** For /health: last sync times, webhooks failed in the last 24h, and stuck webhooks. */
    async healthDetails() {
      const { rows } = await pool.query<{
        last_sync: Date | null;
        inventory_last_sync: Date | null;
        orders_last_sync: Date | null;
        failed: string;
        stuck: string;
        oldest_stuck: Date | null;
        reconcile_at: Date | null;
        differences: number | null;
      }>(
        `select (select last_full_sync_at from catalog_state where id = 1) as last_sync,
                (select last_full_sync_at from inventory_state where id = 1) as inventory_last_sync,
                (select last_full_sync_at from orders_state where id = 1) as orders_last_sync,
                (select count(*) from webhook_events where failed_at > now() - interval '24 hours') as failed,
                stuck.count as stuck, stuck.oldest as oldest_stuck,
                (select last_reconcile_at from warehouse_state where id = 1) as reconcile_at,
                (select differences from warehouse_state where id = 1) as differences
         from (select count(*) as count, min(received_at) as oldest from webhook_events
               where processed_at is null and failed_at is null
                 and received_at < now() - make_interval(mins => $1)) stuck`,
        [STUCK_AFTER_MINUTES],
      );
      return {
        lastSyncAt: rows[0]?.last_sync ?? null,
        inventoryLastSyncAt: rows[0]?.inventory_last_sync ?? null,
        ordersLastSyncAt: rows[0]?.orders_last_sync ?? null,
        failedWebhooks24h: Number(rows[0]?.failed ?? 0),
        stuckWebhooks: Number(rows[0]?.stuck ?? 0),
        oldestStuckWebhookAt: rows[0]?.oldest_stuck ?? null,
        queues: await queueHealth(pool),
        warehouseLastReconcileAt: rows[0]?.reconcile_at ?? null,
        warehouseDifferences: rows[0]?.differences ?? null,
      };
    },
    close: () => pool.end(),
  };
}
