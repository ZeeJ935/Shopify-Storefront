// Shapes returned by the backend's /admin read routes (no customer personal data).
export type OrderSummary = {
  id: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  currency: string | null;
  total: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  test: boolean;
};

export type OrderLine = {
  id: string;
  sku: string | null;
  title: string;
  quantity: number;
  fulfillableQuantity: number;
  unitPrice: string | null;
  discountedTotal: string | null;
};

export type FulfillmentOrderView = {
  id: string;
  status: string;
  requestStatus: string | null;
  assignedLocationId: string | null;
  fulfillAt: string | null;
  updatedAt: string | null;
  lines: { id: string; orderLineId: string | null; inventoryItemId: string | null; totalQuantity: number; remainingQuantity: number }[];
};

export type FulfillmentView = {
  id: string;
  status: string;
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  createdAt: string | null;
};

export type OrderDetail = OrderSummary & {
  subtotal: string | null;
  tax: string | null;
  discount: string | null;
  processedAt: string | null;
  cancelReason: string | null;
  sourceName: string | null;
  lines: OrderLine[];
  fulfillmentOrders: FulfillmentOrderView[];
  fulfillments: FulfillmentView[];
};

export type FulfillmentAction = {
  key: string;
  status: "pending" | "submitting" | "succeeded" | "failed" | "dry_run";
  dryRun: boolean;
  fulfillmentOrderId: string;
  shopifyFulfillmentId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WouldSend = {
  lineItemsByFulfillmentOrder: { fulfillmentOrderId: string; fulfillmentOrderLineItems?: { id: string; quantity: number }[] }[];
  notifyCustomer: boolean;
  trackingInfo?: { company?: string; number?: string; url?: string };
};

export type InventoryLevel = {
  inventoryItemId: string;
  locationId: string;
  sku: string | null;
  available: number;
  onHand: number;
  committed: number;
  incoming: number;
  shopifyUpdatedAt: string | null;
};

export type LocationView = { id: string; name: string; active: boolean; fulfillsOnlineOrders: boolean };

export type AuditEntry = {
  id: number;
  at: string;
  staffEmail: string | null;
  role: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  result: string;
  statusCode: number | null;
  detail: Record<string, unknown> | null;
};
