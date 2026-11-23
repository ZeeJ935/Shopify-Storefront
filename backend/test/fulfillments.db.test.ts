// Real Postgres, in a throwaway database. Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFulfillmentsStore } from "../src/fulfillments/store.js";
import type { RemoteFulfillmentOrder, RemoteOrderFulfillments } from "../src/fulfillments/types.js";
import { getOrderDetail } from "../src/orders/query.js";
import { createOrdersStore } from "../src/orders/store.js";
import type { RemoteOrder } from "../src/orders/types.js";

const url = process.env.DATABASE_URL;
const ORDER = "gid://shopify/Order/6001";
const FO1 = "gid://shopify/FulfillmentOrder/8001";
const FO2 = "gid://shopify/FulfillmentOrder/8002";

function order(updatedAt = "2026-03-01T00:00:00Z"): RemoteOrder {
  return {
    shopifyId: ORDER,
    name: "#6001",
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt,
    processedAt: null,
    cancelledAt: null,
    closedAt: null,
    currency: "USD",
    subtotal: "10.00",
    total: "10.00",
    tax: "0.00",
    discount: "0.00",
    financialStatus: "PAID",
    fulfillmentStatus: "UNFULFILLED",
    cancelReason: null,
    sourceName: "web",
    test: true,
    lines: [],
  };
}

function fo(id: string, lineIds: string[], updatedAt = "2026-03-01T00:00:00Z", status = "OPEN"): RemoteFulfillmentOrder {
  return {
    shopifyId: id,
    status,
    requestStatus: "UNSUBMITTED",
    assignedLocationShopifyId: "gid://shopify/Location/1",
    fulfillAt: null,
    updatedAt,
    lines: lineIds.map((l) => ({
      shopifyId: l,
      orderLineShopifyId: `gid://shopify/LineItem/${l.split("/").pop()}`,
      inventoryItemId: null,
      totalQuantity: 2,
      remainingQuantity: 2,
    })),
  };
}

const remote = (fos: RemoteFulfillmentOrder[], fulfillmentIds: string[] = [], complete = true): RemoteOrderFulfillments => ({
  orderShopifyId: ORDER,
  fulfillmentOrders: fos,
  fulfillments: fulfillmentIds.map((id) => ({
    shopifyId: id,
    status: "SUCCESS",
    trackingCompany: "UPS",
    trackingNumber: "1Z",
    trackingUrl: null,
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
  })),
  fulfillmentsComplete: complete,
});

const L = (n: number) => `gid://shopify/FulfillmentOrderLineItem/${n}`;
const F = (n: number) => `gid://shopify/Fulfillment/${n}`;

describe.skipIf(!url)("fulfillments in Postgres", () => {
  const dbName = `fulfillments_test_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  const store = createFulfillmentsStore(pool);
  const orders = createOrdersStore(pool);
  const count = async (table: string) => (await pool.query(`select count(*)::int as c from ${table}`)).rows[0].c as number;

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  async function reset() {
    await pool.query("truncate orders restart identity cascade");
  }

  it("reports orderMissing when the order is not stored", async () => {
    await reset();
    expect(await store.replaceForOrder(remote([fo(FO1, [L(1)])]), await store.now())).toEqual({ orderMissing: true });
  });

  it("stores, re-runs idempotently, prunes after a full fetch, and shows in order detail", async () => {
    await reset();
    await orders.upsertOrder(order());
    await store.replaceForOrder(remote([fo(FO1, [L(1), L(2)]), fo(FO2, [L(3)])], [F(1)]), await store.now());
    await store.replaceForOrder(remote([fo(FO1, [L(1), L(2)]), fo(FO2, [L(3)])], [F(1)]), await store.now());
    expect([await count("fulfillment_orders"), await count("fulfillment_order_lines"), await count("fulfillments")]).toEqual([2, 3, 1]);

    // FO2 gone, L(2) gone, fulfillment gone in Shopify.
    await store.replaceForOrder(remote([fo(FO1, [L(1)], "2026-03-02T00:00:00Z")], []), await store.now());
    expect([await count("fulfillment_orders"), await count("fulfillment_order_lines"), await count("fulfillments")]).toEqual([1, 1, 0]);

    const detail = await getOrderDetail(pool, ORDER);
    expect(detail?.fulfillmentOrders).toEqual([
      {
        id: FO1,
        status: "OPEN",
        requestStatus: "UNSUBMITTED",
        assignedLocationId: "gid://shopify/Location/1",
        fulfillAt: null,
        updatedAt: "2026-03-02T00:00:00.000Z",
        lines: [{ id: L(1), orderLineId: "gid://shopify/LineItem/1", inventoryItemId: null, totalQuantity: 2, remainingQuantity: 2 }],
      },
    ]);
    expect(detail?.fulfillments).toEqual([]);
  });

  it("does not let an older fetch overwrite or prune newer rows", async () => {
    await reset();
    await orders.upsertOrder(order());
    const olderFetchStartedAt = await store.now();
    // A newer refresh lands first: FO1 at a newer version, plus a new FO2.
    await store.replaceForOrder(remote([fo(FO1, [L(1)], "2026-03-05T00:00:00Z", "CLOSED"), fo(FO2, [L(2)])]), await store.now());
    // The slower, older fetch (started before) commits afterwards without FO2.
    await store.replaceForOrder(remote([fo(FO1, [L(1)], "2026-03-01T00:00:00Z", "OPEN")]), olderFetchStartedAt);

    const rows = await pool.query("select shopify_id, status from fulfillment_orders order by shopify_id");
    expect(rows.rows).toEqual([
      { shopify_id: FO1, status: "CLOSED" },
      { shopify_id: FO2, status: "OPEN" },
    ]);
  });

  it("never prunes fulfillments from a possibly truncated list", async () => {
    await reset();
    await orders.upsertOrder(order());
    await store.replaceForOrder(remote([], [F(1), F(2)]), await store.now());
    await store.replaceForOrder(remote([], [F(2)], false), await store.now());
    expect(await count("fulfillments")).toBe(2);
  });

  it("upsertOrder asks for a fulfillment refresh only when needed; cascades on order delete", async () => {
    await reset();
    expect((await orders.upsertOrder(order())).refreshFulfillments).toBe(true); // new
    expect((await orders.upsertOrder(order())).refreshFulfillments).toBe(true); // never synced
    await store.replaceForOrder(remote([fo(FO1, [L(1)])], [F(1)]), await store.now());
    expect((await orders.upsertOrder(order())).refreshFulfillments).toBe(false); // unchanged
    expect((await orders.upsertOrder(order("2026-03-09T00:00:00Z"))).refreshFulfillments).toBe(true); // changed

    await pool.query("delete from orders where shopify_id = $1", [ORDER]);
    expect([await count("fulfillment_orders"), await count("fulfillment_order_lines"), await count("fulfillments")]).toEqual([0, 0, 0]);
  });
});
