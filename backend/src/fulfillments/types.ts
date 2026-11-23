export type RemoteFulfillmentOrderLine = {
  shopifyId: string;
  /** LineItem GID (order_lines.shopify_id). */
  orderLineShopifyId: string | null;
  inventoryItemId: string | null;
  totalQuantity: number;
  remainingQuantity: number;
};

export type RemoteFulfillmentOrder = {
  shopifyId: string;
  status: string;
  requestStatus: string | null;
  assignedLocationShopifyId: string | null;
  fulfillAt: string | null;
  updatedAt: string | null;
  /** All line pages fetched. */
  lines: RemoteFulfillmentOrderLine[];
};

export type RemoteFulfillment = {
  shopifyId: string;
  status: string;
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type RemoteOrderFulfillments = {
  orderShopifyId: string;
  /** Every fulfillment order of the order (all pages). */
  fulfillmentOrders: RemoteFulfillmentOrder[];
  fulfillments: RemoteFulfillment[];
  /**
   * False when Shopify may have truncated the fulfillments list (it has no paging);
   * the store then upserts but never prunes fulfillments.
   */
  fulfillmentsComplete: boolean;
};

export type FulfillmentsSource = {
  /** Null when the order is missing or outside the read_orders window (ACCESS_DENIED). */
  forOrder(orderShopifyId: string): Promise<RemoteOrderFulfillments | null>;
  /** The order GID of a fulfillment order; null when missing or not accessible. */
  orderIdForFulfillmentOrder(fulfillmentOrderShopifyId: string): Promise<string | null>;
};
