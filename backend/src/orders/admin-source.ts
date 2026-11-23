import { ShopifyGraphqlError, type ShopifyAdmin } from "../shopify-admin/index.js";
import type { OrdersSource, RemoteOrder, RemoteOrderLine } from "./types.js";

export const ORDERS_PAGE = 50;
export const LINES_PAGE = 25;

/** Days of orders readable with read_orders (not read_all_orders). */
export const ORDERS_WINDOW_DAYS = 60;

type MoneySet = { shopMoney?: { amount?: string; currencyCode?: string } | null } | null;

type LineNode = {
  id: string;
  title?: string | null;
  sku?: string | null;
  quantity?: number | null;
  unfulfilledQuantity?: number | null;
  originalUnitPriceSet?: MoneySet;
  discountedTotalSet?: MoneySet;
  variant?: {
    id?: string | null;
    product?: { id?: string | null } | null;
    inventoryItem?: { id?: string | null } | null;
  } | null;
};

type OrderNode = {
  id: string;
  name: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  processedAt?: string | null;
  cancelledAt?: string | null;
  closedAt?: string | null;
  cancelReason?: string | null;
  sourceName?: string | null;
  test?: boolean | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  subtotalPriceSet?: MoneySet;
  totalPriceSet?: MoneySet;
  totalTaxSet?: MoneySet;
  totalDiscountsSet?: MoneySet;
  lineItems: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: LineNode[];
  };
};

const MONEY = `shopMoney { amount currencyCode }`;

/** Fields we request — never customer, email, phone, address, or note. */
export const ORDER_SELECTION = `
  id name createdAt updatedAt processedAt cancelledAt closedAt cancelReason sourceName test
  displayFinancialStatus displayFulfillmentStatus
  subtotalPriceSet { ${MONEY} }
  totalPriceSet { ${MONEY} }
  totalTaxSet { ${MONEY} }
  totalDiscountsSet { ${MONEY} }
  lineItems(first: ${LINES_PAGE}) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title sku quantity unfulfilledQuantity
      originalUnitPriceSet { ${MONEY} }
      discountedTotalSet { ${MONEY} }
      variant { id product { id } inventoryItem { id } }
    }
  }
`;

function moneyAmount(set: MoneySet): string | null {
  const a = set?.shopMoney?.amount;
  return typeof a === "string" ? a : null;
}

function mapLine(node: LineNode): RemoteOrderLine {
  return {
    shopifyId: node.id,
    variantId: node.variant?.id ?? null,
    productId: node.variant?.product?.id ?? null,
    inventoryItemId: node.variant?.inventoryItem?.id ?? null,
    sku: node.sku ?? null,
    title: node.title ?? "",
    quantity: typeof node.quantity === "number" ? node.quantity : 0,
    fulfillableQuantity: typeof node.unfulfilledQuantity === "number" ? node.unfulfilledQuantity : 0,
    unitPrice: moneyAmount(node.originalUnitPriceSet ?? null),
    discountedTotal: moneyAmount(node.discountedTotalSet ?? null),
  };
}

function mapOrderBase(node: Omit<OrderNode, "lineItems">, lines: RemoteOrderLine[]): RemoteOrder {
  return {
    shopifyId: node.id,
    name: node.name,
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
    processedAt: node.processedAt ?? null,
    cancelledAt: node.cancelledAt ?? null,
    closedAt: node.closedAt ?? null,
    currency: node.totalPriceSet?.shopMoney?.currencyCode ?? null,
    subtotal: moneyAmount(node.subtotalPriceSet ?? null),
    total: moneyAmount(node.totalPriceSet ?? null),
    tax: moneyAmount(node.totalTaxSet ?? null),
    discount: moneyAmount(node.totalDiscountsSet ?? null),
    financialStatus: node.displayFinancialStatus ?? null,
    fulfillmentStatus: node.displayFulfillmentStatus ?? null,
    cancelReason: node.cancelReason ?? null,
    sourceName: node.sourceName ?? null,
    test: Boolean(node.test),
    lines,
  };
}

/**
 * True only when Admin refused the order with the ACCESS_DENIED error code (e.g. outside
 * the read_orders 60-day window). Matches codes, not message text, so schema errors,
 * outages and exhausted THROTTLED retries are thrown and retried/reported instead.
 */
export function isOrderAccessError(error: unknown): boolean {
  return error instanceof ShopifyGraphqlError && error.codes.includes("ACCESS_DENIED");
}

/**
 * Admin GraphQL orders source. Nested lineItems are paged (LINES_PAGE); remaining
 * pages are always fetched before an order is returned — never truncate.
 */
export function createAdminOrdersSource(admin: ShopifyAdmin): OrdersSource {
  async function fetchRemainingLines(orderId: string, after: string | null): Promise<RemoteOrderLine[]> {
    const lines: RemoteOrderLine[] = [];
    let cursor = after;
    for (;;) {
      const data = await admin.request<{
        order: {
          lineItems: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: LineNode[];
          };
        } | null;
      }>(
        `query OrderLines($id: ID!, $after: String) {
          order(id: $id) {
            lineItems(first: ${LINES_PAGE}, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id title sku quantity unfulfilledQuantity
                originalUnitPriceSet { ${MONEY} }
                discountedTotalSet { ${MONEY} }
                variant { id product { id } inventoryItem { id } }
              }
            }
          }
        }`,
        { id: orderId, after: cursor },
      );
      const conn = data.order?.lineItems;
      if (!conn) throw new Error(`order lines missing for ${orderId}`);
      for (const n of conn.nodes) lines.push(mapLine(n));
      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
    return lines;
  }

  async function hydrateOrder(node: OrderNode): Promise<RemoteOrder> {
    const lines = node.lineItems.nodes.map(mapLine);
    if (node.lineItems.pageInfo.hasNextPage) {
      // Throws on failure → caller must not upsert/prune with partial lines.
      lines.push(...(await fetchRemainingLines(node.id, node.lineItems.pageInfo.endCursor)));
    }
    return mapOrderBase(node, lines);
  }

  return {
    async ordersPage(after, updatedSince) {
      const data = await admin.request<{
        orders: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: OrderNode[];
        };
      }>(
        `query Orders($after: String, $query: String) {
          orders(first: ${ORDERS_PAGE}, after: $after, query: $query, sortKey: UPDATED_AT) {
            pageInfo { hasNextPage endCursor }
            nodes { ${ORDER_SELECTION} }
          }
        }`,
        { after, query: `updated_at:>='${updatedSince}'` },
      );
      const orders: RemoteOrder[] = [];
      for (const node of data.orders.nodes) {
        orders.push(await hydrateOrder(node));
      }
      return {
        orders,
        endCursor: data.orders.pageInfo.endCursor,
        hasNextPage: data.orders.pageInfo.hasNextPage,
      };
    },

    async order(id) {
      try {
        const data = await admin.request<{ order: OrderNode | null }>(
          `query Order($id: ID!) {
            order(id: $id) { ${ORDER_SELECTION} }
          }`,
          { id },
        );
        if (!data.order) return null;
        return await hydrateOrder(data.order);
      } catch (error) {
        if (isOrderAccessError(error)) return null;
        throw error;
      }
    },
  };
}

export function ordersUpdatedSinceIso(now = Date.now()): string {
  return new Date(now - ORDERS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
