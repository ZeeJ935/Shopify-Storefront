import type pg from "pg";

/** "Low stock" on the dashboard: available above 0 and at or below this. */
export const LOW_STOCK_AT = 5;

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

/** Dashboard counts in one round trip. No customer data. */
export async function adminSummary(pool: pg.Pool): Promise<AdminSummary> {
  const { rows } = await pool.query<Record<string, string>>(
    `select
       (select count(*) from orders where cancelled_at is null and closed_at is null
          and fulfillment_status in ('UNFULFILLED', 'PARTIALLY_FULFILLED')) as unfulfilled,
       (select count(*) from fulfillment_orders where status in ('OPEN', 'IN_PROGRESS')) as open_fos,
       (select count(*) from orders where created_at > now() - interval '7 days') as orders_7d,
       (select count(*) from inventory_levels where available > 0 and available <= $1) as low,
       (select count(*) from inventory_levels where available <= 0) as out_of_stock,
       (select count(*) from fulfillment_actions where status in ('pending', 'submitting')) as pending,
       (select count(*) from fulfillment_actions where status = 'failed' and updated_at > now() - interval '7 days') as failed`,
    [LOW_STOCK_AT],
  );
  const r = rows[0];
  return {
    unfulfilledOrders: Number(r.unfulfilled),
    openFulfillmentOrders: Number(r.open_fos),
    ordersLast7Days: Number(r.orders_7d),
    lowStockLevels: Number(r.low),
    outOfStockLevels: Number(r.out_of_stock),
    pendingFulfillments: Number(r.pending),
    failedFulfillments7Days: Number(r.failed),
    lowStockAt: LOW_STOCK_AT,
  };
}

export type SearchResults = {
  /** Set when the query is exactly one order's number (e.g. "#1007" or "1007"). */
  exactOrderId: string | null;
  orders: { id: string; name: string; createdAt: string | null; financialStatus: string | null; fulfillmentStatus: string | null }[];
  skus: { sku: string; inventoryItemId: string; locations: number; available: number }[];
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Staff search: order numbers (prefix or contains) and SKUs (prefix). Never searches
 * customer data — there is none.
 */
export async function adminSearch(pool: pg.Pool, raw: string): Promise<SearchResults> {
  const q = raw.trim().slice(0, 100);
  if (!q) return { exactOrderId: null, orders: [], skus: [] };
  const name = q.startsWith("#") ? q : `#${q}`;
  const like = `%${escapeLike(q.replace(/^#/, ""))}%`;
  const [orders, skus] = await Promise.all([
    pool.query<{ shopify_id: string; name: string; created_at: Date | null; financial_status: string | null; fulfillment_status: string | null }>(
      `select shopify_id, name, created_at, financial_status, fulfillment_status from orders
       where lower(name) = lower($1) or name ilike $2
       order by (lower(name) = lower($1)) desc, created_at desc nulls last limit 10`,
      [name, like],
    ),
    pool.query<{ sku: string; shopify_id: string; locations: string; available: string }>(
      `select ii.sku, ii.shopify_id, count(lvl.id)::text as locations, coalesce(sum(lvl.available), 0)::text as available
       from inventory_items ii left join inventory_levels lvl on lvl.inventory_item_id = ii.id
       where ii.sku ilike $1
       group by ii.id order by ii.sku limit 20`,
      [`${escapeLike(q)}%`],
    ),
  ]);
  const exact = orders.rows.find((o) => o.name.toLowerCase() === name.toLowerCase());
  return {
    exactOrderId: exact?.shopify_id ?? null,
    orders: orders.rows.map((o) => ({
      id: o.shopify_id,
      name: o.name,
      createdAt: o.created_at ? o.created_at.toISOString() : null,
      financialStatus: o.financial_status,
      fulfillmentStatus: o.fulfillment_status,
    })),
    skus: skus.rows.map((s) => ({ sku: s.sku, inventoryItemId: s.shopify_id, locations: Number(s.locations), available: Number(s.available) })),
  };
}
