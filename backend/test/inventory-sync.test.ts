import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { LEVELS_PAGE, createAdminInventorySource } from "../src/inventory/admin-source.js";
import { createInventoryHandlers } from "../src/inventory/handlers.js";
import { levelKey, type InventoryStore, type UpsertLevelResult } from "../src/inventory/store.js";
import { fullSync } from "../src/inventory/sync.js";
import type { InventorySource, RemoteInventoryItem, RemoteLevel, RemoteLocation } from "../src/inventory/types.js";
import { createShopifyAdmin } from "../src/shopify-admin/index.js";
import { shouldApply } from "../src/webhooks/ordering.js";
import { buildWebhookRegistry } from "../src/webhooks/registry.js";
import { processWebhookEvent } from "../src/webhooks/process.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const LOC = "gid://shopify/Location/1";
const ITEM = "gid://shopify/InventoryItem/10";

function level(
  locationShopifyId: string,
  available: number,
  shopifyUpdatedAt: string | null,
  extras: Partial<RemoteLevel> = {},
): RemoteLevel {
  return {
    locationShopifyId,
    available,
    onHand: available,
    committed: 0,
    incoming: 0,
    shopifyUpdatedAt,
    ...extras,
  };
}

function memoryStore() {
  let nextId = 1;
  const locations = new Map<string, { id: number; name: string }>();
  const items = new Map<string, { id: number; sku: string | null; tracked: boolean }>();
  const levels = new Map<string, { available: number; shopifyUpdatedAt: string | null; onHand: number; committed: number; incoming: number }>();
  const history: { item: string; location: string; before: number; after: number; source: string }[] = [];
  let finished: { locationIds: Set<string>; itemIds: Set<string>; levelKeys: Set<string> } | null = null;
  let lastFullSyncAt: Date | null = null;

  const store: InventoryStore = {
    async countLocations() {
      return locations.size;
    },
    async upsertLocation(loc) {
      const existing = locations.get(loc.shopifyId);
      if (existing) {
        existing.name = loc.name;
        return existing.id;
      }
      const id = nextId++;
      locations.set(loc.shopifyId, { id, name: loc.name });
      return id;
    },
    async ensureLocationId(shopifyId) {
      const existing = locations.get(shopifyId);
      if (existing) return existing.id;
      const id = nextId++;
      locations.set(shopifyId, { id, name: shopifyId });
      return id;
    },
    async ensureItemId(shopifyId) {
      const existing = items.get(shopifyId);
      if (existing) return existing.id;
      const id = nextId++;
      items.set(shopifyId, { id, sku: null, tracked: true });
      return id;
    },
    async upsertItem(item) {
      const existing = items.get(item.shopifyId);
      if (existing) {
        existing.sku = item.sku;
        existing.tracked = item.tracked;
        return existing.id;
      }
      const id = nextId++;
      items.set(item.shopifyId, { id, sku: item.sku, tracked: item.tracked });
      return id;
    },
    async upsertLevel({ itemShopifyId, locationShopifyId, level: remote, source }): Promise<UpsertLevelResult> {
      const key = levelKey(itemShopifyId, locationShopifyId);
      const row = levels.get(key);
      if (row && !shouldApply(row.shopifyUpdatedAt, remote.shopifyUpdatedAt)) {
        return { applied: false, availableChanged: false };
      }
      const before = row?.available ?? remote.available;
      const availableChanged = Boolean(row) && before !== remote.available;
      if (availableChanged) {
        history.push({ item: itemShopifyId, location: locationShopifyId, before, after: remote.available, source });
      }
      levels.set(key, {
        available: remote.available,
        shopifyUpdatedAt: remote.shopifyUpdatedAt,
        onHand: remote.onHand,
        committed: remote.committed,
        incoming: remote.incoming,
      });
      return { applied: true, availableChanged };
    },
    async deleteLocationByShopifyId(shopifyId) {
      locations.delete(shopifyId);
      for (const key of [...levels.keys()]) {
        if (key.endsWith(`|${shopifyId}`)) levels.delete(key);
      }
    },
    async finishFullSync(seen) {
      finished = seen;
      let deletedLevels = 0;
      let deletedItems = 0;
      let deletedLocations = 0;
      for (const key of [...levels.keys()]) {
        if (!seen.levelKeys.has(key)) {
          levels.delete(key);
          deletedLevels++;
        }
      }
      for (const id of [...items.keys()]) {
        if (!seen.itemIds.has(id)) {
          items.delete(id);
          deletedItems++;
        }
      }
      for (const id of [...locations.keys()]) {
        if (!seen.locationIds.has(id)) {
          locations.delete(id);
          deletedLocations++;
        }
      }
      lastFullSyncAt = new Date();
      return { deletedLocations, deletedItems, deletedLevels };
    },
    async lastFullSyncAt() {
      return lastFullSyncAt;
    },
  };

  return {
    store,
    locations,
    items,
    levels,
    history,
    getFinished: () => finished,
  };
}

function fakeSource(opts: {
  locations?: RemoteLocation[];
  items?: RemoteInventoryItem[];
  failAfterItemPages?: number;
  levelByPair?: Map<string, RemoteLevel & { itemShopifyId: string }>;
}): InventorySource & { fetchedLevels: string[]; fetchedItems: string[] } {
  const locations = opts.locations ?? [];
  const items = opts.items ?? [];
  const fetchedLevels: string[] = [];
  const fetchedItems: string[] = [];
  let itemPages = 0;
  return {
    fetchedLevels,
    fetchedItems,
    async locationsPage(after) {
      const start = after ? Number(after) : 0;
      const page = locations.slice(start, start + 10);
      return { locations: page, endCursor: String(start + 10), hasNextPage: start + 10 < locations.length };
    },
    async inventoryItemsPage(after) {
      const start = after ? Number(after) : 0;
      itemPages++;
      if (itemPages > (opts.failAfterItemPages ?? Infinity)) throw new Error("Admin API returned 502");
      const page = items.slice(start, start + 10);
      return { items: page, endCursor: String(start + 10), hasNextPage: start + 10 < items.length };
    },
    async location(id) {
      return locations.find((l) => l.shopifyId === id) ?? null;
    },
    async inventoryItem(id) {
      fetchedItems.push(id);
      return items.find((i) => i.shopifyId === id) ?? null;
    },
    async inventoryLevel(itemId, locationId) {
      fetchedLevels.push(`${itemId}|${locationId}`);
      return opts.levelByPair?.get(`${itemId}|${locationId}`) ?? null;
    },
  };
}

describe("inventory fullSync", () => {
  it("upserts twice to the same rows and deletes missing after a complete read", async () => {
    const loc: RemoteLocation = {
      shopifyId: LOC,
      name: "Main",
      active: true,
      fulfillsOnlineOrders: true,
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const item: RemoteInventoryItem = {
      shopifyId: ITEM,
      variantId: "gid://shopify/ProductVariant/1",
      productId: "gid://shopify/Product/1",
      sku: "SKU-1",
      tracked: true,
      updatedAt: "2026-01-01T00:00:00Z",
      levels: [level(LOC, 5, "2026-01-01T00:00:00Z")],
    };
    const { store, levels, locations, items } = memoryStore();
    locations.set("gid://shopify/Location/gone", { id: 99, name: "gone" });
    items.set("gid://shopify/InventoryItem/gone", { id: 98, sku: null, tracked: true });
    levels.set(levelKey("gid://shopify/InventoryItem/gone", "gid://shopify/Location/gone"), {
      available: 1,
      shopifyUpdatedAt: null,
      onHand: 1,
      committed: 0,
      incoming: 0,
    });

    const source = fakeSource({ locations: [loc], items: [item] });
    expect(await fullSync({ source, store })).toMatchObject({ locations: 1, items: 1, levels: 1, deletedLocations: 1, deletedItems: 1 });
    expect(await fullSync({ source, store })).toMatchObject({ locations: 1, items: 1, levels: 1, deletedLocations: 0, deletedItems: 0 });
    expect(levels.get(levelKey(ITEM, LOC))?.available).toBe(5);
    expect(locations.has("gid://shopify/Location/gone")).toBe(false);
  });

  it("does not delete when a page fails mid-read", async () => {
    const m = memoryStore();
    m.levels.set(levelKey(ITEM, LOC), { available: 9, shopifyUpdatedAt: "2026-01-02T00:00:00Z", onHand: 9, committed: 0, incoming: 0 });
    const items: RemoteInventoryItem[] = Array.from({ length: 15 }, (_, i) => ({
      shopifyId: `gid://shopify/InventoryItem/${i}`,
      variantId: null,
      productId: null,
      sku: null,
      tracked: true,
      updatedAt: null,
      levels: [],
    }));
    await expect(
      fullSync({ source: fakeSource({ locations: [], items, failAfterItemPages: 1 }), store: m.store }),
    ).rejects.toThrow("502");
    expect(m.getFinished()).toBeNull();
    expect(m.levels.get(levelKey(ITEM, LOC))?.available).toBe(9);
  });

  it("does not overwrite a newer webhook update with stale sync data (shouldApply race)", async () => {
    const { store, levels } = memoryStore();
    await store.ensureLocationId(LOC);
    await store.ensureItemId(ITEM);
    await store.upsertLevel({
      itemId: 1,
      locationId: 1,
      itemShopifyId: ITEM,
      locationShopifyId: LOC,
      level: level(LOC, 100, "2026-01-10T12:00:00Z"),
      source: "webhook",
    });

    const source = fakeSource({
      locations: [{ shopifyId: LOC, name: "Main", active: true, fulfillsOnlineOrders: true, updatedAt: null }],
      items: [
        {
          shopifyId: ITEM,
          variantId: null,
          productId: null,
          sku: "SKU-1",
          tracked: true,
          updatedAt: null,
          levels: [level(LOC, 1, "2026-01-10T11:00:00Z")],
        },
      ],
    });
    const result = await fullSync({ source, store });
    expect(result.levels).toBe(0);
    expect(levels.get(levelKey(ITEM, LOC))).toMatchObject({ available: 100, shopifyUpdatedAt: "2026-01-10T12:00:00Z" });
  });
});

describe("inventory webhooks", () => {
  it("inventory_levels/update re-fetches and ignores payload quantities", async () => {
    const { store, levels } = memoryStore();
    const remote = { ...level(LOC, 42, "2026-01-05T00:00:00Z"), itemShopifyId: ITEM };
    const source = fakeSource({
      levelByPair: new Map([[`${ITEM}|${LOC}`, remote]]),
    });
    const handlers = createInventoryHandlers({ source, store });
    await handlers.levelsUpdate.handle({
      topic: "inventory_levels/update",
      payload: { inventory_item_id: 10, location_id: 1, available: 999 },
      triggeredAt: null,
      apiVersion: null,
    });
    expect(source.fetchedLevels).toEqual([`${ITEM}|${LOC}`]);
    expect(levels.get(levelKey(ITEM, LOC))?.available).toBe(42);
  });

  it("skips an older webhook update via shouldApply", async () => {
    const { store, levels, history } = memoryStore();
    await store.upsertLevel({
      itemId: await store.ensureItemId(ITEM),
      locationId: await store.ensureLocationId(LOC),
      itemShopifyId: ITEM,
      locationShopifyId: LOC,
      level: level(LOC, 10, "2026-01-05T12:00:00Z"),
      source: "sync",
    });
    const source = fakeSource({
      levelByPair: new Map([[`${ITEM}|${LOC}`, { ...level(LOC, 1, "2026-01-05T11:00:00Z"), itemShopifyId: ITEM }]]),
    });
    const handlers = createInventoryHandlers({ source, store });
    await handlers.levelsUpdate.handle({
      topic: "inventory_levels/update",
      payload: { inventory_item_id: 10, location_id: 1 },
      triggeredAt: null,
      apiVersion: null,
    });
    expect(levels.get(levelKey(ITEM, LOC))?.available).toBe(10);
    expect(history).toHaveLength(0);
  });

  it("writes history only when available changes", async () => {
    const { store, history } = memoryStore();
    const itemId = await store.ensureItemId(ITEM);
    const locationId = await store.ensureLocationId(LOC);
    await store.upsertLevel({
      itemId,
      locationId,
      itemShopifyId: ITEM,
      locationShopifyId: LOC,
      level: level(LOC, 3, "2026-01-01T00:00:00Z"),
      source: "sync",
    });
    await store.upsertLevel({
      itemId,
      locationId,
      itemShopifyId: ITEM,
      locationShopifyId: LOC,
      level: level(LOC, 3, "2026-01-02T00:00:00Z"),
      source: "webhook",
    });
    expect(history).toHaveLength(0);
    await store.upsertLevel({
      itemId,
      locationId,
      itemShopifyId: ITEM,
      locationShopifyId: LOC,
      level: level(LOC, 7, "2026-01-03T00:00:00Z"),
      source: "webhook",
    });
    expect(history).toEqual([{ item: ITEM, location: LOC, before: 3, after: 7, source: "webhook" }]);
  });

  it("runs inventory between catalog and revalidate on inventory_levels/update", async () => {
    const order: string[] = [];
    const w = fakeWebhooks();
    await w.intake({
      webhookId: "inv-1",
      topic: "inventory_levels/update",
      shopDomain: "s",
      payload: { inventory_item_id: 10, location_id: 1 },
      handled: true,
    });
    const { store } = memoryStore();
    const source = fakeSource({
      levelByPair: new Map([[`${ITEM}|${LOC}`, { ...level(LOC, 1, "2026-01-01T00:00:00Z"), itemShopifyId: ITEM }]]),
    });
    const handlers = createInventoryHandlers({ source, store });
    await expect(
      processWebhookEvent(1, {
        store: w.store,
        router: buildWebhookRegistry({
          catalog: async () => void order.push("catalog"),
          inventory: {
            ...handlers,
            levelsUpdate: {
              name: "inventory",
              async handle(event) {
                order.push("inventory");
                await handlers.levelsUpdate.handle(event);
              },
            },
          },
          revalidate: async () => void order.push("revalidate"),
        }),
      }),
    ).resolves.toBe("processed");
    expect(order).toEqual(["catalog", "inventory", "revalidate"]);
  });
});

describe("nested inventoryLevels pages", () => {
  let fake: { close: () => Promise<void>; origin: string } | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  it("fetches remaining nested level pages when hasNextPage is true", async () => {
    const locIds = Array.from({ length: LEVELS_PAGE + 5 }, (_, i) => `gid://shopify/Location/${i + 1}`);
    const allLevels = locIds.map((id, i) => ({
      updatedAt: "2026-01-01T00:00:00Z",
      location: { id },
      quantities: [
        { name: "available", quantity: i + 1 },
        { name: "on_hand", quantity: i + 1 },
        { name: "committed", quantity: 0 },
        { name: "incoming", quantity: 0 },
      ],
    }));

    let graphqlN = 0;
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";
      if (url === "/admin/oauth/access_token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "t", scope: "read_inventory", expires_in: 3600 }));
        return;
      }
      if (url.includes("/graphql.json")) {
        graphqlN++;
        const body = JSON.parse(raw) as { query: string; variables?: { after?: string | null } };
        const throttle = {
          extensions: {
            cost: { requestedQueryCost: 1, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 999, restoreRate: 50 } },
          },
        };
        if (body.query.includes("inventoryItems(")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                inventoryItems: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: ITEM,
                      sku: "SKU",
                      tracked: true,
                      updatedAt: null,
                      variant: null,
                      inventoryLevels: {
                        pageInfo: { hasNextPage: true, endCursor: "c1" },
                        nodes: allLevels.slice(0, LEVELS_PAGE),
                      },
                    },
                  ],
                },
              },
              ...throttle,
            }),
          );
          return;
        }
        if (body.query.includes("ItemLevels") || body.query.includes("inventoryLevels(first:")) {
          const after = body.variables?.after;
          const start = after === "c1" ? LEVELS_PAGE : 0;
          const slice = allLevels.slice(start, start + LEVELS_PAGE);
          const hasNext = start + LEVELS_PAGE < allLevels.length;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                inventoryItem: {
                  inventoryLevels: {
                    pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? "c2" : null },
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
      close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    };

    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: "id",
      clientSecret: "secret",
      origin: fake.origin,
    });
    const source = createAdminInventorySource(admin);
    const page = await source.inventoryItemsPage(null);
    expect(page.items[0]?.levels).toHaveLength(LEVELS_PAGE + 5);
    expect(graphqlN).toBeGreaterThanOrEqual(2);
  });
});

describe("inventory endpoints", () => {
  const token = "t".repeat(48);
  const app = () =>
    buildApp({
      serviceToken: token,
      customers: fakeCustomers(),
      favourites: fakeFavourites(),
      pingDb: async () => {},
      webhooks: fakeWebhooks().deps,
      inventory: { pool: { query: async () => { throw new Error("db should not be called"); } } as never },
    });

  it("need the service token", async () => {
    const a = app();
    for (const url of ["/v1/inventory/locations", "/v1/inventory/levels", "/v1/inventory/items/1"]) {
      expect((await a.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
    expect((await a.inject({ method: "POST", url: "/v1/inventory/sync" })).statusCode).toBe(401);
    await a.close();
  });

  it("POST /v1/inventory/sync is 503 when sync isn't configured", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/v1/inventory/sync",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
    await a.close();
  });
});
