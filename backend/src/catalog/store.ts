import type pg from "pg";
import { compareTitles } from "../catalog-shared/catalog-rules.js";
import { TRACKED_COLLECTIONS, type ProductRow } from "./derive.js";

type Queryable = Pick<pg.Pool, "query"> | pg.PoolClient;

const COLUMNS = [
  "id", "handle", "title", "vendor", "product_type", "tags", "available", "min_price", "max_price", "currency",
  "created_at", "updated_at", "data", "vendor_key", "type_key", "gender_tags", "gender_keys", "sizes", "size_keys",
  "color", "color_key", "on_sale",
] as const;

const values = (r: ProductRow) => [
  r.id, r.handle, r.title, r.vendor, r.productType, r.tags, r.available, r.minPrice, r.maxPrice, r.currency,
  r.createdAt, r.updatedAt, JSON.stringify(r.data), r.vendorKey, r.typeKey, r.genderTags, r.genderKeys, r.sizes, r.sizeKeys,
  r.color, r.colorKey, r.onSale,
];

/** What catalog sync needs from the database. Tests use the real one against Postgres or a fake. */
export type CatalogStore = {
  /** Inserts or updates one product. New products go to the end of the catalog order unless `position` is given. */
  upsert(row: ProductRow, position?: number): Promise<void>;
  remove(id: string): Promise<void>;
  /** Updates one product's membership in the tracked collections (new memberships go last). */
  setMembership(id: string, handles: string[]): Promise<void>;
  /** Replaces one tracked collection's members, in order (unknown product IDs are skipped). */
  replaceCollection(handle: string, ids: string[]): Promise<void>;
  recomputeTitleGroups(): Promise<void>;
  /**
   * After a complete full sync, in one transaction: catalog order, best-selling
   * ranks, all tracked collections, and deleting products Shopify no longer has.
   */
  finishFullSync(input: { orderedIds: string[]; bestSelling: string[]; collections: Record<string, string[]> }): Promise<{ deleted: number }>;
  count(): Promise<number>;
};

export function createCatalogStore(pool: pg.Pool): CatalogStore {
  const inTx = async <T>(fn: (client: pg.PoolClient) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  const replaceCollectionWith = async (db: Queryable, handle: string, ids: string[]) => {
    await db.query("delete from product_collections where collection_handle = $1", [handle]);
    if (ids.length === 0) return;
    await db.query(
      `insert into product_collections (collection_handle, product_id, position)
       select $1, x.id, x.ord from unnest($2::text[]) with ordinality as x(id, ord)
       where exists (select 1 from products p where p.id = x.id)
       on conflict do nothing`,
      [handle, ids],
    );
  };

  const recomputeTitleGroupsWith = async (db: Queryable) => {
    const { rows } = await db.query<{ id: string; title: string; catalog_position: number }>(
      "select id, title, catalog_position from products",
    );
    rows.sort((a, b) => compareTitles(a.title, b.title) || a.catalog_position - b.catalog_position);
    const ids: string[] = [];
    const groups: number[] = [];
    let group = 0;
    rows.forEach((row, i) => {
      if (i > 0 && compareTitles(rows[i - 1].title, row.title) !== 0) group++;
      ids.push(row.id);
      groups.push(group);
    });
    if (ids.length) {
      await db.query(
        `update products p set title_group = x.g from unnest($1::text[], $2::int[]) as x(id, g) where p.id = x.id and p.title_group is distinct from x.g`,
        [ids, groups],
      );
    }
  };

  return {
    async upsert(row, position) {
      await inTx(async (client) => {
        // A handle can move to a new product (old one deleted): free it first.
        await client.query("delete from products where handle = $1 and id <> $2", [row.handle, row.id]);
        const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
        const updates = COLUMNS.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
        const positionSql =
          position === undefined
            ? "(select coalesce(max(catalog_position), -1) + 1 from products)"
            : `$${COLUMNS.length + 1}::int`;
        await client.query(
          `insert into products (${COLUMNS.join(", ")}, catalog_position, synced_at)
           values (${placeholders}, ${positionSql}, now())
           on conflict (id) do update set ${updates}, synced_at = now()${position === undefined ? "" : ", catalog_position = excluded.catalog_position"}`,
          position === undefined ? values(row) : [...values(row), position],
        );
      });
    },
    async remove(id) {
      await pool.query("delete from products where id = $1", [id]);
    },
    async setMembership(id, handles) {
      const tracked = handles.filter((h) => (TRACKED_COLLECTIONS as readonly string[]).includes(h));
      await inTx(async (client) => {
        await client.query(
          "delete from product_collections where product_id = $1 and not (collection_handle = any($2::text[]))",
          [id, tracked],
        );
        for (const handle of tracked) {
          await client.query(
            `insert into product_collections (collection_handle, product_id, position)
             select $1, $2, coalesce(max(position), 0) + 1 from product_collections where collection_handle = $1
             on conflict do nothing`,
            [handle, id],
          );
        }
      });
    },
    async replaceCollection(handle, ids) {
      await inTx((client) => replaceCollectionWith(client, handle, ids));
    },
    async recomputeTitleGroups() {
      await recomputeTitleGroupsWith(pool);
    },
    async finishFullSync({ orderedIds, bestSelling, collections }) {
      return inTx(async (client) => {
        const deleted = await client.query("delete from products where not (id = any($1::text[]))", [orderedIds]);
        await client.query(
          "update products p set catalog_position = x.ord - 1 from unnest($1::text[]) with ordinality as x(id, ord) where p.id = x.id",
          [orderedIds],
        );
        await client.query("update products set best_selling_rank = null where best_selling_rank is not null");
        await client.query(
          "update products p set best_selling_rank = x.ord - 1 from unnest($1::text[]) with ordinality as x(id, ord) where p.id = x.id",
          [bestSelling],
        );
        for (const handle of TRACKED_COLLECTIONS) await replaceCollectionWith(client, handle, collections[handle] ?? []);
        await recomputeTitleGroupsWith(client);
        await client.query(
          `insert into catalog_state (id, last_full_sync_at, best_selling_count) values (1, now(), $1)
           on conflict (id) do update set last_full_sync_at = now(), best_selling_count = excluded.best_selling_count`,
          [bestSelling.length],
        );
        return { deleted: deleted.rowCount ?? 0 };
      });
    },
    async count() {
      const { rows } = await pool.query<{ n: string }>("select count(*) as n from products");
      return Number(rows[0].n);
    },
  };
}
