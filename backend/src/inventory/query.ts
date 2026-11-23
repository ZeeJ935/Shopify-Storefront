import type pg from "pg";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export class InvalidCursorError extends Error {
  constructor() {
    super("invalid_cursor");
    this.name = "InvalidCursorError";
  }
}

type Cursor = { locationId: string; itemId: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof parsed.locationId !== "string" || typeof parsed.itemId !== "string") throw new Error("bad");
    return parsed;
  } catch {
    throw new InvalidCursorError();
  }
}

export async function listLocations(pool: pg.Pool) {
  const { rows } = await pool.query<{
    shopify_id: string;
    name: string;
    active: boolean;
    fulfills_online_orders: boolean;
    updated_at: Date | null;
  }>(`select shopify_id, name, active, fulfills_online_orders, updated_at from locations order by name asc`);
  return {
    locations: rows.map((r) => ({
      id: r.shopify_id,
      name: r.name,
      active: r.active,
      fulfillsOnlineOrders: r.fulfills_online_orders,
      updatedAt: r.updated_at?.toISOString() ?? null,
    })),
  };
}

export async function listLevels(
  pool: pg.Pool,
  opts: { sku?: string | null; locationId?: string | null; lowStockBelow?: number | null; cursor?: string | null; limit: number },
) {
  const cursor = decodeCursor(opts.cursor ?? null);
  const params: unknown[] = [];
  const where: string[] = ["1=1"];

  if (opts.sku) {
    params.push(opts.sku);
    where.push(`ii.sku = $${params.length}`);
  }
  if (opts.locationId) {
    params.push(opts.locationId);
    where.push(`loc.shopify_id = $${params.length}`);
  }
  if (opts.lowStockBelow != null) {
    params.push(opts.lowStockBelow);
    where.push(`lvl.available < $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.locationId, cursor.itemId);
    where.push(`(loc.shopify_id, ii.shopify_id) > ($${params.length - 1}, $${params.length})`);
  }

  params.push(opts.limit + 1);
  const { rows } = await pool.query<{
    item_shopify_id: string;
    location_shopify_id: string;
    sku: string | null;
    available: number;
    on_hand: number;
    committed: number;
    incoming: number;
    shopify_updated_at: Date | null;
  }>(
    `select ii.shopify_id as item_shopify_id, loc.shopify_id as location_shopify_id, ii.sku,
            lvl.available, lvl.on_hand, lvl.committed, lvl.incoming, lvl.shopify_updated_at
     from inventory_levels lvl
     join inventory_items ii on ii.id = lvl.inventory_item_id
     join locations loc on loc.id = lvl.location_id
     where ${where.join(" and ")}
     order by loc.shopify_id asc, ii.shopify_id asc
     limit $${params.length}`,
    params,
  );

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = page[page.length - 1];
  return {
    levels: page.map((r) => ({
      inventoryItemId: r.item_shopify_id,
      locationId: r.location_shopify_id,
      sku: r.sku,
      available: r.available,
      onHand: r.on_hand,
      committed: r.committed,
      incoming: r.incoming,
      shopifyUpdatedAt: r.shopify_updated_at?.toISOString() ?? null,
    })),
    nextCursor: hasMore && last ? encodeCursor({ locationId: last.location_shopify_id, itemId: last.item_shopify_id }) : null,
  };
}

export async function getItemDetail(pool: pg.Pool, id: string) {
  const shopifyId = id.startsWith("gid://") ? id : `gid://shopify/InventoryItem/${id}`;
  const item = await pool.query<{
    shopify_id: string;
    variant_id: string | null;
    product_id: string | null;
    sku: string | null;
    tracked: boolean;
    updated_at: Date | null;
  }>(`select shopify_id, variant_id, product_id, sku, tracked, updated_at from inventory_items where shopify_id = $1`, [shopifyId]);
  if (!item.rows[0]) return null;
  const r = item.rows[0];

  const levels = await pool.query<{
    location_shopify_id: string;
    location_name: string;
    available: number;
    on_hand: number;
    committed: number;
    incoming: number;
    shopify_updated_at: Date | null;
  }>(
    `select loc.shopify_id as location_shopify_id, loc.name as location_name,
            lvl.available, lvl.on_hand, lvl.committed, lvl.incoming, lvl.shopify_updated_at
     from inventory_levels lvl
     join locations loc on loc.id = lvl.location_id
     join inventory_items ii on ii.id = lvl.inventory_item_id
     where ii.shopify_id = $1
     order by loc.name`,
    [shopifyId],
  );

  const history = await pool.query<{
    location_shopify_id: string;
    available_before: number;
    available_after: number;
    source: string;
    shopify_updated_at: Date | null;
    created_at: Date;
  }>(
    `select location_shopify_id, available_before, available_after, source, shopify_updated_at, created_at
     from inventory_level_history
     where item_shopify_id = $1
     order by created_at desc
     limit 20`,
    [shopifyId],
  );

  return {
    id: r.shopify_id,
    variantId: r.variant_id,
    productId: r.product_id,
    sku: r.sku,
    tracked: r.tracked,
    updatedAt: r.updated_at?.toISOString() ?? null,
    levels: levels.rows.map((l) => ({
      locationId: l.location_shopify_id,
      locationName: l.location_name,
      available: l.available,
      onHand: l.on_hand,
      committed: l.committed,
      incoming: l.incoming,
      shopifyUpdatedAt: l.shopify_updated_at?.toISOString() ?? null,
    })),
    history: history.rows.map((h) => ({
      locationId: h.location_shopify_id,
      availableBefore: h.available_before,
      availableAfter: h.available_after,
      source: h.source,
      shopifyUpdatedAt: h.shopify_updated_at?.toISOString() ?? null,
      createdAt: h.created_at.toISOString(),
    })),
  };
}
