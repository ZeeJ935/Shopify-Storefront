import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { LINES_PAGE, createAdminOrdersSource, isOrderAccessError } from "../src/orders/admin-source.js";
import { createOrdersHandlers } from "../src/orders/handlers.js";
import type { OrdersStore, UpsertOrderResult } from "../src/orders/store.js";
import { fullSync } from "../src/orders/sync.js";
import type { OrdersSource, RemoteOrder, RemoteOrderLine } from "../src/orders/types.js";
import { createShopifyAdmin } from "../src/shopify-admin/index.js";
import { shouldApply } from "../src/webhooks/ordering.js";
import { payloadForStorage } from "../src/webhooks/payload.js";
import { processWebhookEvent } from "../src/webhooks/process.js";
import { buildWebhookRegistry } from "../src/webhooks/registry.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const ORDER = "gid://shopify/Order/1001";
const LINE = "gid://shopify/LineItem/1";

const PII = {
  email: "secret.customer@example.com",
  phone: "+15551234567",
  name: "Secret Customer Name",
  address: "123 Hidden Street",
};

function money(amount: string, currencyCode = "USD") {
  return { shopMoney: { amount, currencyCode } };
}

function line(partial: Partial<RemoteOrderLine> & { shopifyId: string }): RemoteOrderLine {
  return {
    variantId: null,
    productId: null,
    inventoryItemId: null,
    sku: "SKU-1",
    title: "Shoe",
    quantity: 1,
    fulfillableQuantity: 1,
    unitPrice: "10.00",
    discountedTotal: "10.00",
    ...partial,
  };
}

function order(partial: Partial<RemoteOrder> & { shopifyId: string }): RemoteOrder {
  return {
    name: "#1001",
    createdAt: "2026-01-10T00:00:00Z",
    updatedAt: "2026-01-10T00:00:00Z",
    processedAt: "2026-01-10T00:00:00Z",
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
    test: false,
    lines: [line({ shopifyId: LINE })],
    ...partial,
  };
}

function memoryStore() {
  const orders = new Map<string, RemoteOrder>();
  let finished = false;
  const store: OrdersStore = {
    async countOrders() {
      return orders.size;
    },
    async upsertOrder(remote): Promise<UpsertOrderResult> {
      const existing = orders.get(remote.shopifyId);
      if (existing && !shouldApply(existing.updatedAt, remote.updatedAt)) {
        return { applied: false };
      }
      orders.set(remote.shopifyId, structuredClone(remote));
      return { applied: true };
    },
    async finishFullSync() {
      finished = true;
    },
    async lastFullSyncAt() {
      return finished ? new Date() : null;
    },
  };
  return { store, orders, isFinished: () => finished };
}

function fakeSource(opts: {
  orders?: RemoteOrder[];
  failAfterPages?: number;
  byId?: Map<string, RemoteOrder | null>;
  throwAccess?: boolean;
}): OrdersSource & { pages: number } {
  const list = opts.orders ?? [];
  let pages = 0;
  return {
    get pages() {
      return pages;
    },
    async ordersPage(after) {
      pages++;
      if (pages > (opts.failAfterPages ?? Infinity)) throw new Error("Admin API returned 502");
      const start = after ? Number(after) : 0;
      const slice = list.slice(start, start + 10);
      return { orders: slice, endCursor: String(start + 10), hasNextPage: start + 10 < list.length };
    },
    async order(id) {
      // Mirrors createAdminOrdersSource: access/not-found → null (no throw to the handler).
      if (opts.throwAccess) return null;
      if (opts.byId) return opts.byId.get(id) ?? null;
      return list.find((o) => o.shopifyId === id) ?? null;
    },
  };
}

describe("orders fullSync", () => {
  it("upserts twice to the same rows and never deletes older orders", async () => {
    const { store, orders } = memoryStore();
    orders.set("gid://shopify/Order/old", order({ shopifyId: "gid://shopify/Order/old", name: "#9" }));
    const source = fakeSource({ orders: [order({ shopifyId: ORDER })] });
    expect(await fullSync({ source, store, updatedSince: "2026-01-01T00:00:00Z" })).toEqual({
      orders: 1,
      applied: 1,
    });
    expect(await fullSync({ source, store, updatedSince: "2026-01-01T00:00:00Z" })).toEqual({
      orders: 1,
      applied: 1,
    });
    expect(orders.has("gid://shopify/Order/old")).toBe(true);
    expect(orders.get(ORDER)?.name).toBe("#1001");
  });

  it("does not finish when a page fails mid-read", async () => {
    const m = memoryStore();
    const list = Array.from({ length: 15 }, (_, i) => order({ shopifyId: `gid://shopify/Order/${i}` }));
    await expect(
      fullSync({ source: fakeSource({ orders: list, failAfterPages: 1 }), store: m.store }),
    ).rejects.toThrow("502");
    expect(m.isFinished()).toBe(false);
  });

  it("does not overwrite a newer order with stale sync data", async () => {
    const { store, orders } = memoryStore();
    await store.upsertOrder(order({ shopifyId: ORDER, total: "99.00", updatedAt: "2026-01-10T12:00:00Z" }));
    const source = fakeSource({
      orders: [order({ shopifyId: ORDER, total: "1.00", updatedAt: "2026-01-10T11:00:00Z" })],
    });
    const result = await fullSync({ source, store });
    expect(result.applied).toBe(0);
    expect(orders.get(ORDER)?.total).toBe("99.00");
  });
});

describe("orders webhooks", () => {
  it("re-fetches by id and ignores payload personal fields", async () => {
    const { store, orders } = memoryStore();
    const source = fakeSource({
      byId: new Map([[ORDER, order({ shopifyId: ORDER, total: "42.00" })]]),
    });
    const skips: unknown[] = [];
    const handler = createOrdersHandlers({
      source,
      store,
      logSkip: (line) => skips.push(line),
    });
    await handler.handle({
      topic: "orders/updated",
      payload: {
        id: 1001,
        email: PII.email,
        phone: PII.phone,
        customer: { first_name: PII.name },
        billing_address: { address1: PII.address },
        total_price: "999.00",
      },
      triggeredAt: null,
      apiVersion: null,
    });
    expect(orders.get(ORDER)?.total).toBe("42.00");
    expect(skips).toHaveLength(0);
    expect(JSON.stringify(orders.get(ORDER))).not.toContain(PII.email);
  });

  it("skips null/access errors without throwing (no retry/Sentry)", async () => {
    expect(isOrderAccessError(new Error("Shopify Admin API: ACCESS_DENIED"))).toBe(true);
    const { store } = memoryStore();
    const skips: { topic: string; id: string | number | null; handler: string }[] = [];
    const handler = createOrdersHandlers({
      source: fakeSource({ throwAccess: true }),
      store,
      logSkip: (line) => skips.push(line),
    });
    await expect(
      handler.handle({
        topic: "orders/updated",
        payload: { id: 999 },
        triggeredAt: null,
        apiVersion: null,
      }),
    ).resolves.toBeUndefined();
    expect(skips).toEqual([{ topic: "orders/updated", id: 999, handler: "orders" }]);
  });

  it("stores only { id } for order webhook payloads", () => {
    const stored = payloadForStorage(
      "orders/create",
      {
        id: 555,
        email: PII.email,
        phone: PII.phone,
        customer: { first_name: PII.name },
        shipping_address: { address1: PII.address },
      },
      true,
    );
    expect(stored).toEqual({ id: 555 });
    expect(JSON.stringify(stored)).not.toMatch(/secret|Hidden|@example/i);
  });
});

describe("nested order line pages", () => {
  let fake: { close: () => Promise<void>; origin: string; queries: string[] } | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  function lineNode(i: number) {
    return {
      id: `gid://shopify/LineItem/${i}`,
      title: `Item ${i}`,
      sku: `SKU-${i}`,
      quantity: 1,
      unfulfilledQuantity: 1,
      originalUnitPriceSet: money("1.00"),
      discountedTotalSet: money("1.00"),
      variant: null,
    };
  }

  it("fetches remaining nested line pages when hasNextPage is true", async () => {
    const allLines = Array.from({ length: LINES_PAGE + 4 }, (_, i) => lineNode(i + 1));
    const queries: string[] = [];
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";
      if (url === "/admin/oauth/access_token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "t", scope: "read_orders", expires_in: 3600 }));
        return;
      }
      if (url.includes("/graphql.json")) {
        const body = JSON.parse(raw) as { query: string; variables?: { after?: string | null } };
        queries.push(body.query);
        const throttle = {
          extensions: {
            cost: {
              requestedQueryCost: 1,
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 999, restoreRate: 50 },
            },
          },
        };
        if (body.query.includes("orders(")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                orders: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: ORDER,
                      name: "#1001",
                      createdAt: "2026-01-01T00:00:00Z",
                      updatedAt: "2026-01-01T00:00:00Z",
                      processedAt: "2026-01-01T00:00:00Z",
                      cancelledAt: null,
                      closedAt: null,
                      cancelReason: null,
                      sourceName: "web",
                      test: false,
                      displayFinancialStatus: "PAID",
                      displayFulfillmentStatus: "UNFULFILLED",
                      subtotalPriceSet: money("10.00"),
                      totalPriceSet: money("10.00"),
                      totalTaxSet: money("0.00"),
                      totalDiscountsSet: money("0.00"),
                      lineItems: {
                        pageInfo: { hasNextPage: true, endCursor: "c1" },
                        nodes: allLines.slice(0, LINES_PAGE),
                      },
                      // Deliberate PII the client must ignore (not selected by our query).
                      email: PII.email,
                      customer: { displayName: PII.name },
                      shippingAddress: { address1: PII.address },
                      phone: PII.phone,
                    },
                  ],
                },
              },
              ...throttle,
            }),
          );
          return;
        }
        if (body.query.includes("OrderLines") || body.query.includes("lineItems(first:")) {
          const after = body.variables?.after;
          const start = after === "c1" ? LINES_PAGE : 0;
          const slice = allLines.slice(start, start + LINES_PAGE);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                order: {
                  lineItems: {
                    pageInfo: { hasNextPage: start + LINES_PAGE < allLines.length, endCursor: "c2" },
                    nodes: slice,
                  },
                },
              },
              ...throttle,
            }),
          );
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: {}, ...throttle }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP address");
    fake = {
      origin: `http://127.0.0.1:${addr.port}`,
      queries,
      close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    };

    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: "id",
      clientSecret: "secret",
      origin: fake.origin,
    });
    const source = createAdminOrdersSource(admin);
    const page = await source.ordersPage(null, "2026-01-01T00:00:00.000Z");
    expect(page.orders[0]?.lines).toHaveLength(LINES_PAGE + 4);
    for (const q of queries) {
      expect(q).not.toMatch(/\b(customer|email|phone|address|note)\b/i);
    }
  });

  it("never persists personal data from extra GraphQL fields (sync + webhook)", async () => {
    const logs: string[] = [];
    const queries: string[] = [];
    const orderNode = {
      id: ORDER,
      name: "#1001",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      processedAt: "2026-01-01T00:00:00Z",
      cancelledAt: null,
      closedAt: null,
      cancelReason: null,
      sourceName: "web",
      test: false,
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "UNFULFILLED",
      subtotalPriceSet: money("10.00"),
      totalPriceSet: money("10.00"),
      totalTaxSet: money("0.00"),
      totalDiscountsSet: money("0.00"),
      lineItems: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [lineNode(1)],
      },
      email: PII.email,
      phone: PII.phone,
      customer: { displayName: PII.name, email: PII.email },
      shippingAddress: { address1: PII.address, phone: PII.phone },
      billingAddress: { address1: PII.address },
      note: "private note about customer",
    };

    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";
      if (url === "/admin/oauth/access_token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "t", scope: "read_orders", expires_in: 3600 }));
        return;
      }
      if (url.includes("/graphql.json")) {
        const body = JSON.parse(raw) as { query: string };
        queries.push(body.query);
        const throttle = {
          extensions: {
            cost: {
              requestedQueryCost: 1,
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 999, restoreRate: 50 },
            },
          },
        };
        const data = body.query.includes("orders(")
          ? { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [orderNode] } }
          : { order: orderNode };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data, ...throttle }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP address");
    fake = {
      origin: `http://127.0.0.1:${addr.port}`,
      queries,
      close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    };

    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: "id",
      clientSecret: "secret",
      origin: fake.origin,
    });
    const source = createAdminOrdersSource(admin);
    const { store, orders } = memoryStore();
    await fullSync({ source, store, updatedSince: "2026-01-01T00:00:00.000Z" });

    const w = fakeWebhooks();
    const richPayload = {
      id: 1001,
      email: PII.email,
      phone: PII.phone,
      customer: { first_name: PII.name },
      shipping_address: { address1: PII.address },
      note: "do not store",
    };
    const stripped = payloadForStorage("orders/updated", richPayload, true);
    await w.intake({
      webhookId: "ord-pii",
      topic: "orders/updated",
      shopDomain: "s",
      payload: stripped,
      handled: true,
    });
    expect(w.rows[0].payload).toEqual({ id: 1001 });

    const handler = createOrdersHandlers({
      source,
      store,
      logSkip: (line) => logs.push(JSON.stringify(line)),
    });
    await processWebhookEvent(1, {
      store: w.store,
      router: buildWebhookRegistry({
        revalidate: async () => {},
        orders: handler,
        logPlaceholder: (line) => logs.push(JSON.stringify(line)),
      }),
    });

    const blob = JSON.stringify({ orders: [...orders.values()], webhook: w.rows, logs, queries });
    for (const secret of Object.values(PII)) {
      expect(blob).not.toContain(secret);
    }
    for (const q of queries) {
      expect(q).not.toMatch(/\b(customer|email|phone|address|note)\b/i);
    }
  });
});

describe("orders endpoints", () => {
  const token = "t".repeat(48);
  const app = () =>
    buildApp({
      serviceToken: token,
      customers: fakeCustomers(),
      favourites: fakeFavourites(),
      pingDb: async () => {},
      webhooks: fakeWebhooks().deps,
      orders: { pool: { query: async () => { throw new Error("db should not be called"); } } as never },
    });

  it("need the service token", async () => {
    const a = app();
    for (const url of ["/v1/orders", "/v1/orders/1"]) {
      expect((await a.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
    expect((await a.inject({ method: "POST", url: "/v1/orders/sync" })).statusCode).toBe(401);
    await a.close();
  });

  it("POST /v1/orders/sync is 503 when sync isn't configured", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/v1/orders/sync",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
    await a.close();
  });
});
