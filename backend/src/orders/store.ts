import type pg from "pg";
import { shouldApply } from "../webhooks/ordering.js";
import type { RemoteOrder } from "./types.js";

export type UpsertOrderResult = { applied: boolean };

export type OrdersStore = {
  countOrders(): Promise<number>;
  /**
   * Upserts an order and its lines in one transaction when shouldApply allows.
   * Prunes lines for that order only after a complete lines list was provided.
   */
  upsertOrder(order: RemoteOrder): Promise<UpsertOrderResult>;
  /** Bumps last_full_sync_at only — never deletes orders outside the sync window. */
  finishFullSync(): Promise<void>;
  lastFullSyncAt(): Promise<Date | null>;
};

export function createOrdersStore(pool: pg.Pool): OrdersStore {
  return {
    async countOrders() {
      const { rows } = await pool.query<{ c: string }>("select count(*)::text as c from orders");
      return Number(rows[0]?.c ?? 0);
    },

    async upsertOrder(order) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const existing = await client.query<{ updated_at: Date | null }>(
          `select updated_at from orders where shopify_id = $1 for update`,
          [order.shopifyId],
        );
        const row = existing.rows[0];
        if (row && !shouldApply(row.updated_at, order.updatedAt)) {
          await client.query("commit");
          return { applied: false };
        }

        const upserted = await client.query<{ id: string }>(
          `insert into orders (
             shopify_id, name, created_at, updated_at, processed_at, cancelled_at, closed_at,
             currency, subtotal, total, tax, discount, financial_status, fulfillment_status,
             cancel_reason, source_name, test, synced_at
           ) values (
             $1, $2, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6::timestamptz, $7::timestamptz,
             $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now()
           )
           on conflict (shopify_id) do update set
             name = excluded.name,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             processed_at = excluded.processed_at,
             cancelled_at = excluded.cancelled_at,
             closed_at = excluded.closed_at,
             currency = excluded.currency,
             subtotal = excluded.subtotal,
             total = excluded.total,
             tax = excluded.tax,
             discount = excluded.discount,
             financial_status = excluded.financial_status,
             fulfillment_status = excluded.fulfillment_status,
             cancel_reason = excluded.cancel_reason,
             source_name = excluded.source_name,
             test = excluded.test,
             synced_at = now()
           returning id`,
          [
            order.shopifyId,
            order.name,
            order.createdAt,
            order.updatedAt,
            order.processedAt,
            order.cancelledAt,
            order.closedAt,
            order.currency,
            order.subtotal,
            order.total,
            order.tax,
            order.discount,
            order.financialStatus,
            order.fulfillmentStatus,
            order.cancelReason,
            order.sourceName,
            order.test,
          ],
        );
        const orderId = Number(upserted.rows[0].id);
        const seenLineIds: string[] = [];

        for (const line of order.lines) {
          seenLineIds.push(line.shopifyId);
          await client.query(
            `insert into order_lines (
               order_id, shopify_id, variant_id, product_id, inventory_item_id, sku, title,
               quantity, fulfillable_quantity, unit_price, discounted_total, synced_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
             on conflict (shopify_id) do update set
               order_id = excluded.order_id,
               variant_id = excluded.variant_id,
               product_id = excluded.product_id,
               inventory_item_id = excluded.inventory_item_id,
               sku = excluded.sku,
               title = excluded.title,
               quantity = excluded.quantity,
               fulfillable_quantity = excluded.fulfillable_quantity,
               unit_price = excluded.unit_price,
               discounted_total = excluded.discounted_total,
               synced_at = now()`,
            [
              orderId,
              line.shopifyId,
              line.variantId,
              line.productId,
              line.inventoryItemId,
              line.sku,
              line.title,
              line.quantity,
              line.fulfillableQuantity,
              line.unitPrice,
              line.discountedTotal,
            ],
          );
        }

        if (seenLineIds.length === 0) {
          await client.query(`delete from order_lines where order_id = $1`, [orderId]);
        } else {
          await client.query(
            `delete from order_lines where order_id = $1 and not (shopify_id = any($2::text[]))`,
            [orderId, seenLineIds],
          );
        }

        await client.query("commit");
        return { applied: true };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async finishFullSync() {
      await pool.query(
        `insert into orders_state (id, last_full_sync_at) values (1, now())
         on conflict (id) do update set last_full_sync_at = excluded.last_full_sync_at`,
      );
    },

    async lastFullSyncAt() {
      const { rows } = await pool.query<{ last_full_sync_at: Date | null }>(
        "select last_full_sync_at from orders_state where id = 1",
      );
      return rows[0]?.last_full_sync_at ?? null;
    },
  };
}
