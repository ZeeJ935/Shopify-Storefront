import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { customers, favourites } from "./schema.js";

export const MAX_FAVOURITES = 200;

export type FavouritesList = { ids: string[]; imported: boolean };

/** What the routes need. Tests pass an in-memory fake with the same rules. */
export type FavouritesRepo = {
  list(customerId: string): Promise<FavouritesList>;
  /** Replaces the whole list (already de-duplicated, at most MAX_FAVOURITES). Marks the customer imported. */
  replace(customerId: string, ids: string[]): Promise<string[]>;
  /** One-time import. A second call changes nothing and returns imported: false. */
  importOnce(customerId: string, ids: string[]): Promise<FavouritesList>;
};

type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

/** Creates the customer row if needed and locks it for the rest of the transaction. */
async function lockCustomer(tx: Tx, customerId: string) {
  await tx
    .insert(customers)
    .values({ customerId })
    .onConflictDoUpdate({ target: customers.customerId, set: { lastSeenAt: sql`now()` } });
  const [row] = await tx
    .select({ importedAt: customers.favouritesImportedAt })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .for("update");
  return row;
}

async function readIds(tx: Tx | NodePgDatabase, customerId: string) {
  const rows = await tx
    .select({ productId: favourites.productId })
    .from(favourites)
    .where(eq(favourites.customerId, customerId))
    .orderBy(asc(favourites.createdAt), asc(favourites.id));
  return rows.map((r) => r.productId);
}

/** Inserts in list order; existing rows keep their place. clock_timestamp() rises per row, keeping the order. */
async function insertInOrder(tx: Tx, customerId: string, ids: string[]) {
  if (ids.length === 0) return;
  await tx
    .insert(favourites)
    .values(ids.map((productId) => ({ customerId, productId, createdAt: sql`clock_timestamp()` })))
    .onConflictDoNothing({ target: [favourites.customerId, favourites.productId] });
}

async function markImported(tx: Tx, customerId: string) {
  await tx
    .update(customers)
    .set({ favouritesImportedAt: sql`now()` })
    .where(and(eq(customers.customerId, customerId), isNull(customers.favouritesImportedAt)));
}

export function createFavouritesRepo(db: NodePgDatabase): FavouritesRepo {
  return {
    async list(customerId) {
      const [customer] = await db
        .select({ importedAt: customers.favouritesImportedAt })
        .from(customers)
        .where(eq(customers.customerId, customerId));
      return { ids: await readIds(db, customerId), imported: Boolean(customer?.importedAt) };
    },

    replace(customerId, ids) {
      return db.transaction(async (tx) => {
        await lockCustomer(tx, customerId);
        const removeWhere =
          ids.length > 0
            ? and(eq(favourites.customerId, customerId), notInArray(favourites.productId, ids))
            : eq(favourites.customerId, customerId);
        await tx.delete(favourites).where(removeWhere);
        await insertInOrder(tx, customerId, ids);
        await markImported(tx, customerId);
        return readIds(tx, customerId);
      });
    },

    importOnce(customerId, ids) {
      return db.transaction(async (tx) => {
        const customer = await lockCustomer(tx, customerId);
        if (customer?.importedAt) {
          return { ids: await readIds(tx, customerId), imported: false };
        }
        await insertInOrder(tx, customerId, ids);
        await markImported(tx, customerId);
        return { ids: await readIds(tx, customerId), imported: true };
      });
    },
  };
}
