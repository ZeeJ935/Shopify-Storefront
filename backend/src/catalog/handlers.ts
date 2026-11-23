import { productIdFromPayload, syncCollections, syncProduct, type CatalogDeps } from "./sync.js";

/**
 * What a catalog webhook does to the Postgres catalog. The payload is only used
 * for the product ID; product data is always re-fetched from the Storefront API.
 */
export function createCatalogHandler(deps: CatalogDeps & { scheduleFullSync: (reason: string) => Promise<void> }) {
  return async (topic: string, payload: unknown): Promise<void> => {
    switch (topic) {
      case "products/create":
      case "products/update": {
        const id = productIdFromPayload(payload);
        // No usable ID: don't guess; the (debounced) full sync will pick the change up.
        if (!id) return deps.scheduleFullSync(`${topic} without a product id`);
        await syncProduct(id, deps);
        return;
      }
      case "products/delete": {
        const id = productIdFromPayload(payload);
        if (!id) return deps.scheduleFullSync("products/delete without a product id");
        await deps.store.remove(id);
        return;
      }
      case "collections/create":
      case "collections/update":
      case "collections/delete":
        await syncCollections(deps);
        return;
      case "inventory_levels/update":
        // The payload names an inventory item, not a product: resync (at most once a minute).
        await deps.scheduleFullSync("inventory change");
        return;
    }
  };
}
