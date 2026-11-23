import type pg from "pg";
import { shouldApply } from "../webhooks/ordering.js";
import type { RemoteInventoryItem, RemoteLevel, RemoteLocation } from "./types.js";

export type UpsertLevelResult = { applied: boolean; availableChanged: boolean };

export type InventoryStore = {
  countLocations(): Promise<number>;
  upsertLocation(loc: RemoteLocation): Promise<number>;
  /** Returns existing location id, or inserts a stub (does not overwrite a real name). */
  ensureLocationId(shopifyId: string): Promise<number>;
  /** Returns existing item id, or inserts a stub (does not overwrite real fields). */
  ensureItemId(shopifyId: string): Promise<number>;
  upsertItem(item: Omit<RemoteInventoryItem, "levels">): Promise<number>;
  /**
   * Upserts a level if shouldApply allows. Writes history when available changes.
   * Returns whether the row was applied and whether available changed.
   */
  upsertLevel(opts: {
    itemId: number;
    locationId: number;
    itemShopifyId: string;
    locationShopifyId: string;
    level: RemoteLevel;
    source: "webhook" | "sync";
  }): Promise<UpsertLevelResult>;
  deleteLocationByShopifyId(shopifyId: string): Promise<void>;
  /** After a complete sync: drop rows not seen; set last_full_sync_at. */
  finishFullSync(seen: { locationIds: Set<string>; itemIds: Set<string>; levelKeys: Set<string> }): Promise<{
    deletedLocations: number;
    deletedItems: number;
    deletedLevels: number;
  }>;
  lastFullSyncAt(): Promise<Date | null>;
};

function qty(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function createInventoryStore(pool: pg.Pool): InventoryStore {
  return {
    async countLocations() {
      const { rows } = await pool.query<{ c: string }>("select count(*)::text as c from locations");
      return Number(rows[0]?.c ?? 0);
    },

    async upsertLocation(loc) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into locations (shopify_id, name, active, fulfills_online_orders, updated_at, synced_at)
         values ($1, $2, $3, $4, $5::timestamptz, now())
         on conflict (shopify_id) do update set
           name = excluded.name,
           active = excluded.active,
           fulfills_online_orders = excluded.fulfills_online_orders,
           updated_at = excluded.updated_at,
           synced_at = now()
         returning id`,
        [loc.shopifyId, loc.name, loc.active, loc.fulfillsOnlineOrders, loc.updatedAt],
      );
      return Number(rows[0].id);
    },

    async ensureLocationId(shopifyId) {
      const existing = await pool.query<{ id: string }>("select id from locations where shopify_id = $1", [shopifyId]);
      if (existing.rows[0]) return Number(existing.rows[0].id);
      const { rows } = await pool.query<{ id: string }>(
        `insert into locations (shopify_id, name, active, fulfills_online_orders, synced_at)
         values ($1, $2, true, false, now())
         on conflict (shopify_id) do update set synced_at = locations.synced_at
         returning id`,
        [shopifyId, shopifyId],
      );
      return Number(rows[0].id);
    },

    async ensureItemId(shopifyId) {
      const existing = await pool.query<{ id: string }>("select id from inventory_items where shopify_id = $1", [shopifyId]);
      if (existing.rows[0]) return Number(existing.rows[0].id);
      const { rows } = await pool.query<{ id: string }>(
        `insert into inventory_items (shopify_id, tracked, synced_at)
         values ($1, true, now())
         on conflict (shopify_id) do update set synced_at = inventory_items.synced_at
         returning id`,
        [shopifyId],
      );
      return Number(rows[0].id);
    },

    async upsertItem(item) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into inventory_items (shopify_id, variant_id, product_id, sku, tracked, updated_at, synced_at)
         values ($1, $2, $3, $4, $5, $6::timestamptz, now())
         on conflict (shopify_id) do update set
           variant_id = excluded.variant_id,
           product_id = excluded.product_id,
           sku = excluded.sku,
           tracked = excluded.tracked,
           updated_at = excluded.updated_at,
           synced_at = now()
         returning id`,
        [item.shopifyId, item.variantId, item.productId, item.sku, item.tracked, item.updatedAt],
      );
      return Number(rows[0].id);
    },

    async upsertLevel({ itemId, locationId, itemShopifyId, locationShopifyId, level, source }) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const existing = await client.query<{
          available: number;
          shopify_updated_at: Date | null;
        }>(
          `select available, shopify_updated_at from inventory_levels
           where inventory_item_id = $1 and location_id = $2 for update`,
          [itemId, locationId],
        );
        const row = existing.rows[0];
        if (row && !shouldApply(row.shopify_updated_at, level.shopifyUpdatedAt)) {
          await client.query("commit");
          return { applied: false, availableChanged: false };
        }

        const available = qty(level.available);
        const before = row?.available ?? available;
        const availableChanged = !row || before !== available;

        await client.query(
          `insert into inventory_levels (
             inventory_item_id, location_id, available, on_hand, committed, incoming, shopify_updated_at, synced_at
           ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, now())
           on conflict (inventory_item_id, location_id) do update set
             available = excluded.available,
             on_hand = excluded.on_hand,
             committed = excluded.committed,
             incoming = excluded.incoming,
             shopify_updated_at = excluded.shopify_updated_at,
             synced_at = now()`,
          [itemId, locationId, available, qty(level.onHand), qty(level.committed), qty(level.incoming), level.shopifyUpdatedAt],
        );

        if (availableChanged && row) {
          await client.query(
            `insert into inventory_level_history (
               inventory_item_id, location_id, item_shopify_id, location_shopify_id,
               available_before, available_after, source, shopify_updated_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
            [itemId, locationId, itemShopifyId, locationShopifyId, before, available, source, level.shopifyUpdatedAt],
          );
        } else if (availableChanged && !row) {
          // First insert: only history if we treat create as a change from "unknown".
          // Spec: history only when quantity actually changes — skip brand-new rows.
        }

        await client.query("commit");
        return { applied: true, availableChanged: Boolean(row) && availableChanged };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async deleteLocationByShopifyId(shopifyId) {
      await pool.query("delete from locations where shopify_id = $1", [shopifyId]);
    },

    async finishFullSync(seen) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        // Levels not seen
        const levels = await client.query(
          `delete from inventory_levels lvl
           using inventory_items ii, locations loc
           where lvl.inventory_item_id = ii.id and lvl.location_id = loc.id
             and not (ii.shopify_id || '|' || loc.shopify_id = any($1::text[]))`,
          [[...seen.levelKeys]],
        );
        const items = await client.query(`delete from inventory_items where not (shopify_id = any($1::text[]))`, [[...seen.itemIds]]);
        const locs = await client.query(`delete from locations where not (shopify_id = any($1::text[]))`, [[...seen.locationIds]]);
        await client.query(
          `insert into inventory_state (id, last_full_sync_at) values (1, now())
           on conflict (id) do update set last_full_sync_at = excluded.last_full_sync_at`,
        );
        await client.query("commit");
        return {
          deletedLocations: locs.rowCount ?? 0,
          deletedItems: items.rowCount ?? 0,
          deletedLevels: levels.rowCount ?? 0,
        };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async lastFullSyncAt() {
      const { rows } = await pool.query<{ last_full_sync_at: Date | null }>(
        "select last_full_sync_at from inventory_state where id = 1",
      );
      return rows[0]?.last_full_sync_at ?? null;
    },
  };
}

export function levelKey(itemShopifyId: string, locationShopifyId: string): string {
  return `${itemShopifyId}|${locationShopifyId}`;
}
