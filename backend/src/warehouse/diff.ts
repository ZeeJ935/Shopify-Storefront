import type pg from "pg";
import type { WarehouseAdapter, WarehouseStock } from "./adapter.js";

/** Mirror levels older than this are flagged (the reconcile job refreshes them). */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export type DiffStatus =
  | "match"
  | "differs"
  | "large_decrease"
  | "unknown_location"
  | "unknown_sku"
  | "ambiguous_sku"
  | "untracked"
  | "not_stocked";

/** Statuses a push may act on (large_decrease only with allow_large_decrease). */
export const PUSHABLE: ReadonlySet<DiffStatus> = new Set(["differs", "large_decrease"]);

export type DiffRow = {
  sku: string;
  locationShopifyId: string;
  locationName: string | null;
  inventoryItemShopifyId: string | null;
  warehouseQuantity: number;
  /** Shopify on_hand from our mirror (physical stock; what a push sets). */
  onHand: number | null;
  /** Read-only context for staff: what's sellable and what's committed to orders. */
  available: number | null;
  committed: number | null;
  /** warehouse − on_hand (null when not comparable). */
  difference: number | null;
  status: DiffStatus;
  stale: boolean;
  mirrorSyncedAt: string | null;
};

export type ShopifySide = {
  /** Shopify location GID → name. */
  locations: Map<string, string>;
  /** SKU → inventory items with that SKU. */
  itemsBySku: Map<string, { shopifyId: string; tracked: boolean }[]>;
  /** `${itemGid}|${locationGid}` → mirror level. */
  levels: Map<string, { onHand: number; available: number; committed: number; syncedAt: Date }>;
};

/** Pure: one warehouse row against the Shopify mirror. */
export function classify(stock: WarehouseStock, shopify: ShopifySide, opts: { maxDecrease: number; now: number }): DiffRow {
  const base = {
    sku: stock.sku,
    locationShopifyId: stock.locationShopifyId,
    locationName: shopify.locations.get(stock.locationShopifyId) ?? null,
    inventoryItemShopifyId: null as string | null,
    warehouseQuantity: stock.quantity,
    onHand: null as number | null,
    available: null as number | null,
    committed: null as number | null,
    difference: null as number | null,
    stale: false,
    mirrorSyncedAt: null as string | null,
  };
  if (!shopify.locations.has(stock.locationShopifyId)) return { ...base, status: "unknown_location" };
  const items = shopify.itemsBySku.get(stock.sku) ?? [];
  if (items.length === 0) return { ...base, status: "unknown_sku" };
  if (items.length > 1) return { ...base, status: "ambiguous_sku" }; // never guess
  const item = items[0];
  const withItem = { ...base, inventoryItemShopifyId: item.shopifyId };
  if (!item.tracked) return { ...withItem, status: "untracked" };
  const level = shopify.levels.get(`${item.shopifyId}|${stock.locationShopifyId}`);
  if (!level) return { ...withItem, status: "not_stocked" };
  const difference = stock.quantity - level.onHand;
  const status: DiffStatus = difference === 0 ? "match" : difference < -opts.maxDecrease ? "large_decrease" : "differs";
  return {
    ...withItem,
    onHand: level.onHand,
    available: level.available,
    committed: level.committed,
    difference,
    status,
    stale: opts.now - level.syncedAt.getTime() > STALE_AFTER_MS,
    mirrorSyncedAt: level.syncedAt.toISOString(),
  };
}

/** Loads the Shopify side for a set of warehouse rows from Postgres (the mirror). */
export async function loadShopifySide(pool: pg.Pool, stock: WarehouseStock[]): Promise<ShopifySide> {
  const skus = [...new Set(stock.map((s) => s.sku))];
  const [locs, items] = await Promise.all([
    pool.query<{ shopify_id: string; name: string }>("select shopify_id, name from locations"),
    pool.query<{ shopify_id: string; sku: string; tracked: boolean }>("select shopify_id, sku, tracked from inventory_items where sku = any($1::text[])", [skus]),
  ]);
  const itemsBySku = new Map<string, { shopifyId: string; tracked: boolean }[]>();
  for (const r of items.rows) itemsBySku.set(r.sku, [...(itemsBySku.get(r.sku) ?? []), { shopifyId: r.shopify_id, tracked: r.tracked }]);
  const levelRows = await pool.query<{ item: string; loc: string; on_hand: number; available: number; committed: number; synced_at: Date }>(
    `select ii.shopify_id as item, loc.shopify_id as loc, lvl.on_hand, lvl.available, lvl.committed, lvl.synced_at
     from inventory_levels lvl join inventory_items ii on ii.id = lvl.inventory_item_id join locations loc on loc.id = lvl.location_id
     where ii.sku = any($1::text[])`,
    [skus],
  );
  return {
    locations: new Map(locs.rows.map((l) => [l.shopify_id, l.name])),
    itemsBySku,
    levels: new Map(levelRows.rows.map((l) => [`${l.item}|${l.loc}`, { onHand: l.on_hand, available: l.available, committed: l.committed, syncedAt: l.synced_at }])),
  };
}

/** Warehouse vs Shopify (mirror) for every warehouse row. Pushes always re-read Shopify live. */
export async function warehouseDiff(adapter: WarehouseAdapter, pool: pg.Pool, opts: { maxDecrease: number; now?: number }): Promise<DiffRow[]> {
  const stock = await adapter.listStock();
  if (stock.length === 0) return [];
  const shopify = await loadShopifySide(pool, stock);
  const now = opts.now ?? Date.now();
  return stock.map((s) => classify(s, shopify, { maxDecrease: opts.maxDecrease, now }));
}
