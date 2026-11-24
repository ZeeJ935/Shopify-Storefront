import type pg from "pg";
import type { WarehouseAdapter, WarehouseStock } from "./adapter.js";

export const MAX_WAREHOUSE_QUANTITY = 1_000_000;

type Row = { sku: string; location_shopify_id: string; quantity: number; updated_at: Date };
const map = (r: Row): WarehouseStock => ({ sku: r.sku, locationShopifyId: r.location_shopify_id, quantity: r.quantity, updatedAt: r.updated_at.toISOString() });

/** Mock warehouse backed by warehouse_stock (no real warehouse exists yet). */
export class MockWarehouse implements WarehouseAdapter {
  constructor(private readonly pool: pg.Pool) {}

  async getStock(sku: string) {
    const { rows } = await this.pool.query<Row>(
      "select sku, location_shopify_id, quantity, updated_at from warehouse_stock where sku = $1 order by location_shopify_id",
      [sku],
    );
    return rows.map(map);
  }

  async listStock() {
    const { rows } = await this.pool.query<Row>("select sku, location_shopify_id, quantity, updated_at from warehouse_stock order by sku, location_shopify_id");
    return rows.map(map);
  }

  /** Mock-only: set the warehouse quantity (admin API). */
  async setStock(input: { sku: string; locationShopifyId: string; quantity: number; staffId: number | null }): Promise<WarehouseStock> {
    if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > MAX_WAREHOUSE_QUANTITY) throw new Error("invalid quantity");
    const { rows } = await this.pool.query<Row>(
      `insert into warehouse_stock (sku, location_shopify_id, quantity, updated_by_staff_id, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (sku, location_shopify_id) do update set quantity = excluded.quantity,
         updated_by_staff_id = excluded.updated_by_staff_id, updated_at = now()
       returning sku, location_shopify_id, quantity, updated_at`,
      [input.sku, input.locationShopifyId, input.quantity, input.staffId],
    );
    return map(rows[0]);
  }
}
