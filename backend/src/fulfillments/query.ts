import type pg from "pg";

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
  updatedAt: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Fulfillment orders (with lines) and fulfillments for one order, by order Shopify id. */
export async function getOrderFulfillments(
  pool: pg.Pool,
  orderShopifyId: string,
): Promise<{ fulfillmentOrders: FulfillmentOrderView[]; fulfillments: FulfillmentView[] }> {
  const fos = await pool.query<{
    id: string;
    shopify_id: string;
    status: string;
    request_status: string | null;
    assigned_location_shopify_id: string | null;
    fulfill_at: Date | null;
    shopify_updated_at: Date | null;
  }>(
    `select fo.id, fo.shopify_id, fo.status, fo.request_status, fo.assigned_location_shopify_id, fo.fulfill_at, fo.shopify_updated_at
     from fulfillment_orders fo join orders o on o.id = fo.order_id
     where o.shopify_id = $1
     order by fo.id asc`,
    [orderShopifyId],
  );
  const lines = fos.rows.length
    ? await pool.query<{
        fulfillment_order_id: string;
        shopify_id: string;
        order_line_shopify_id: string | null;
        inventory_item_id: string | null;
        total_quantity: number;
        remaining_quantity: number;
      }>(
        `select fulfillment_order_id, shopify_id, order_line_shopify_id, inventory_item_id, total_quantity, remaining_quantity
         from fulfillment_order_lines where fulfillment_order_id = any($1::bigint[])
         order by id asc`,
        [fos.rows.map((r) => r.id)],
      )
    : { rows: [] };
  const fs = await pool.query<{
    shopify_id: string;
    status: string;
    tracking_company: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    shopify_created_at: Date | null;
    shopify_updated_at: Date | null;
  }>(
    `select f.shopify_id, f.status, f.tracking_company, f.tracking_number, f.tracking_url, f.shopify_created_at, f.shopify_updated_at
     from fulfillments f join orders o on o.id = f.order_id
     where o.shopify_id = $1
     order by f.shopify_created_at asc nulls last, f.id asc`,
    [orderShopifyId],
  );

  return {
    fulfillmentOrders: fos.rows.map((fo) => ({
      id: fo.shopify_id,
      status: fo.status,
      requestStatus: fo.request_status,
      assignedLocationId: fo.assigned_location_shopify_id,
      fulfillAt: iso(fo.fulfill_at),
      updatedAt: iso(fo.shopify_updated_at),
      lines: lines.rows
        .filter((l) => l.fulfillment_order_id === fo.id)
        .map((l) => ({
          id: l.shopify_id,
          orderLineId: l.order_line_shopify_id,
          inventoryItemId: l.inventory_item_id,
          totalQuantity: l.total_quantity,
          remainingQuantity: l.remaining_quantity,
        })),
    })),
    fulfillments: fs.rows.map((f) => ({
      id: f.shopify_id,
      status: f.status,
      trackingCompany: f.tracking_company,
      trackingNumber: f.tracking_number,
      trackingUrl: f.tracking_url,
      createdAt: iso(f.shopify_created_at),
      updatedAt: iso(f.shopify_updated_at),
    })),
  };
}
