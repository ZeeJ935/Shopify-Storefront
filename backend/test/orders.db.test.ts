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

  it("lists with filters and keyset cursor", async () => {
    await pool.query("truncate order_lines, orders, orders_state restart identity");
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
