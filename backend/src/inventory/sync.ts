import { levelKey, type InventoryStore } from "./store.js";
import type { InventorySource } from "./types.js";

export type InventorySyncDeps = {
  source: InventorySource;
  store: InventoryStore;
};

export type FullSyncResult = {
  locations: number;
  items: number;
  levels: number;
  deletedLocations: number;
  deletedItems: number;
  deletedLevels: number;
};

/** Pages locations then items/levels; deletes missing rows only after a complete read. */
export async function fullSync(deps: InventorySyncDeps): Promise<FullSyncResult> {
  const seenLocations = new Set<string>();
  const seenItems = new Set<string>();
  const seenLevels = new Set<string>();
  let locationCount = 0;
  let itemCount = 0;
  let levelCount = 0;

  let locAfter: string | null = null;
  for (;;) {
    const page = await deps.source.locationsPage(locAfter);
    for (const loc of page.locations) {
      await deps.store.upsertLocation(loc);
      seenLocations.add(loc.shopifyId);
      locationCount++;
    }
    if (!page.hasNextPage) break;
    locAfter = page.endCursor;
  }

  let itemAfter: string | null = null;
  for (;;) {
    const page = await deps.source.inventoryItemsPage(itemAfter);
    for (const item of page.items) {
      const itemId = await deps.store.upsertItem(item);
      seenItems.add(item.shopifyId);
      itemCount++;
      for (const level of item.levels) {
        const locationId = await deps.store.ensureLocationId(level.locationShopifyId);
        seenLocations.add(level.locationShopifyId);
        const result = await deps.store.upsertLevel({
          itemId,
          locationId,
          itemShopifyId: item.shopifyId,
          locationShopifyId: level.locationShopifyId,
          level,
          source: "sync",
        });
        if (result.applied) levelCount++;
        seenLevels.add(levelKey(item.shopifyId, level.locationShopifyId));
      }
    }
    if (!page.hasNextPage) break;
    itemAfter = page.endCursor;
  }

  const deleted = await deps.store.finishFullSync({
    locationIds: seenLocations,
    itemIds: seenItems,
    levelKeys: seenLevels,
  });

  return {
    locations: locationCount,
    items: itemCount,
    levels: levelCount,
    ...deleted,
  };
}
