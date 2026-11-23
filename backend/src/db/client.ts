import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createFavouritesRepo } from "./favourites.js";
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
    /** For /health: when the last full catalog sync finished, and webhooks that failed in the last 24h. */
    async healthDetails() {
      const { rows } = await pool.query<{ last_sync: Date | null; failed: string }>(
        `select (select last_full_sync_at from catalog_state where id = 1) as last_sync,
                (select count(*) from webhook_events where failed_at > now() - interval '24 hours') as failed`,
      );
      return { lastSyncAt: rows[0]?.last_sync ?? null, failedWebhooks24h: Number(rows[0]?.failed ?? 0) };
    },
    close: () => pool.end(),
  };
}
