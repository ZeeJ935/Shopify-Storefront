import type { ShopifyAdmin } from "../shopify-admin/index.js";
import type { InventorySource, RemoteInventoryItem, RemoteLevel, RemoteLocation, RemoteQuantities } from "./types.js";

export const LOCATIONS_PAGE = 50;
export const ITEMS_PAGE = 50;
export const LEVELS_PAGE = 25;

const QTY_NAMES = ["available", "on_hand", "committed", "incoming"] as const;

type QtyNode = { name: string; quantity: number };

function quantitiesFrom(nodes: QtyNode[] | undefined): RemoteQuantities {
  const map = new Map((nodes ?? []).map((q) => [q.name, q.quantity]));
  return {
    available: map.get("available") ?? 0,
    onHand: map.get("on_hand") ?? 0,
    committed: map.get("committed") ?? 0,
    incoming: map.get("incoming") ?? 0,
  };
}

function mapLocation(node: {
  id: string;
  name: string;
  isActive?: boolean;
  fulfillsOnlineOrders?: boolean;
  updatedAt?: string | null;
}): RemoteLocation {
  return {
    shopifyId: node.id,
    name: node.name,
    active: node.isActive !== false,
    fulfillsOnlineOrders: Boolean(node.fulfillsOnlineOrders),
    updatedAt: node.updatedAt ?? null,
  };
}

function mapLevel(node: {
  updatedAt?: string | null;
  location?: { id: string } | null;
  quantities?: QtyNode[];
}): RemoteLevel | null {
  if (!node.location?.id) return null;
  return {
    locationShopifyId: node.location.id,
    shopifyUpdatedAt: node.updatedAt ?? null,
    ...quantitiesFrom(node.quantities),
  };
}

const LEVEL_FIELDS = `updatedAt location { id } quantities(names: ["available","on_hand","committed","incoming"]) { name quantity }`;

/**
 * Admin GraphQL inventory source. Nested levels are paged (LEVELS_PAGE); remaining
 * pages for an item are fetched when hasNextPage is true.
 */
export function createAdminInventorySource(admin: ShopifyAdmin): InventorySource {
  async function fetchRemainingLevels(itemId: string, after: string | null): Promise<RemoteLevel[]> {
    const levels: RemoteLevel[] = [];
    let cursor = after;
    for (;;) {
      const data = await admin.request<{
        inventoryItem: {
          inventoryLevels: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Parameters<typeof mapLevel>[0][];
          };
        } | null;
      }>(
        `query ItemLevels($id: ID!, $after: String) {
          inventoryItem(id: $id) {
            inventoryLevels(first: ${LEVELS_PAGE}, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes { ${LEVEL_FIELDS} }
            }
          }
        }`,
        { id: itemId, after: cursor },
      );
      const conn = data.inventoryItem?.inventoryLevels;
      if (!conn) break;
      for (const n of conn.nodes) {
        const level = mapLevel(n);
        if (level) levels.push(level);
      }
      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
    return levels;
  }

  return {
    async locationsPage(after) {
      const data = await admin.request<{
        locations: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Parameters<typeof mapLocation>[0][];
        };
      }>(
        `query Locations($after: String) {
          locations(first: ${LOCATIONS_PAGE}, after: $after, includeInactive: true) {
            pageInfo { hasNextPage endCursor }
            nodes { id name isActive fulfillsOnlineOrders updatedAt }
          }
        }`,
        { after },
      );
      return {
        locations: data.locations.nodes.map(mapLocation),
        endCursor: data.locations.pageInfo.endCursor,
        hasNextPage: data.locations.pageInfo.hasNextPage,
      };
    },

    async inventoryItemsPage(after) {
      const data = await admin.request<{
        inventoryItems: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            id: string;
            sku?: string | null;
            tracked?: boolean;
            updatedAt?: string | null;
            variant?: { id: string; product?: { id: string } | null } | null;
            inventoryLevels: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              nodes: Parameters<typeof mapLevel>[0][];
            };
          }[];
        };
      }>(
        `query InventoryItems($after: String) {
          inventoryItems(first: ${ITEMS_PAGE}, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id sku tracked updatedAt
              variant { id product { id } }
              inventoryLevels(first: ${LEVELS_PAGE}) {
                pageInfo { hasNextPage endCursor }
                nodes { ${LEVEL_FIELDS} }
              }
            }
          }
        }`,
        { after },
      );

      const items: RemoteInventoryItem[] = [];
      for (const node of data.inventoryItems.nodes) {
        const levels: RemoteLevel[] = [];
        for (const n of node.inventoryLevels.nodes) {
          const level = mapLevel(n);
          if (level) levels.push(level);
        }
        if (node.inventoryLevels.pageInfo.hasNextPage) {
          levels.push(...(await fetchRemainingLevels(node.id, node.inventoryLevels.pageInfo.endCursor)));
        }
        items.push({
          shopifyId: node.id,
          variantId: node.variant?.id ?? null,
          productId: node.variant?.product?.id ?? null,
          sku: node.sku ?? null,
          tracked: node.tracked !== false,
          updatedAt: node.updatedAt ?? null,
          levels,
        });
      }

      return {
        items,
        endCursor: data.inventoryItems.pageInfo.endCursor,
        hasNextPage: data.inventoryItems.pageInfo.hasNextPage,
      };
    },

    async location(id) {
      const data = await admin.request<{ location: Parameters<typeof mapLocation>[0] | null }>(
        `query Location($id: ID!) {
          location(id: $id) { id name isActive fulfillsOnlineOrders updatedAt }
        }`,
        { id },
      );
      return data.location ? mapLocation(data.location) : null;
    },

    async inventoryItem(id) {
      const data = await admin.request<{
        inventoryItem: {
          id: string;
          sku?: string | null;
          tracked?: boolean;
          updatedAt?: string | null;
          variant?: { id: string; product?: { id: string } | null } | null;
          inventoryLevels: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Parameters<typeof mapLevel>[0][];
          };
        } | null;
      }>(
        `query InventoryItem($id: ID!) {
          inventoryItem(id: $id) {
            id sku tracked updatedAt
            variant { id product { id } }
            inventoryLevels(first: ${LEVELS_PAGE}) {
              pageInfo { hasNextPage endCursor }
              nodes { ${LEVEL_FIELDS} }
            }
          }
        }`,
        { id },
      );
      const node = data.inventoryItem;
      if (!node) return null;
      const levels: RemoteLevel[] = [];
      for (const n of node.inventoryLevels.nodes) {
        const level = mapLevel(n);
        if (level) levels.push(level);
      }
      if (node.inventoryLevels.pageInfo.hasNextPage) {
        levels.push(...(await fetchRemainingLevels(node.id, node.inventoryLevels.pageInfo.endCursor)));
      }
      return {
        shopifyId: node.id,
        variantId: node.variant?.id ?? null,
        productId: node.variant?.product?.id ?? null,
        sku: node.sku ?? null,
        tracked: node.tracked !== false,
        updatedAt: node.updatedAt ?? null,
        levels,
      };
    },

    async inventoryLevel(itemId, locationId) {
      const data = await admin.request<{
        inventoryItem: {
          id: string;
          inventoryLevel: Parameters<typeof mapLevel>[0] | null;
        } | null;
      }>(
        `query OneLevel($itemId: ID!, $locationId: ID!) {
          inventoryItem(id: $itemId) {
            id
            inventoryLevel(locationId: $locationId) { ${LEVEL_FIELDS} }
          }
        }`,
        { itemId, locationId },
      );
      const item = data.inventoryItem;
      if (!item?.inventoryLevel) return null;
      const level = mapLevel(item.inventoryLevel);
      if (!level) return null;
      return { ...level, itemShopifyId: item.id };
    },
  };
}
