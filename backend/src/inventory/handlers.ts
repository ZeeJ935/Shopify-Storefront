import { toGid } from "./ids.js";
import type { InventoryStore } from "./store.js";
import type { InventorySource } from "./types.js";
import type { WebhookEvent, WebhookHandler } from "../webhooks/router.js";

export type InventoryHandlerDeps = {
  source: InventorySource;
  store: InventoryStore;
};

function payloadIds(payload: unknown): { itemId?: string | number; locationId?: string | number; id?: string | number } {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  return {
    itemId: (p.inventory_item_id ?? p.inventoryItemId) as string | number | undefined,
    locationId: (p.location_id ?? p.locationId) as string | number | undefined,
    id: p.id as string | number | undefined,
  };
}

async function upsertItemWithLevels(deps: InventoryHandlerDeps, itemShopifyId: string): Promise<void> {
  const remote = await deps.source.inventoryItem(itemShopifyId);
  if (!remote) return;
  const itemId = await deps.store.upsertItem(remote);
  for (const level of remote.levels) {
    const locationId = await deps.store.ensureLocationId(level.locationShopifyId);
    await deps.store.upsertLevel({
      itemId,
      locationId,
      itemShopifyId: remote.shopifyId,
      locationShopifyId: level.locationShopifyId,
      level,
      source: "webhook",
    });
  }
}

/** Idempotent Admin-backed inventory webhook handlers. */
export function createInventoryHandlers(deps: InventoryHandlerDeps): {
  levelsUpdate: WebhookHandler;
  itemUpdate: WebhookHandler;
  locationUpsert: WebhookHandler;
  locationDelete: WebhookHandler;
} {
  return {
    levelsUpdate: {
      name: "inventory",
      async handle(event: WebhookEvent) {
        const { itemId, locationId } = payloadIds(event.payload);
        if (itemId == null || locationId == null) return;
        const remote = await deps.source.inventoryLevel(toGid("InventoryItem", itemId), toGid("Location", locationId));
        if (!remote) return;
        const itemRowId = await deps.store.ensureItemId(remote.itemShopifyId);
        const locationRowId = await deps.store.ensureLocationId(remote.locationShopifyId);
        await deps.store.upsertLevel({
          itemId: itemRowId,
          locationId: locationRowId,
          itemShopifyId: remote.itemShopifyId,
          locationShopifyId: remote.locationShopifyId,
          level: remote,
          source: "webhook",
        });
      },
    },
    itemUpdate: {
      name: "inventory",
      async handle(event) {
        const { id } = payloadIds(event.payload);
        if (id == null) return;
        await upsertItemWithLevels(deps, toGid("InventoryItem", id));
      },
    },
    locationUpsert: {
      name: "inventory",
      async handle(event) {
        const { id } = payloadIds(event.payload);
        if (id == null) return;
        const remote = await deps.source.location(toGid("Location", id));
        if (!remote) return;
        await deps.store.upsertLocation(remote);
      },
    },
    locationDelete: {
      name: "inventory",
      async handle(event) {
        const { id } = payloadIds(event.payload);
        if (id == null) return;
        await deps.store.deleteLocationByShopifyId(toGid("Location", id));
      },
    },
  };
}
