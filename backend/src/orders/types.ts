export type RemoteOrderLine = {
  shopifyId: string;
  variantId: string | null;
  productId: string | null;
  inventoryItemId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  fulfillableQuantity: number;
  unitPrice: string | null;
  discountedTotal: string | null;
};

export type RemoteOrder = {
  shopifyId: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  processedAt: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  currency: string | null;
  subtotal: string | null;
  total: string | null;
  tax: string | null;
  discount: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cancelReason: string | null;
  sourceName: string | null;
  test: boolean;
  lines: RemoteOrderLine[];
};

export type OrdersSource = {
  /** Pages orders updated since `updatedSince` (ISO). Lines are fully loaded (nested pages followed). */
  ordersPage(
    after: string | null,
    updatedSince: string,
  ): Promise<{ orders: RemoteOrder[]; endCursor: string | null; hasNextPage: boolean }>;
  /**
   * Single order with all line pages. Returns null when missing or outside the
   * read_orders window (ACCESS_DENIED / not found) so webhooks can skip without retry.
   */
  order(id: string): Promise<RemoteOrder | null>;
};
