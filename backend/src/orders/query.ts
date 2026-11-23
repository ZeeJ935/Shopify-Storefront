import type pg from "pg";
import { toOrderGid } from "./ids.js";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export class InvalidCursorError extends Error {
  constructor() {
    super("invalid_cursor");
    this.name = "InvalidCursorError";
  }
}

type Cursor = { createdAt: string; shopifyId: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof parsed.createdAt !== "string" || typeof parsed.shopifyId !== "string") throw new Error("bad");
    return parsed;
  } catch {
    throw new InvalidCursorError();
  }
}

function mapOrder(r: {
  shopify_id: string;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
  processed_at: Date | null;
  cancelled_at: Date | null;
  closed_at: Date | null;
  currency: string | null;
  subtotal: string | null;
  total: string | null;
  tax: string | null;
  discount: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancel_reason: string | null;
  source_name: string | null;
  test: boolean;
}) {
  return {
    id: r.shopify_id,
    name: r.name,
    createdAt: r.created_at?.toISOString() ?? null,
    updatedAt: r.updated_at?.toISOString() ?? null,
    processedAt: r.processed_at?.toISOString() ?? null,
    cancelledAt: r.cancelled_at?.toISOString() ?? null,
    closedAt: r.closed_at?.toISOString() ?? null,
    currency: r.currency,
    subtotal: r.subtotal,
    total: r.total,
    tax: r.tax,
    discount: r.discount,
    financialStatus: r.financial_status,
    fulfillmentStatus: r.fulfillment_status,
    cancelReason: r.cancel_reason,
    sourceName: r.source_name,
    test: r.test,
  };
}

export async function listOrders(
  pool: pg.Pool,
  opts: {
    status?: string | null;
    financialStatus?: string | null;
    fulfillmentStatus?: string | null;
    from?: string | null;
    to?: string | null;
    sku?: string | null;
    cursor?: string | null;
    limit: number;
  },
) {
  const cursor = decodeCursor(opts.cursor ?? null);
  const params: unknown[] = [];
  const where: string[] = ["1=1"];

  if (opts.status === "cancelled") {
    where.push("o.cancelled_at is not null");
  } else if (opts.status === "closed") {
    where.push("o.closed_at is not null and o.cancelled_at is null");
  } else if (opts.status === "open") {
    where.push("o.cancelled_at is null and o.closed_at is null");
  }

  if (opts.financialStatus) {
    params.push(opts.financialStatus);
    where.push(`o.financial_status = $${params.length}`);
  }
  if (opts.fulfillmentStatus) {
    params.push(opts.fulfillmentStatus);
    where.push(`o.fulfillment_status = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`o.created_at >= $${params.length}::timestamptz`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`o.created_at <= $${params.length}::timestamptz`);
  }
  if (opts.sku) {
    params.push(opts.sku);
    where.push(`exists (select 1 from order_lines ol where ol.order_id = o.id and ol.sku = $${params.length})`);
  }
  if (cursor) {
    params.push(cursor.createdAt, cursor.shopifyId);
    where.push(
      `(o.created_at, o.shopify_id) < ($${params.length - 1}::timestamptz, $${params.length})`,
    );
  }

  params.push(opts.limit + 1);
  const { rows } = await pool.query<{
    shopify_id: string;
    name: string;
    created_at: Date | null;
    updated_at: Date | null;
    processed_at: Date | null;
    cancelled_at: Date | null;
    closed_at: Date | null;
    currency: string | null;
    subtotal: string | null;
    total: string | null;
    tax: string | null;
    discount: string | null;
    financial_status: string | null;
    fulfillment_status: string | null;
    cancel_reason: string | null;
    source_name: string | null;
    test: boolean;
  }>(
    `select o.shopify_id, o.name, o.created_at, o.updated_at, o.processed_at, o.cancelled_at, o.closed_at,
            o.currency, o.subtotal::text, o.total::text, o.tax::text, o.discount::text,
            o.financial_status, o.fulfillment_status, o.cancel_reason, o.source_name, o.test
     from orders o
     where ${where.join(" and ")}
     order by o.created_at desc nulls last, o.shopify_id desc
     limit $${params.length}`,
    params,
  );

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = page[page.length - 1];
  return {
    orders: page.map(mapOrder),
    nextCursor:
      hasMore && last?.created_at
        ? encodeCursor({ createdAt: last.created_at.toISOString(), shopifyId: last.shopify_id })
        : null,
  };
}

export async function getOrderDetail(pool: pg.Pool, id: string) {
  const shopifyId = toOrderGid(id);
  const order = await pool.query<{
    shopify_id: string;
    name: string;
    created_at: Date | null;
    updated_at: Date | null;
    processed_at: Date | null;
    cancelled_at: Date | null;
    closed_at: Date | null;
    currency: string | null;
    subtotal: string | null;
    total: string | null;
    tax: string | null;
    discount: string | null;
    financial_status: string | null;
    fulfillment_status: string | null;
    cancel_reason: string | null;
    source_name: string | null;
    test: boolean;
  }>(
    `select shopify_id, name, created_at, updated_at, processed_at, cancelled_at, closed_at,
            currency, subtotal::text, total::text, tax::text, discount::text,
            financial_status, fulfillment_status, cancel_reason, source_name, test
     from orders where shopify_id = $1`,
    [shopifyId],
  );
  if (!order.rows[0]) return null;

  const lines = await pool.query<{
    shopify_id: string;
    variant_id: string | null;
    product_id: string | null;
    inventory_item_id: string | null;
    sku: string | null;
    title: string;
    quantity: number;
    fulfillable_quantity: number;
    unit_price: string | null;
    discounted_total: string | null;
  }>(
    `select ol.shopify_id, ol.variant_id, ol.product_id, ol.inventory_item_id, ol.sku, ol.title,
            ol.quantity, ol.fulfillable_quantity, ol.unit_price::text, ol.discounted_total::text
     from order_lines ol
     join orders o on o.id = ol.order_id
     where o.shopify_id = $1
     order by ol.id asc`,
    [shopifyId],
  );

  return {
    ...mapOrder(order.rows[0]),
    lines: lines.rows.map((l) => ({
      id: l.shopify_id,
      variantId: l.variant_id,
      productId: l.product_id,
      inventoryItemId: l.inventory_item_id,
      sku: l.sku,
      title: l.title,
      quantity: l.quantity,
      fulfillableQuantity: l.fulfillable_quantity,
      unitPrice: l.unit_price,
      discountedTotal: l.discounted_total,
    })),
  };
}
