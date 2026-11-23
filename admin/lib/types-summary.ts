export type AdminSummary = {
  unfulfilledOrders: number;
  openFulfillmentOrders: number;
  ordersLast7Days: number;
  lowStockLevels: number;
  outOfStockLevels: number;
  pendingFulfillments: number;
  failedFulfillments7Days: number;
  lowStockAt: number;
};

export type SearchResults = {
  exactOrderId: string | null;
  orders: { id: string; name: string; createdAt: string | null; financialStatus: string | null; fulfillmentStatus: string | null }[];
  skus: { sku: string; inventoryItemId: string; locations: number; available: number }[];
};
