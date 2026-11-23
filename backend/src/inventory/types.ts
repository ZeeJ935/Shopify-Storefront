export type RemoteLocation = {
  shopifyId: string;
  name: string;
  active: boolean;
  fulfillsOnlineOrders: boolean;
  updatedAt: string | null;
};

export type RemoteQuantities = {
  available: number;
  onHand: number;
  committed: number;
  incoming: number;
};

export type RemoteLevel = RemoteQuantities & {
  locationShopifyId: string;
  shopifyUpdatedAt: string | null;
};

export type RemoteInventoryItem = {
  shopifyId: string;
  variantId: string | null;
  productId: string | null;
  sku: string | null;
  tracked: boolean;
  updatedAt: string | null;
  levels: RemoteLevel[];
};

export type InventorySource = {
  locationsPage(after: string | null): Promise<{ locations: RemoteLocation[]; endCursor: string | null; hasNextPage: boolean }>;
  inventoryItemsPage(after: string | null): Promise<{ items: RemoteInventoryItem[]; endCursor: string | null; hasNextPage: boolean }>;
  location(id: string): Promise<RemoteLocation | null>;
  inventoryItem(id: string): Promise<RemoteInventoryItem | null>;
  /** One level for an item at a location (webhook path). */
  inventoryLevel(itemId: string, locationId: string): Promise<(RemoteLevel & { itemShopifyId: string }) | null>;
};
