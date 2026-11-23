// Real Postgres. Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getOrderDetail, listOrders } from "../src/orders/query.js";
import { createOrdersStore } from "../src/orders/store.js";
import { fullSync } from "../src/orders/sync.js";
import type { OrdersSource, RemoteOrder } from "../src/orders/types.js";

const url = process.env.DATABASE_URL;

const ORDER = "gid://shopify/Order/2001";
const ORDER2 = "gid://shopify/Order/2002";

function sample(partial: Partial<RemoteOrder> & { shopifyId: string; name: string }): RemoteOrder {
  return {
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z",
    processedAt: "2026-02-01T00:00:00Z",
    cancelledAt: null,
    closedAt: null,
    currency: "USD",
    subtotal: "20.00",
    total: "20.00",
    tax: "0.00",
    discount: "0.00",
    financialStatus: "PAID",
    fulfillmentStatus: "UNFULFILLED",
    cancelReason: null,
    sourceName: "web",
    test: false,
    lines: [
      {
        shopifyId: `gid://shopify/LineItem/${partial.shopifyId.split("/").pop()}-1`,
        variantId: null,
        productId: null,
        inventoryItemId: null,
        sku: "ALPHA",
        title: "Alpha",
        quantity: 1,
        fulfillableQuantity: 1,
        unitPrice: "20.00",
        discountedTotal: "20.00",
      },
    ],
    ...partial,
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

describe.skipIf(!url)("orders in Postgres", () => {
  const dbName = `orders_test_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  const store = createOrdersStore(pool);

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  it("upserts lines in one transaction and prunes only after a complete fetch", async () => {
    const first = sample({
      shopifyId: ORDER,
      name: "#2001",
      lines: [
        {
          shopifyId: "gid://shopify/LineItem/a",
          variantId: null,
          productId: null,
          inventoryItemId: null,
          sku: "A",
          title: "A",
          quantity: 1,
          fulfillableQuantity: 1,
          unitPrice: "1.00",
          discountedTotal: "1.00",
        },
        {
          shopifyId: "gid://shopify/LineItem/b",
          variantId: null,
          productId: null,
          inventoryItemId: null,
          sku: "B",
          title: "B",
          quantity: 1,
          fulfillableQuantity: 1,
          unitPrice: "2.00",
          discountedTotal: "2.00",
        },
      ],
    });
    await store.upsertOrder(first);
    expect((await pool.query("select count(*)::int as c from order_lines")).rows[0].c).toBe(2);

    await store.upsertOrder({
      ...first,
      updatedAt: "2026-02-02T00:00:00Z",
      lines: [first.lines[0]],
    });
    const skus = await pool.query<{ sku: string }>("select sku from order_lines order by sku");
    expect(skus.rows.map((r) => r.sku)).toEqual(["A"]);
  });

  it("race: a concurrent newer insert is not overwritten by an older upsert", async () => {
    const id = "gid://shopify/Order/3001";
    const result = await raceAgainstUncommittedInsert(
      pool,
      admin,
      dbName,
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into orders (shopify_id, name, updated_at) values ($1, 'newer', '2026-03-02T00:00:00Z') returning id`,
          [id],
        );
        await c.query(`insert into order_lines (order_id, shopify_id, title) values ($1, 'gid://shopify/LineItem/newer', 'Newer')`, [
          rows[0].id,
        ]);
      },
      () => store.upsertOrder(sample({ shopifyId: id, name: "older", updatedAt: "2026-03-01T00:00:00Z" })),
    );
    expect(result).toEqual({ applied: false });
    const order = await pool.query("select name from orders where shopify_id = $1", [id]);
    expect(order.rows[0].name).toBe("newer");
    const lines = await pool.query(
      "select ol.shopify_id from order_lines ol join orders o on o.id = ol.order_id where o.shopify_id = $1",
      [id],
    );
    expect(lines.rows.map((r) => r.shopify_id)).toEqual(["gid://shopify/LineItem/newer"]);
  });

  it("race: a newer upsert still wins over a concurrent older insert", async () => {
    const id = "gid://shopify/Order/3002";
    const result = await raceAgainstUncommittedInsert(
      pool,
      admin,
      dbName,
      async (c) => {
        await c.query(`insert into orders (shopify_id, name, updated_at) values ($1, 'older', '2026-03-01T00:00:00Z')`, [id]);
      },
      () => store.upsertOrder(sample({ shopifyId: id, name: "newer", updatedAt: "2026-03-02T00:00:00Z" })),
    );
    expect(result.applied).toBe(true);
    const order = await pool.query("select name from orders where shopify_id = $1", [id]);
    expect(order.rows[0].name).toBe("newer");
  });

  it("lists with filters and keyset cursor", async () => {
    await pool.query("truncate order_lines, orders, orders_state restart identity cascade");
    const orders: RemoteOrder[] = [
      sample({ shopifyId: ORDER, name: "#2001", createdAt: "2026-02-02T00:00:00Z", financialStatus: "PAID" }),
      sample({
        shopifyId: ORDER2,
        name: "#2002",
        createdAt: "2026-02-01T00:00:00Z",
        financialStatus: "PENDING",
        lines: [
          {
            shopifyId: "gid://shopify/LineItem/x",
            variantId: null,
            productId: null,
            inventoryItemId: null,
            sku: "BETA",
            title: "Beta",
            quantity: 1,
            fulfillableQuantity: 1,
            unitPrice: "5.00",
            discountedTotal: "5.00",
          },
        ],
      }),
    ];
    const source: OrdersSource = {
      async ordersPage() {
        return { orders, endCursor: null, hasNextPage: false };
      },
      async order() {
        return null;
      },
    };
    await fullSync({ source, store, updatedSince: "2026-01-01T00:00:00Z" });

    const paid = await listOrders(pool, {
      status: null,
      financialStatus: "PAID",
      fulfillmentStatus: null,
      from: null,
      to: null,
      sku: null,
      cursor: null,
      limit: 50,
    });
    expect(paid.orders.map((o) => o.name)).toEqual(["#2001"]);

    const bySku = await listOrders(pool, {
      status: null,
      financialStatus: null,
      fulfillmentStatus: null,
      from: null,
      to: null,
      sku: "BETA",
      cursor: null,
      limit: 50,
    });
    expect(bySku.orders.map((o) => o.name)).toEqual(["#2002"]);

    const page1 = await listOrders(pool, {
      status: null,
      financialStatus: null,
      fulfillmentStatus: null,
      from: null,
      to: null,
      sku: null,
      cursor: null,
      limit: 1,
    });
    expect(page1.orders).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listOrders(pool, {
      status: null,
      financialStatus: null,
      fulfillmentStatus: null,
      from: null,
      to: null,
      sku: null,
      cursor: page1.nextCursor,
      limit: 1,
    });
    expect(page2.orders).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([page1.orders[0].id, page2.orders[0].id]).size).toBe(2);

    const detail = await getOrderDetail(pool, "2001");
    expect(detail?.name).toBe("#2001");
    expect(detail?.lines).toHaveLength(1);
  });
});
