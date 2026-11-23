import { describe, expect, it } from "vitest";
import {
  createAdminFulfillmentsSource,
  FO_FIELDS,
  FO_LINE_FIELDS,
  FO_LINES_PAGE,
  FULFILLMENT_FIELDS,
  FULFILLMENTS_LIMIT,
} from "../src/fulfillments/admin-source.js";
import { createFulfillmentHandlers } from "../src/fulfillments/handlers.js";
import type { FulfillmentsStore, ReplaceResult } from "../src/fulfillments/store.js";
import { refreshOrderFulfillments } from "../src/fulfillments/sync.js";
import type { FulfillmentsSource, RemoteOrderFulfillments } from "../src/fulfillments/types.js";
import { createOrdersHandlers } from "../src/orders/handlers.js";
import type { OrdersStore } from "../src/orders/store.js";
import type { OrdersSource, RemoteOrder } from "../src/orders/types.js";
import { ShopifyGraphqlError, type ShopifyAdmin } from "../src/shopify-admin/index.js";
import { fulfillmentOrderIdsFromPayload, payloadForStorage } from "../src/webhooks/payload.js";
import { buildWebhookRegistry } from "../src/webhooks/registry.js";

const ORDER = "gid://shopify/Order/5001";
const FO1 = "gid://shopify/FulfillmentOrder/7001";
const FO2 = "gid://shopify/FulfillmentOrder/7002";
const PII = /destination|deliveryMethod|address|email|phone|customer|firstName|lastName|zip|city/i;

/** Fake ShopifyAdmin that answers by operation name and records every query. */
function fakeAdmin(answer: (op: string, vars: Record<string, unknown>) => unknown) {
  const queries: string[] = [];
  const admin = {
    async request(query: string, vars: Record<string, unknown> = {}) {
      queries.push(query);
      const op = query.match(/query (\w+)/)?.[1] ?? "";
      const result = answer(op, vars);
      if (result instanceof Error) throw result;
      return result;
    },
    checkHealth: async () => ({ ok: true }),
  } as unknown as ShopifyAdmin;
  return { admin, queries };
}

const lineNode = (n: number) => ({
  id: `gid://shopify/FulfillmentOrderLineItem/${n}`,
  totalQuantity: 2,
  remainingQuantity: 1,
  inventoryItemId: `gid://shopify/InventoryItem/${n}`,
  lineItem: { id: `gid://shopify/LineItem/${n}` },
});

const foNode = (id: string, lines: number[], hasNextLines = false) => ({
  id,
  status: "OPEN",
  requestStatus: "UNSUBMITTED",
  fulfillAt: null,
  updatedAt: "2026-03-01T00:00:00Z",
  assignedLocation: { location: { id: "gid://shopify/Location/1" } },
  lineItems: { pageInfo: { hasNextPage: hasNextLines, endCursor: hasNextLines ? "L1" : null }, nodes: lines.map(lineNode) },
});

describe("fulfillments Admin source", () => {
  it("never requests personal data fields", () => {
    for (const fields of [FO_FIELDS, FO_LINE_FIELDS, FULFILLMENT_FIELDS]) expect(fields).not.toMatch(PII);
  });

  it("follows fulfillment-order pages and nested line pages before returning", async () => {
    const { admin, queries } = fakeAdmin((op, vars) => {
      if (op === "OrderFulfillments") {
        return vars.after
          ? { order: { fulfillmentOrders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [foNode(FO2, [3])] } } }
          : {
              order: {
                fulfillmentOrders: { pageInfo: { hasNextPage: true, endCursor: "F1" }, nodes: [foNode(FO1, [1], true)] },
                fulfillments: [
                  {
                    id: "gid://shopify/Fulfillment/1",
                    status: "SUCCESS",
                    createdAt: "2026-03-01T00:00:00Z",
                    updatedAt: "2026-03-01T00:00:00Z",
                    trackingInfo: [{ company: "UPS", number: "1Z", url: "https://ups.example/1Z" }],
                  },
                ],
              },
            };
      }
      if (op === "FoLines") {
        expect(vars).toEqual({ id: FO1, after: "L1" });
        return { fulfillmentOrder: { lineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [lineNode(2)] } } };
      }
      throw new Error(`unexpected ${op}`);
    });

    const result = await createAdminFulfillmentsSource(admin).forOrder(ORDER);
    expect(result?.fulfillmentOrders.map((f) => f.shopifyId)).toEqual([FO1, FO2]);
    expect(result?.fulfillmentOrders[0].lines.map((l) => l.orderLineShopifyId)).toEqual([
      "gid://shopify/LineItem/1",
      "gid://shopify/LineItem/2",
    ]);
    expect(result?.fulfillmentOrders[0].assignedLocationShopifyId).toBe("gid://shopify/Location/1");
    expect(result?.fulfillments).toEqual([
      {
        shopifyId: "gid://shopify/Fulfillment/1",
        status: "SUCCESS",
        trackingCompany: "UPS",
        trackingNumber: "1Z",
        trackingUrl: "https://ups.example/1Z",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
      },
    ]);
    expect(result?.fulfillmentsComplete).toBe(true);
    // Fulfillments only on the first page; no query ever asks for personal data.
    expect(queries.filter((q) => q.includes("fulfillments(first"))).toHaveLength(1);
    for (const q of queries) expect(q).not.toMatch(PII);
    expect(FO_LINES_PAGE).toBeGreaterThan(0);
  });

  it("flags a possibly truncated fulfillments list", async () => {
    const many = Array.from({ length: FULFILLMENTS_LIMIT }, (_, i) => ({ id: `gid://shopify/Fulfillment/${i}`, status: "SUCCESS" }));
    const { admin } = fakeAdmin(() => ({
      order: { fulfillmentOrders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] }, fulfillments: many },
    }));
    expect((await createAdminFulfillmentsSource(admin).forOrder(ORDER))?.fulfillmentsComplete).toBe(false);
  });

  it("returns null for ACCESS_DENIED or a missing order; throws other errors", async () => {
    const denied = fakeAdmin(() => new ShopifyGraphqlError([{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }]));
    expect(await createAdminFulfillmentsSource(denied.admin).forOrder(ORDER)).toBeNull();
    expect(await createAdminFulfillmentsSource(denied.admin).orderIdForFulfillmentOrder(FO1)).toBeNull();
    const missing = fakeAdmin(() => ({ order: null }));
    expect(await createAdminFulfillmentsSource(missing.admin).forOrder(ORDER)).toBeNull();
    const broken = fakeAdmin(() => new Error("Shopify Admin API: Field 'x' not found"));
    await expect(createAdminFulfillmentsSource(broken.admin).forOrder(ORDER)).rejects.toThrow(/not found/);
  });

  it("resolves a fulfillment order's order id", async () => {
    const { admin } = fakeAdmin(() => ({ fulfillmentOrder: { orderId: ORDER } }));
    expect(await createAdminFulfillmentsSource(admin).orderIdForFulfillmentOrder(FO1)).toBe(ORDER);
  });
});

describe("fulfillment webhook payload storage", () => {
  const person = { email: "jane@example.com", phone: "+15550001111", first_name: "Jane", address1: "1 Secret St" };

  it("fulfillments/*: keeps { id, order_id } only", () => {
    const stored = payloadForStorage(
      "fulfillments/update",
      { id: 99, order_id: 5001, destination: person, email: person.email, tracking_number: "1Z" },
      true,
    );
    expect(stored).toEqual({ id: 99, order_id: 5001 });
  });

  it("fulfillment_orders/*: keeps only FulfillmentOrder GIDs from nested shapes", () => {
    const moved = {
      original_fulfillment_order: { id: FO1, status: "CLOSED" },
      moved_fulfillment_order: { id: FO2, status: "OPEN", destination: person },
      source_location: { id: "gid://shopify/Location/1" },
    };
    expect(payloadForStorage("fulfillment_orders/moved", moved, true)).toEqual({ ids: [FO1, FO2] });
    const merged = { fulfillment_order_merges: [{ fulfillment_order: { id: FO2 } }] };
    expect(fulfillmentOrderIdsFromPayload(merged)).toEqual([FO2]);
    expect(JSON.stringify(payloadForStorage("fulfillment_orders/moved", moved, true))).not.toMatch(/jane|Secret|555/);
  });
});

function sampleRemote(fos: string[] = [FO1]): RemoteOrderFulfillments {
  return {
    orderShopifyId: ORDER,
    fulfillmentOrders: fos.map((id) => ({
      shopifyId: id,
      status: "OPEN",
      requestStatus: null,
      assignedLocationShopifyId: null,
      fulfillAt: null,
      updatedAt: null,
      lines: [],
    })),
    fulfillments: [],
    fulfillmentsComplete: true,
  };
}

function fakeFulfillments(opts: { orderInDbAfterEnsure?: boolean; foOrder?: Record<string, string | null> } = {}) {
  const refreshed: string[] = [];
  let orderInDb = false;
  const source: FulfillmentsSource = {
    async forOrder(id) {
      return id === ORDER ? sampleRemote() : null;
    },
    async orderIdForFulfillmentOrder(id) {
      return opts.foOrder?.[id] ?? null;
    },
  };
  const store: FulfillmentsStore = {
    now: async () => new Date(),
    async replaceForOrder(data): Promise<ReplaceResult> {
      if (!orderInDb) return { orderMissing: true };
      refreshed.push(data.orderShopifyId);
      return { orderMissing: false, fulfillmentOrders: 1, fulfillments: 0, deletedFulfillmentOrders: 0, deletedFulfillments: 0 };
    },
  };
  const ensureOrder = async () => {
    orderInDb = opts.orderInDbAfterEnsure ?? true;
    return orderInDb;
  };
  return { source, store, ensureOrder, refreshed, setOrderInDb: (v: boolean) => (orderInDb = v) };
}

describe("refreshOrderFulfillments", () => {
  it("stores the order first when it is not in Postgres yet", async () => {
    const f = fakeFulfillments();
    expect(await refreshOrderFulfillments({ source: f.source, store: f.store, ensureOrder: f.ensureOrder }, ORDER)).toBe("refreshed");
    expect(f.refreshed).toEqual([ORDER]);
  });

  it("skips orders Shopify will not return", async () => {
    const f = fakeFulfillments();
    expect(await refreshOrderFulfillments(f, "gid://shopify/Order/404")).toBe("order_not_accessible");
    expect(f.refreshed).toEqual([]);
  });
});

describe("fulfillment webhook handlers", () => {
  it("fulfillment_orders/*: resolves the order from the first accessible fulfillment order", async () => {
    const f = fakeFulfillments({ foOrder: { [FO1]: null, [FO2]: ORDER } });
    f.setOrderInDb(true);
    const skips: unknown[] = [];
    const h = createFulfillmentHandlers({ ...f, logSkip: (l) => skips.push(l) });
    await h.fulfillmentOrder.handle({ topic: "fulfillment_orders/moved", payload: { ids: [FO1, FO2] } });
    expect(f.refreshed).toEqual([ORDER]);
    expect(skips).toEqual([]);
  });

  it("fulfillments/*: refreshes by order_id; logs a skip without one", async () => {
    const f = fakeFulfillments();
    f.setOrderInDb(true);
    const skips: { reason: string }[] = [];
    const h = createFulfillmentHandlers({ ...f, logSkip: (l) => skips.push(l) });
    await h.fulfillment.handle({ topic: "fulfillments/create", payload: { id: 1, order_id: 5001 } });
    expect(f.refreshed).toEqual([ORDER]);
    await h.fulfillment.handle({ topic: "fulfillments/create", payload: { id: 1 } });
    expect(skips.map((s) => s.reason)).toEqual(["no_order_id"]);
  });

  it("registry routes fulfillment topics to the real handlers, not placeholders", () => {
    const f = fakeFulfillments();
    const handlers = createFulfillmentHandlers(f);
    const router = buildWebhookRegistry({ revalidate: async () => {}, fulfillments: handlers });
    for (const topic of ["fulfillments/create", "fulfillments/update", "fulfillment_orders/split", "fulfillment_orders/moved"]) {
      expect(router.handlersFor(topic).map((h) => h.name)).toEqual(["fulfillments"]);
    }
    const without = buildWebhookRegistry({ revalidate: async () => {} });
    expect(without.handlersFor("fulfillments/create").map((h) => h.name)).toEqual(["placeholder"]);
  });
});

describe("orders → fulfillment refresh", () => {
  it("calls onOrderChanged only when the upsert asks for a refresh", async () => {
    const remote = { shopifyId: ORDER } as RemoteOrder;
    const source = { order: async () => remote } as unknown as OrdersSource;
    let refresh = true;
    const store = { upsertOrder: async () => ({ applied: true, refreshFulfillments: refresh }) } as unknown as OrdersStore;
    const changed: string[] = [];
    const handler = createOrdersHandlers({ source, store, onOrderChanged: async (id) => changed.push(id) });
    await handler.handle({ topic: "orders/updated", payload: { id: 5001 } });
    refresh = false;
    await handler.handle({ topic: "orders/updated", payload: { id: 5001 } });
    expect(changed).toEqual([ORDER]);
  });
});
