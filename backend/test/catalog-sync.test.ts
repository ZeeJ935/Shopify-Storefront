import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ProductListItem } from "../src/catalog-shared/types.js";
import { createCatalogHandler } from "../src/catalog/handlers.js";
import type { CatalogStore } from "../src/catalog/store.js";
import type { CatalogSource } from "../src/catalog/storefront.js";
import { fullSync, productIdFromPayload } from "../src/catalog/sync.js";
import { processWebhookEvent } from "../src/webhooks/process.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const parity = JSON.parse(fs.readFileSync(new URL("./fixtures/catalog-parity.json", import.meta.url), "utf8")) as {
  products: ProductListItem[];
};
const P = parity.products;

function fakeStore() {
  const rows = new Map<string, { title: string; position: number | undefined }>();
  const log: string[] = [];
  const store: CatalogStore = {
    async upsert(row, position) {
      rows.set(row.id, { title: row.title, position });
      log.push(`upsert ${row.id}`);
    },
    async remove(id) {
      rows.delete(id);
      log.push(`remove ${id}`);
    },
    async setMembership(id, handles) {
      log.push(`membership ${id} ${handles.join(",")}`);
    },
    async replaceCollection(handle) {
      log.push(`collection ${handle}`);
    },
    async recomputeTitleGroups() {
      log.push("titles");
    },
    async finishFullSync({ orderedIds }) {
      log.push(`finish ${orderedIds.length}`);
      let deleted = 0;
      for (const id of [...rows.keys()]) if (!orderedIds.includes(id)) (rows.delete(id), deleted++);
      return { deleted };
    },
    async count() {
      return rows.size;
    },
  };
  return { store, rows, log };
}

function fakeSource(products: ProductListItem[], { failAfterPages = Infinity } = {}): CatalogSource & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    async product(id) {
      fetched.push(id);
      const item = products.find((p) => p.id === id);
      return item ? { item, updatedAt: "2026-11-20T00:00:00Z", collections: ["men", "not-tracked"] } : null;
    },
    async productsPage(after) {
      const page = after ? Number(after) : 0;
      if (page >= failAfterPages) throw new Error("Storefront API returned 502");
      const slice = products.slice(page * 10, page * 10 + 10);
      return { products: slice.map((item) => ({ item, updatedAt: null })), endCursor: String(page + 1), hasNextPage: (page + 1) * 10 < products.length };
    },
    async bestSellingIds() {
      return [];
    },
    async collectionIds() {
      return [];
    },
  };
}

describe("productIdFromPayload", () => {
  it("reads only a valid product id", () => {
    expect(productIdFromPayload({ id: 123, title: "x" })).toBe("gid://shopify/Product/123");
    expect(productIdFromPayload({ admin_graphql_api_id: "gid://shopify/Product/9", id: 1 })).toBe("gid://shopify/Product/9");
    expect(productIdFromPayload({ id: "456" })).toBe("gid://shopify/Product/456");
    for (const bad of [null, "x", {}, { id: -1 }, { id: 1.5 }, { id: "1; drop" }, { admin_graphql_api_id: "gid://shopify/Order/1" }]) {
      expect(productIdFromPayload(bad)).toBeNull();
    }
  });
});

describe("catalog webhooks", () => {
  const setup = (products = P) => {
    const { store, rows, log } = fakeStore();
    const source = fakeSource(products);
    const scheduled: string[] = [];
    const handler = createCatalogHandler({ source, store, scheduleFullSync: async (reason) => void scheduled.push(reason) });
    return { store, rows, log, source, scheduled, handler };
  };

  it("products/update re-fetches the product (ignoring the payload's data) and upserts it", async () => {
    const s = setup();
    await s.handler("products/update", { id: 1003, title: "PAYLOAD TITLE IS IGNORED" });
    expect(s.source.fetched).toEqual([P[3].id]);
    expect(s.rows.get(P[3].id)?.title).toBe(P[3].title);
    expect(s.log).toEqual([`upsert ${P[3].id}`, `membership ${P[3].id} men,not-tracked`, "titles"]);
  });

  it("removes a product Shopify no longer shows", async () => {
    const s = setup();
    s.rows.set("gid://shopify/Product/999999", { title: "old", position: 0 });
    await s.handler("products/update", { id: 999999 });
    expect(s.rows.has("gid://shopify/Product/999999")).toBe(false);
  });

  it("products/delete removes by id without fetching", async () => {
    const s = setup();
    await s.handler("products/delete", { id: 1001 });
    expect(s.source.fetched).toEqual([]);
    expect(s.log).toEqual([`remove ${P[1].id}`]);
  });

  it("inventory changes schedule one debounced full sync; an id-less payload doesn't guess", async () => {
    const s = setup();
    await s.handler("inventory_levels/update", { inventory_item_id: 5 });
    await s.handler("products/update", { title: "no id" });
    expect(s.scheduled).toEqual(["inventory change", "products/update without a product id"]);
    expect(s.source.fetched).toEqual([]);
  });

  it("collection webhooks refresh the tracked collections", async () => {
    const s = setup();
    await s.handler("collections/update", { id: 1 });
    expect(s.log.filter((l) => l.startsWith("collection"))).toHaveLength(10);
  });

  it("runs before the storefront cache is cleared, and a failure is retried", async () => {
    const w = fakeWebhooks();
    await w.intake({ webhookId: "w1", topic: "products/update", shopDomain: "s", payload: { id: 1003 }, handled: true });
    const order: string[] = [];
    let fail = true;
    const deps = {
      store: w.store,
      revalidate: async () => void order.push("revalidate"),
      catalog: async () => {
        order.push("catalog");
        if (fail) throw new Error("Storefront API returned 502");
      },
    };
    await expect(processWebhookEvent(1, deps)).rejects.toThrow("502");
    fail = false;
    expect(await processWebhookEvent(1, deps)).toBe("processed");
    expect(order).toEqual(["catalog", "catalog", "revalidate"]);
  });
});

describe("fullSync", () => {
  it("upserts every page in order and deletes products no longer in Shopify", async () => {
    const { store, rows } = fakeStore();
    rows.set("gid://shopify/Product/gone", { title: "gone", position: 0 });
    expect(await fullSync({ source: fakeSource(P.slice(0, 25)), store })).toEqual({ products: 25, deleted: 1 });
    expect([...rows.values()].map((r) => r.position)).toEqual([...Array(25).keys()]);
  });

  it("deletes nothing when a page fails part-way", async () => {
    const { store, rows, log } = fakeStore();
    rows.set("gid://shopify/Product/keep", { title: "keep", position: 0 });
    await expect(fullSync({ source: fakeSource(P, { failAfterPages: 2 }), store })).rejects.toThrow("502");
    expect(rows.has("gid://shopify/Product/keep")).toBe(true);
    expect(log.some((l) => l.startsWith("finish"))).toBe(false);
  });

  it("refuses to wipe the catalog when Shopify returns no products", async () => {
    const { store, rows } = fakeStore();
    rows.set("gid://shopify/Product/keep", { title: "keep", position: 0 });
    await expect(fullSync({ source: fakeSource([]), store })).rejects.toThrow(/refusing/);
    expect(rows.size).toBe(1);
  });
});

describe("catalog endpoints", () => {
  const app = () =>
    buildApp({
      serviceToken: "t".repeat(48),
      customers: fakeCustomers(),
      favourites: fakeFavourites(),
      pingDb: async () => {},
      webhooks: fakeWebhooks().deps,
      // A pool that must never be reached in these tests.
      catalog: { pool: { query: async () => { throw new Error("db should not be called"); } } as never },
    });

  it("need the service token", async () => {
    const a = app();
    for (const url of ["/v1/catalog", "/v1/products/by-ids?ids=1", "/v1/catalog/overview"]) {
      expect((await a.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
    expect((await a.inject({ method: "POST", url: "/v1/catalog/sync" })).statusCode).toBe(401);
    await a.close();
  });

  it("POST /v1/catalog/sync is 503 when sync isn't configured", async () => {
    const a = app();
    const res = await a.inject({ method: "POST", url: "/v1/catalog/sync", headers: { authorization: `Bearer ${"t".repeat(48)}` } });
    expect(res.statusCode).toBe(503);
    await a.close();
  });
});

describe("shared catalog code", () => {
  it("is an identical copy of the storefront's lib/catalog-shared (run npm run sync:shared)", () => {
    const appDir = path.resolve(new URL(".", import.meta.url).pathname, "../../lib/catalog-shared");
    const ourDir = path.resolve(new URL(".", import.meta.url).pathname, "../src/catalog-shared");
    const appFiles = fs.readdirSync(appDir).sort();
    expect(fs.readdirSync(ourDir).sort()).toEqual(appFiles);
    for (const file of appFiles) {
      expect(fs.readFileSync(path.join(ourDir, file), "utf8"), file).toBe(fs.readFileSync(path.join(appDir, file), "utf8"));
    }
  });
});
