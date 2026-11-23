// Real Postgres, in a throwaway schema migrated from scratch. Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogFilters, CatalogRaw, CatalogSort, ProductListItem } from "../src/catalog-shared/types.js";
import { deriveRow } from "../src/catalog/derive.js";
import { catalogOverview, productsByIds, queryCatalogSql, type CatalogQuery } from "../src/catalog/query.js";
import { createCatalogStore } from "../src/catalog/store.js";
import type { CatalogSource } from "../src/catalog/storefront.js";
import { fullSync } from "../src/catalog/sync.js";

const url = process.env.DATABASE_URL;
const parity = JSON.parse(fs.readFileSync(new URL("./fixtures/catalog-parity.json", import.meta.url), "utf8")) as {
  products: ProductListItem[];
  collections: Record<string, string[]>;
  bestSelling: string[];
  cases: { input: { scope: string | null; sort: CatalogSort; page: number; filters: CatalogFilters }; expected: Omit<CatalogRaw, "products"> & { products: string[] } }[];
};

const query = (input: Partial<CatalogQuery> & Pick<CatalogQuery, "filters" | "sort">): CatalogQuery => ({
  scope: null,
  page: 1,
  limit: 24,
  cursor: null,
  q: null,
  ...input,
});

/** A fake Storefront source serving the fixture catalog, 15 per page. */
function fixtureSource(products: ProductListItem[]): CatalogSource {
  return {
    async product(id) {
      const item = products.find((p) => p.id === id);
      return item ? { item, updatedAt: null, collections: [] } : null;
    },
    async productsPage(after) {
      const start = after ? Number(after) : 0;
      const page = products.slice(start, start + 15);
      return { products: page.map((item) => ({ item, updatedAt: null })), endCursor: String(start + 15), hasNextPage: start + 15 < products.length };
    },
    async bestSellingIds() {
      return parity.bestSelling;
    },
    async collectionIds(handle) {
      return parity.collections[handle] ?? [];
    },
  };
}

describe.skipIf(!url)("catalog in Postgres", () => {
  // A throwaway database per run (migrations target the public schema), dropped afterwards.
  const dbName = `catalog_test_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  const store = createCatalogStore(pool);

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  it("reports an empty catalog before anything is synced", async () => {
    const res = await queryCatalogSql(pool, query({ filters: parity.cases[0].input.filters, sort: "featured" }));
    expect(res.empty).toBe(true);
    expect(res.products).toEqual([]);
  });

  it("backfill twice gives the same rows", async () => {
    const source = fixtureSource(parity.products);
    expect(await fullSync({ source, store })).toEqual({ products: 40, deleted: 0 });
    const first = (await pool.query("select id, catalog_position, best_selling_rank, title_group, data from products order by id")).rows;
    expect(await fullSync({ source, store })).toEqual({ products: 40, deleted: 0 });
    const second = (await pool.query("select id, catalog_position, best_selling_rank, title_group, data from products order by id")).rows;
    expect(second).toEqual(first);
    expect(first).toHaveLength(40);
  });

  it("matches the old in-memory catalog for every parity case", async () => {
    for (const { input, expected } of parity.cases) {
      const res = await queryCatalogSql(pool, query({ ...input }));
      const got = {
        products: res.products.map((p) => p.id),
        total: res.total,
        page: res.page,
        pageCount: res.pageCount,
        hasNextPage: res.hasNextPage,
        priceBounds: res.priceBounds,
        hasBestSelling: res.hasBestSelling,
        facets: res.facets,
        baseDistinct: res.baseDistinct,
      };
      expect(got, JSON.stringify(input)).toEqual(expected);
    }
    // Stored data is exactly the normalized product.
    const one = await queryCatalogSql(pool, query({ filters: parity.cases[0].input.filters, sort: "featured" }));
    expect(one.products[0]).toEqual(parity.products.find((p) => p.id === one.products[0].id));
  });

  it("walks every result with cursors, no gaps or repeats", async () => {
    for (const sort of ["featured", "latest", "price-desc", "name-desc"] as CatalogSort[]) {
      for (const scope of [null, "men"]) {
        const all = await queryCatalogSql(pool, query({ filters: parity.cases[0].input.filters, sort, scope, limit: 100 }));
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const page = await queryCatalogSql(pool, query({ filters: parity.cases[0].input.filters, sort, scope, limit: 7, cursor }));
          seen.push(...page.products.map((p) => p.id));
          cursor = page.nextCursor;
        } while (cursor);
        expect(seen, `${sort} ${scope}`).toEqual(all.products.map((p) => p.id));
      }
    }
  });

  it("rejects a cursor from a different query", async () => {
    const first = await queryCatalogSql(pool, query({ filters: parity.cases[0].input.filters, sort: "latest", limit: 5 }));
    await expect(
      queryCatalogSql(pool, query({ filters: parity.cases[0].input.filters, sort: "price-asc", limit: 5, cursor: first.nextCursor })),
    ).rejects.toThrow(/Cursor/);
  });

  it("upserts, deletes, and returns by-ids in the order asked", async () => {
    const item = { ...parity.products[0], title: "Renamed product" };
    await store.upsert(deriveRow(item, "2026-11-20T00:00:00Z"));
    expect((await productsByIds(pool, [item.id]))[0].title).toBe("Renamed product");

    const ids = [parity.products[5].id, "gid://shopify/Product/404", parity.products[2].id];
    expect((await productsByIds(pool, ids)).map((p) => p.id)).toEqual([parity.products[5].id, parity.products[2].id]);

    await store.remove(parity.products[2].id);
    expect(await productsByIds(pool, [parity.products[2].id])).toEqual([]);
    // Its collection memberships go with it.
    const { rows } = await pool.query("select count(*)::int as n from product_collections where product_id = $1", [parity.products[2].id]);
    expect(rows[0].n).toBe(0);
  });

  it("a full sync removes products Shopify no longer has", async () => {
    const fewer = parity.products.filter((_, i) => i !== 7);
    const result = await fullSync({ source: fixtureSource(fewer), store });
    expect(result.products).toBe(39);
    expect(await store.count()).toBe(39);
    // The product deleted in the previous test came back (Shopify still has it); product 7 is gone.
    expect(await productsByIds(pool, [parity.products[7].id])).toEqual([]);
    expect((await productsByIds(pool, [parity.products[2].id])).length).toBe(1);
  });

  it("overview lists products in catalog order", async () => {
    const overview = await catalogOverview(pool);
    expect(overview.empty).toBe(false);
    expect(overview.products[0].handle).toBe(parity.products[0].handle);
    expect(overview.products).toHaveLength(39);
  });
});
