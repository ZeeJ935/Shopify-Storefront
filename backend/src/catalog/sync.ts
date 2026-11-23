import { deriveRow, TRACKED_COLLECTIONS } from "./derive.js";
import type { CatalogStore } from "./store.js";
import type { CatalogSource } from "./storefront.js";

export type CatalogDeps = { source: CatalogSource; store: CatalogStore };

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;

/**
 * The product GID from a webhook payload. Only the ID is read (the payload
 * shape isn't trusted): either `admin_graphql_api_id` or a numeric `id`.
 */
export function productIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { admin_graphql_api_id?: unknown; id?: unknown };
  if (typeof p.admin_graphql_api_id === "string" && PRODUCT_GID.test(p.admin_graphql_api_id)) return p.admin_graphql_api_id;
  if ((typeof p.id === "number" && Number.isSafeInteger(p.id) && p.id > 0) || (typeof p.id === "string" && /^\d+$/.test(p.id))) {
    return `gid://shopify/Product/${p.id}`;
  }
  return null;
}

/** Re-fetches one product from the Storefront API: upserts it, or removes it if Shopify no longer shows it. */
export async function syncProduct(id: string, { source, store }: CatalogDeps): Promise<"upserted" | "removed"> {
  const fetched = await source.product(id);
  if (!fetched) {
    await store.remove(id);
    return "removed";
  }
  await store.upsert(deriveRow(fetched.item, fetched.updatedAt));
  await store.setMembership(id, fetched.collections);
  await store.recomputeTitleGroups();
  return "upserted";
}

/** Re-reads membership of every tracked collection (collection webhooks don't say reliably which one). */
export async function syncCollections({ source, store }: CatalogDeps): Promise<void> {
  for (const handle of TRACKED_COLLECTIONS) {
    await store.replaceCollection(handle, await source.collectionIds(handle));
  }
}

/**
 * Pages through the whole catalog (100 per page) and upserts it, then — only
 * once everything was fetched — sets order, best-selling ranks and collections,
 * and deletes products Shopify no longer has. Safe to run again at any time.
 */
export async function fullSync({ source, store }: CatalogDeps): Promise<{ products: number; deleted: number }> {
  const orderedIds: string[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await source.productsPage(after);
    for (const { item, updatedAt } of page.products) {
      await store.upsert(deriveRow(item, updatedAt), orderedIds.length);
      orderedIds.push(item.id);
    }
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }

  const bestSelling = await source.bestSellingIds();
  const collections: Record<string, string[]> = {};
  for (const handle of TRACKED_COLLECTIONS) collections[handle] = await source.collectionIds(handle);

  // Nothing is deleted unless the whole catalog was read. An empty read would
  // wipe the table, so refuse it: a real store emptying out should be handled by hand.
  if (orderedIds.length === 0) throw new Error("full sync read no products; refusing to delete the catalog");
  const { deleted } = await store.finishFullSync({ orderedIds, bestSelling, collections });
  return { products: orderedIds.length, deleted };
}
