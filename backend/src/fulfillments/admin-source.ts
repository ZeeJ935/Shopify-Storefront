import type { ShopifyAdmin } from "../shopify-admin/index.js";
import { isOrderAccessError } from "../orders/admin-source.js";
import type {
  FulfillmentsSource,
  RemoteFulfillment,
  RemoteFulfillmentOrder,
  RemoteFulfillmentOrderLine,
  RemoteOrderFulfillments,
} from "./types.js";

export const FULFILLMENT_ORDERS_PAGE = 25;
export const FO_LINES_PAGE = 50;
/** Order.fulfillments is a plain list (no paging); a full list means it may be truncated. */
export const FULFILLMENTS_LIMIT = 100;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

type FoLineNode = {
  id: string;
  totalQuantity?: number | null;
  remainingQuantity?: number | null;
  inventoryItemId?: string | null;
  lineItem?: { id?: string | null } | null;
};

type FoNode = {
  id: string;
  status: string;
  requestStatus?: string | null;
  fulfillAt?: string | null;
  updatedAt?: string | null;
  assignedLocation?: { location?: { id?: string | null } | null } | null;
  lineItems: { pageInfo: PageInfo; nodes: FoLineNode[] };
};

type FulfillmentNode = {
  id: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  trackingInfo?: { company?: string | null; number?: string | null; url?: string | null }[] | null;
};

/**
 * Fields we request. Never `destination`, `deliveryMethod`, addresses, customer,
 * email or phone (asserted by tests).
 */
export const FO_LINE_FIELDS = `id totalQuantity remainingQuantity inventoryItemId lineItem { id }`;
export const FO_FIELDS = `
  id status requestStatus fulfillAt updatedAt
  assignedLocation { location { id } }
  lineItems(first: ${FO_LINES_PAGE}) {
    pageInfo { hasNextPage endCursor }
    nodes { ${FO_LINE_FIELDS} }
  }
`;
export const FULFILLMENT_FIELDS = `id status createdAt updatedAt trackingInfo(first: 1) { company number url }`;

const qty = (n: number | null | undefined) => (typeof n === "number" ? n : 0);

function mapLine(n: FoLineNode): RemoteFulfillmentOrderLine {
  return {
    shopifyId: n.id,
    orderLineShopifyId: n.lineItem?.id ?? null,
    inventoryItemId: n.inventoryItemId ?? null,
    totalQuantity: qty(n.totalQuantity),
    remainingQuantity: qty(n.remainingQuantity),
  };
}

function mapFulfillment(n: FulfillmentNode): RemoteFulfillment {
  const t = n.trackingInfo?.[0];
  return {
    shopifyId: n.id,
    status: n.status,
    trackingCompany: t?.company ?? null,
    trackingNumber: t?.number ?? null,
    trackingUrl: t?.url ?? null,
    createdAt: n.createdAt ?? null,
    updatedAt: n.updatedAt ?? null,
  };
}

/**
 * Admin GraphQL source for an order's fulfillment orders and fulfillments.
 * Every fulfillment-order page and nested line page is fetched before returning;
 * a failure throws, so the caller never prunes from a partial read.
 */
export function createAdminFulfillmentsSource(admin: ShopifyAdmin): FulfillmentsSource {
  async function remainingLines(foId: string, after: string | null): Promise<RemoteFulfillmentOrderLine[]> {
    const lines: RemoteFulfillmentOrderLine[] = [];
    let cursor = after;
    for (;;) {
      const data = await admin.request<{
        fulfillmentOrder: { lineItems: { pageInfo: PageInfo; nodes: FoLineNode[] } } | null;
      }>(
        `query FoLines($id: ID!, $after: String) {
          fulfillmentOrder(id: $id) {
            lineItems(first: ${FO_LINES_PAGE}, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes { ${FO_LINE_FIELDS} }
            }
          }
        }`,
        { id: foId, after: cursor },
      );
      const conn = data.fulfillmentOrder?.lineItems;
      if (!conn) throw new Error(`fulfillment order lines missing for ${foId}`);
      lines.push(...conn.nodes.map(mapLine));
      if (!conn.pageInfo.hasNextPage) return lines;
      cursor = conn.pageInfo.endCursor;
    }
  }

  async function hydrate(node: FoNode): Promise<RemoteFulfillmentOrder> {
    const lines = node.lineItems.nodes.map(mapLine);
    if (node.lineItems.pageInfo.hasNextPage) lines.push(...(await remainingLines(node.id, node.lineItems.pageInfo.endCursor)));
    return {
      shopifyId: node.id,
      status: node.status,
      requestStatus: node.requestStatus ?? null,
      assignedLocationShopifyId: node.assignedLocation?.location?.id ?? null,
      fulfillAt: node.fulfillAt ?? null,
      updatedAt: node.updatedAt ?? null,
      lines,
    };
  }

  async function forOrder(orderShopifyId: string): Promise<RemoteOrderFulfillments | null> {
    const fulfillmentOrders: RemoteFulfillmentOrder[] = [];
    let fulfillments: RemoteFulfillment[] = [];
    let fulfillmentsComplete = true;
    let after: string | null = null;

    for (let page = 0; ; page++) {
      // Fulfillments (a plain list) only on the first page.
      const withFulfillments = page === 0;
      type OrderData = {
        order: {
          fulfillmentOrders: { pageInfo: PageInfo; nodes: FoNode[] };
          fulfillments?: FulfillmentNode[];
        } | null;
      };
      let data: OrderData;
      try {
        data = await admin.request<OrderData>(
          `query OrderFulfillments($id: ID!, $after: String) {
            order(id: $id) {
              fulfillmentOrders(first: ${FULFILLMENT_ORDERS_PAGE}, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes { ${FO_FIELDS} }
              }
              ${withFulfillments ? `fulfillments(first: ${FULFILLMENTS_LIMIT}) { ${FULFILLMENT_FIELDS} }` : ""}
            }
          }`,
          { id: orderShopifyId, after },
        );
      } catch (error) {
        if (isOrderAccessError(error)) return null;
        throw error;
      }
      if (!data.order) return null;
      if (withFulfillments) {
        const list = data.order.fulfillments ?? [];
        fulfillments = list.map(mapFulfillment);
        fulfillmentsComplete = list.length < FULFILLMENTS_LIMIT;
      }
      for (const node of data.order.fulfillmentOrders.nodes) fulfillmentOrders.push(await hydrate(node));
      if (!data.order.fulfillmentOrders.pageInfo.hasNextPage) break;
      after = data.order.fulfillmentOrders.pageInfo.endCursor;
    }

    return { orderShopifyId, fulfillmentOrders, fulfillments, fulfillmentsComplete };
  }

  return {
    forOrder,
    async orderIdForFulfillmentOrder(foId) {
      try {
        const data = await admin.request<{ fulfillmentOrder: { orderId?: string | null } | null }>(
          `query FoOrder($id: ID!) { fulfillmentOrder(id: $id) { orderId } }`,
          { id: foId },
        );
        return data.fulfillmentOrder?.orderId ?? null;
      } catch (error) {
        if (isOrderAccessError(error)) return null;
        throw error;
      }
    },
  };
}
