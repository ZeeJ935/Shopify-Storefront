// Real Postgres. Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getItemDetail, listLevels, listLocations } from "../src/inventory/query.js";
import { createInventoryStore, levelKey } from "../src/inventory/store.js";
import { fullSync } from "../src/inventory/sync.js";
import type { InventorySource, RemoteInventoryItem, RemoteLocation } from "../src/inventory/types.js";

const url = process.env.DATABASE_URL;

const LOC = "gid://shopify/Location/100";
const LOC2 = "gid://shopify/Location/200";
const ITEM = "gid://shopify/InventoryItem/1000";

function sourceFrom(data: { locations: RemoteLocation[]; items: RemoteInventoryItem[] }): InventorySource {
  return {
    async locationsPage(after) {
      const start = after ? Number(after) : 0;
      const page = data.locations.slice(start, start + 50);
      return { locations: page, endCursor: String(start + 50), hasNextPage: start + 50 < data.locations.length };
    },
    async inventoryItemsPage(after) {
      const start = after ? Number(after) : 0;
      const page = data.items.slice(start, start + 50);
      return { items: page, endCursor: String(start + 50), hasNextPage: start + 50 < data.items.length };
    },
    async location(id) {
      return data.locations.find((l) => l.shopifyId === id) ?? null;
    },
    async inventoryItem(id) {
      return data.items.find((i) => i.shopifyId === id) ?? null;
    },
    async inventoryLevel() {
      return null;
    },
  };
}

/**
 * Runs `competing` in an open transaction on its own connection, starts `call` (which
 * then blocks on the row lock), waits until it is really waiting, and commits.
 */
async function raceAgainstUncommittedInsert<T>(
  pool: pg.Pool,
  admin: pg.Pool,
  dbName: string,
  competing: (client: pg.PoolClient) => Promise<void>,
  call: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await competing(client);
    const pending = call();
    for (let i = 0; ; i++) {
      const { rows } = await admin.query<{ c: number }>(
        "select count(*)::int as c from pg_stat_activity where datname = $1 and wait_event_type = 'Lock'",
        [dbName],
      );
      if (rows[0].c > 0) break;
      if (i > 200) throw new Error("call never blocked on the competing insert");
      await new Promise((r) => setTimeout(r, 10));
    }
    await client.query("commit");
    return await pending;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(!url)("inventory in Postgres", () => {
  const dbName = `inventory_test_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  const store = createInventoryStore(pool);

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  it("keeps history when a location is deleted (SET NULL)", async () => {
    const locId = await store.upsertLocation({
      shopifyId: LOC,
      name: "Warehouse",
      active: true,
      fulfillsOnlineOrders: true,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const itemId = await store.upsertItem({
      shopifyId: ITEM,
      variantId: null,
      productId: null,
      sku: "ABC",
      tracked: true,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await store.upsertLevel({
      itemId,
      locationId: locId,
      itemShopifyId: ITEM,
      locationShopifyId: LOC,
      level: {
        locationShopifyId: LOC,
        available: 5,
        onHand: 5,
        committed: 0,
        incoming: 0,
        shopifyUpdatedAt: "2026-01-01T00:00:00Z",
      },
      source: "sync",
    });
    await store.upsertLevel({
      itemId,
      locationId: locId,
      itemShopifyId: ITEM,
      locationShopifyId: LOC,
      level: {
        locationShopifyId: LOC,
        available: 2,
        onHand: 2,
        committed: 0,
        incoming: 0,
        shopifyUpdatedAt: "2026-01-02T00:00:00Z",
      },
      source: "webhook",
    });

    await store.deleteLocationByShopifyId(LOC);

    const hist = await pool.query<{
      location_id: string | null;
      item_shopify_id: string;
      location_shopify_id: string;
      available_before: number;
      available_after: number;
    }>("select location_id::text, item_shopify_id, location_shopify_id, available_before, available_after from inventory_level_history");
    expect(hist.rows).toHaveLength(1);
    expect(hist.rows[0]).toMatchObject({
      location_id: null,
      item_shopify_id: ITEM,
      location_shopify_id: LOC,
      available_before: 5,
      available_after: 2,
    });

    const levels = await pool.query("select count(*)::int as c from inventory_levels");
    expect(levels.rows[0].c).toBe(0);
  });

  it("race: a concurrent newer level is not overwritten by an older upsert (no history)", async () => {
    const loc = "gid://shopify/Location/900";
    const item = "gid://shopify/InventoryItem/9000";
    const locId = await store.upsertLocation({ shopifyId: loc, name: "Race", active: true, fulfillsOnlineOrders: true, updatedAt: null });
    const itemId = await store.upsertItem({ shopifyId: item, variantId: null, productId: null, sku: "RACE", tracked: true, updatedAt: null });
    const upsertOlder = (available: number, at: string) =>
      store.upsertLevel({
        itemId,
        locationId: locId,
        itemShopifyId: item,
        locationShopifyId: loc,
        level: { locationShopifyId: loc, available, onHand: available, committed: 0, incoming: 0, shopifyUpdatedAt: at },
        source: "sync",
      });

    const result = await raceAgainstUncommittedInsert(
      pool,
      admin,
      dbName,
      async (c) => {
        await c.query(
          `insert into inventory_levels (inventory_item_id, location_id, available, shopify_updated_at)
           values ($1, $2, 7, '2026-03-02T00:00:00Z')`,
          [itemId, locId],
        );
      },
      () => upsertOlder(3, "2026-03-01T00:00:00Z"),
    );
    expect(result).toEqual({ applied: false, availableChanged: false });
    const lvl = await pool.query("select available from inventory_levels where inventory_item_id = $1 and location_id = $2", [itemId, locId]);
    expect(lvl.rows[0].available).toBe(7);
    const hist = await pool.query("select count(*)::int as c from inventory_level_history where item_shopify_id = $1", [item]);
    expect(hist.rows[0].c).toBe(0);
  });

  it("race: a newer level upsert still wins over a concurrent older insert", async () => {
    const loc = "gid://shopify/Location/901";
    const item = "gid://shopify/InventoryItem/9001";
    const locId = await store.upsertLocation({ shopifyId: loc, name: "Race 2", active: true, fulfillsOnlineOrders: true, updatedAt: null });
    const itemId = await store.upsertItem({ shopifyId: item, variantId: null, productId: null, sku: "RACE2", tracked: true, updatedAt: null });

    const result = await raceAgainstUncommittedInsert(
      pool,
      admin,
      dbName,
      async (c) => {
        await c.query(
          `insert into inventory_levels (inventory_item_id, location_id, available, shopify_updated_at)
           values ($1, $2, 7, '2026-03-01T00:00:00Z')`,
          [itemId, locId],
        );
      },
      () =>
        store.upsertLevel({
          itemId,
          locationId: locId,
          itemShopifyId: item,
          locationShopifyId: loc,
          level: { locationShopifyId: loc, available: 4, onHand: 4, committed: 0, incoming: 0, shopifyUpdatedAt: "2026-03-02T00:00:00Z" },
          source: "webhook",
        }),
    );
    expect(result.applied).toBe(true);
    const lvl = await pool.query("select available from inventory_levels where inventory_item_id = $1 and location_id = $2", [itemId, locId]);
    expect(lvl.rows[0].available).toBe(4);
  });

  it("lists locations/levels with filters and keyset cursor", async () => {
    await pool.query("truncate inventory_level_history, inventory_levels, inventory_items, locations, inventory_state restart identity");

    const locations: RemoteLocation[] = [
      { shopifyId: LOC, name: "A", active: true, fulfillsOnlineOrders: true, updatedAt: null },
      { shopifyId: LOC2, name: "B", active: true, fulfillsOnlineOrders: false, updatedAt: null },
    ];
    const items: RemoteInventoryItem[] = [
      {
        shopifyId: ITEM,
        variantId: null,
        productId: null,
        sku: "SKU-A",
        tracked: true,
        updatedAt: null,
        levels: [
          {
            locationShopifyId: LOC,
            available: 1,
            onHand: 1,
            committed: 0,
            incoming: 0,
            shopifyUpdatedAt: "2026-01-01T00:00:00Z",
          },
          {
            locationShopifyId: LOC2,
            available: 8,
            onHand: 8,
            committed: 0,
            incoming: 0,
            shopifyUpdatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
      {
        shopifyId: "gid://shopify/InventoryItem/1001",
        variantId: null,
        productId: null,
        sku: "SKU-B",
        tracked: true,
        updatedAt: null,
        levels: [
          {
            locationShopifyId: LOC,
            available: 20,
            onHand: 20,
            committed: 0,
            incoming: 0,
            shopifyUpdatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
    ];

    await fullSync({ source: sourceFrom({ locations, items }), store });

    const locs = await listLocations(pool);
    expect(locs.locations.map((l) => l.name)).toEqual(["A", "B"]);

    const low = await listLevels(pool, { sku: null, locationId: null, lowStockBelow: 5, cursor: null, limit: 50 });
    expect(low.levels.map((l) => l.sku)).toEqual(["SKU-A"]);

    const page1 = await listLevels(pool, { sku: null, locationId: LOC, lowStockBelow: null, cursor: null, limit: 1 });
    expect(page1.levels).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listLevels(pool, {
      sku: null,
      locationId: LOC,
      lowStockBelow: null,
      cursor: page1.nextCursor,
      limit: 1,
    });
    expect(page2.levels).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([page1.levels[0].inventoryItemId, page2.levels[0].inventoryItemId]).size).toBe(2);

    const detail = await getItemDetail(pool, "1000");
    expect(detail?.sku).toBe("SKU-A");
    expect(detail?.levels).toHaveLength(2);
  });

  it("shouldApply blocks stale sync overwrite in the real store", async () => {
    await pool.query("truncate inventory_level_history, inventory_levels, inventory_items, locations, inventory_state restart identity");
    const itemId = await store.upsertItem({
      shopifyId: ITEM,
      variantId: null,
      productId: null,
      sku: "X",
      tracked: true,
      updatedAt: null,
    });
    const locationId = await store.upsertLocation({
      shopifyId: LOC,
      name: "Main",
      active: true,
      fulfillsOnlineOrders: true,
      updatedAt: null,
    });
    await store.upsertLevel({
      itemId,
      locationId,
      itemShopifyId: ITEM,
      locationShopifyId: LOC,
      level: {
        locationShopifyId: LOC,
        available: 50,
        onHand: 50,
        committed: 0,
        incoming: 0,
        shopifyUpdatedAt: "2026-06-01T12:00:00Z",
      },
      source: "webhook",
    });

    const result = await fullSync({
      source: sourceFrom({
        locations: [{ shopifyId: LOC, name: "Main", active: true, fulfillsOnlineOrders: true, updatedAt: null }],
        items: [
          {
            shopifyId: ITEM,
            variantId: null,
            productId: null,
            sku: "X",
            tracked: true,
            updatedAt: null,
            levels: [
              {
                locationShopifyId: LOC,
                available: 1,
                onHand: 1,
                committed: 0,
                incoming: 0,
                shopifyUpdatedAt: "2026-06-01T10:00:00Z",
              },
            ],
          },
        ],
      }),
      store,
    });
    expect(result.levels).toBe(0);
    const row = await pool.query<{ available: number }>(
      `select available from inventory_levels lvl
       join inventory_items ii on ii.id = lvl.inventory_item_id
       join locations loc on loc.id = lvl.location_id
       where ii.shopify_id = $1 and loc.shopify_id = $2`,
      [ITEM, LOC],
    );
    expect(row.rows[0].available).toBe(50);
    expect(levelKey(ITEM, LOC)).toContain("|");
  });

  it("full sync keeps rows a webhook wrote mid-sync, still deletes stale unseen rows", async () => {
    await pool.query("truncate inventory_level_history, inventory_levels, inventory_items, locations, inventory_state restart identity");
    const STALE = "gid://shopify/InventoryItem/7000";
    const FRESH = "gid://shopify/InventoryItem/7001";
    const level = (available: number) => ({ locationShopifyId: LOC, available, onHand: available, committed: 0, incoming: 0, shopifyUpdatedAt: null });

    // Before the sync: a row Shopify no longer has (never seen by the sync below).
    const locId = await store.upsertLocation({ shopifyId: LOC, name: "Main", active: true, fulfillsOnlineOrders: true, updatedAt: null });
    const staleId = await store.upsertItem({ shopifyId: STALE, variantId: null, productId: null, sku: "OLD", tracked: true, updatedAt: null });
    await store.upsertLevel({ itemId: staleId, locationId: locId, itemShopifyId: STALE, locationShopifyId: LOC, level: level(1), source: "sync" });
    // Make sure "before the sync" is strictly earlier than the sync start.
    await pool.query("update inventory_items set synced_at = now() - interval '1 minute'");
    await pool.query("update inventory_levels set synced_at = now() - interval '1 minute'");

    const items: RemoteInventoryItem[] = Array.from({ length: 51 }, (_, i) => ({
      shopifyId: `gid://shopify/InventoryItem/${8000 + i}`,
      variantId: null,
      productId: null,
      sku: `S${i}`,
      tracked: true,
      updatedAt: null,
      levels: [level(5)],
    }));
    const base = sourceFrom({
      locations: [{ shopifyId: LOC, name: "Main", active: true, fulfillsOnlineOrders: true, updatedAt: null }],
      items,
    });
    const source: InventorySource = {
      ...base,
      async inventoryItemsPage(after) {
        if (after) {
          // Webhook lands while the sync is on page 2 (page 1 already read).
          const freshId = await store.upsertItem({ shopifyId: FRESH, variantId: null, productId: null, sku: "NEW", tracked: true, updatedAt: null });
          await store.upsertLevel({ itemId: freshId, locationId: locId, itemShopifyId: FRESH, locationShopifyId: LOC, level: level(9), source: "webhook" });
        }
        return base.inventoryItemsPage(after);
      },
    };

    const result = await fullSync({ source, store });
    expect(result.deletedItems).toBe(1);
    expect(result.deletedLevels).toBe(1);

    const skus = await pool.query<{ sku: string }>("select sku from inventory_items where sku in ('OLD', 'NEW') order by sku");
    expect(skus.rows.map((r) => r.sku)).toEqual(["NEW"]);
    const fresh = await pool.query(
      "select lvl.available from inventory_levels lvl join inventory_items ii on ii.id = lvl.inventory_item_id where ii.shopify_id = $1",
      [FRESH],
    );
    expect(fresh.rows[0].available).toBe(9);
  });
});
