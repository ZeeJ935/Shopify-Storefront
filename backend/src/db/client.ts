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
    close: () => pool.end(),
  };
}
