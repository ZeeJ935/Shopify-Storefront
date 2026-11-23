import type { ShopifyAdmin } from "../shopify-admin/index.js";
import { isOrderAccessError } from "../orders/admin-source.js";

export type LiveFulfillmentOrder = {
  orderId: string;
  status: string;
  /** FulfillmentOrderLineItem GID → remaining quantity (all pages). */
  remaining: Map<string, number>;
  /** Newest fulfillments of this fulfillment order (for retry reconciliation). */
  recentFulfillments: { id: string; createdAt: string }[];
};

/** fulfillmentCreate input (Admin 2026-10 FulfillmentInput). No origin address is sent. */
export type FulfillmentCreateInput = {
  lineItemsByFulfillmentOrder: {
    fulfillmentOrderId: string;
    fulfillmentOrderLineItems?: { id: string; quantity: number }[];
  }[];
  notifyCustomer: boolean;
  trackingInfo?: { company?: string; number?: string; url?: string };
};

export type FulfillmentActionsShopify = {
  /** Null when the fulfillment order is missing or not accessible. */
  liveFulfillmentOrder(id: string): Promise<LiveFulfillmentOrder | null>;
  /** Creates the fulfillment; throws ShopifyUserErrors on userErrors. */
  createFulfillment(input: FulfillmentCreateInput): Promise<{ id: string; status: string | null }>;
};

const LIVE_LINES_PAGE = 100;

export function createFulfillmentActionsShopify(admin: ShopifyAdmin): FulfillmentActionsShopify {
  return {
    async liveFulfillmentOrder(id) {
      const remaining = new Map<string, number>();
      let after: string | null = null;
      let head: { orderId: string; status: string; recentFulfillments: { id: string; createdAt: string }[] } | null = null;
      for (;;) {
        type Data = {
          fulfillmentOrder: {
            orderId: string;
            status: string;
            lineItems: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; remainingQuantity: number }[] };
            fulfillments: { nodes: { id: string; createdAt: string }[] };
          } | null;
        };
        let data: Data;
        try {
          data = await admin.request<Data>(
            `query FoLive($id: ID!, $after: String) {
              fulfillmentOrder(id: $id) {
                orderId status
                lineItems(first: ${LIVE_LINES_PAGE}, after: $after) {
                  pageInfo { hasNextPage endCursor }
                  nodes { id remainingQuantity }
                }
                fulfillments(first: 10, reverse: true) { nodes { id createdAt } }
              }
            }`,
            { id, after },
          );
        } catch (error) {
          if (isOrderAccessError(error)) return null;
          throw error;
        }
        const fo = data.fulfillmentOrder;
        if (!fo) return null;
        head ??= { orderId: fo.orderId, status: fo.status, recentFulfillments: fo.fulfillments.nodes };
        for (const n of fo.lineItems.nodes) remaining.set(n.id, n.remainingQuantity);
        if (!fo.lineItems.pageInfo.hasNextPage) break;
        after = fo.lineItems.pageInfo.endCursor;
      }
      return { ...head, remaining };
    },

    async createFulfillment(input) {
      const data = await admin.request<{ fulfillmentCreate: { fulfillment: { id: string; status: string | null } | null } }>(
        `mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id status }
            userErrors { field message }
          }
        }`,
        { fulfillment: input },
      );
      const created = data.fulfillmentCreate.fulfillment;
      if (!created) throw new Error("fulfillmentCreate returned no fulfillment");
      return created;
    },
  };
}
