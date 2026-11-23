import type pg from "pg";
import type { RemoteOrderFulfillments } from "./types.js";

export type ReplaceResult =
  | { orderMissing: true }
  | { orderMissing: false; fulfillmentOrders: number; fulfillments: number; deletedFulfillmentOrders: number; deletedFulfillments: number };

export type FulfillmentsStore = {
  /** Database clock; take it before fetching from Shopify and pass it to replaceForOrder. */
  now(): Promise<Date>;
  /**
   * Upserts an order's fulfillment orders (+ lines) and fulfillments in one transaction.
   * Rows are only overwritten by equal-or-newer Shopify updated_at. Rows missing from
   * the fetch are deleted only if not written since `fetchStartedAt` (a newer concurrent
   * refresh may have added them). Fulfillments are pruned only when the list was complete.
   * Returns orderMissing when the order is not in Postgres yet.
   */
  replaceForOrder(data: RemoteOrderFulfillments, fetchStartedAt: Date): Promise<ReplaceResult>;
};

export function createFulfillmentsStore(pool: pg.Pool): FulfillmentsStore {
  return {
    async now() {
      const { rows } = await pool.query<{ now: Date }>("select now() as now");
      return rows[0].now;
    },

    async replaceForOrder(data, fetchStartedAt) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        // Lock the order row: refreshes of the same order run one at a time.
        const order = await client.query<{ id: string }>("select id from orders where shopify_id = $1 for update", [
          data.orderShopifyId,
        ]);
        if (!order.rows[0]) {
          await client.query("commit");
          return { orderMissing: true };
        }
        const orderId = Number(order.rows[0].id);

        let foApplied = 0;
        for (const fo of data.fulfillmentOrders) {
          const upserted = await client.query<{ id: string }>(
            `insert into fulfillment_orders (
               shopify_id, order_id, status, request_status, assigned_location_shopify_id, fulfill_at, shopify_updated_at, synced_at
             ) values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, now())
             on conflict (shopify_id) do update set
               order_id = excluded.order_id,
               status = excluded.status,
               request_status = excluded.request_status,
               assigned_location_shopify_id = excluded.assigned_location_shopify_id,
               fulfill_at = excluded.fulfill_at,
               shopify_updated_at = excluded.shopify_updated_at,
               synced_at = now()
             where fulfillment_orders.shopify_updated_at is null or excluded.shopify_updated_at is null
                or excluded.shopify_updated_at >= fulfillment_orders.shopify_updated_at
             returning id`,
            [fo.shopifyId, orderId, fo.status, fo.requestStatus, fo.assignedLocationShopifyId, fo.fulfillAt, fo.updatedAt],
          );
          // Skipped: a newer version is already stored — keep it and its lines.
          if (upserted.rowCount === 0) continue;
          foApplied++;
          const foId = Number(upserted.rows[0].id);

          for (const line of fo.lines) {
            await client.query(
              `insert into fulfillment_order_lines (
                 fulfillment_order_id, shopify_id, order_line_shopify_id, inventory_item_id, total_quantity, remaining_quantity, synced_at
               ) values ($1, $2, $3, $4, $5, $6, now())
               on conflict (shopify_id) do update set
                 fulfillment_order_id = excluded.fulfillment_order_id,
                 order_line_shopify_id = excluded.order_line_shopify_id,
                 inventory_item_id = excluded.inventory_item_id,
                 total_quantity = excluded.total_quantity,
                 remaining_quantity = excluded.remaining_quantity,
                 synced_at = now()`,
              [foId, line.shopifyId, line.orderLineShopifyId, line.inventoryItemId, line.totalQuantity, line.remainingQuantity],
            );
          }
          // All line pages were fetched, so lines not seen are gone in Shopify.
          await client.query(
            `delete from fulfillment_order_lines where fulfillment_order_id = $1 and not (shopify_id = any($2::text[]))`,
            [foId, fo.lines.map((l) => l.shopifyId)],
          );
        }

        const deletedFos = await client.query(
          `delete from fulfillment_orders
           where order_id = $1 and not (shopify_id = any($2::text[])) and synced_at < $3`,
          [orderId, data.fulfillmentOrders.map((f) => f.shopifyId), fetchStartedAt],
        );

        let fApplied = 0;
        for (const f of data.fulfillments) {
          const upserted = await client.query(
            `insert into fulfillments (
               shopify_id, order_id, status, tracking_company, tracking_number, tracking_url,
               shopify_created_at, shopify_updated_at, synced_at
             ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, now())
             on conflict (shopify_id) do update set
               order_id = excluded.order_id,
               status = excluded.status,
               tracking_company = excluded.tracking_company,
               tracking_number = excluded.tracking_number,
               tracking_url = excluded.tracking_url,
               shopify_created_at = excluded.shopify_created_at,
               shopify_updated_at = excluded.shopify_updated_at,
               synced_at = now()
             where fulfillments.shopify_updated_at is null or excluded.shopify_updated_at is null
                or excluded.shopify_updated_at >= fulfillments.shopify_updated_at
             returning id`,
            [f.shopifyId, orderId, f.status, f.trackingCompany, f.trackingNumber, f.trackingUrl, f.createdAt, f.updatedAt],
          );
          if ((upserted.rowCount ?? 0) > 0) fApplied++;
        }

        let deletedFulfillments = 0;
        if (data.fulfillmentsComplete) {
          const del = await client.query(
            `delete from fulfillments where order_id = $1 and not (shopify_id = any($2::text[])) and synced_at < $3`,
            [orderId, data.fulfillments.map((f) => f.shopifyId), fetchStartedAt],
          );
          deletedFulfillments = del.rowCount ?? 0;
        }

        await client.query("update orders set fulfillments_synced_at = now() where id = $1", [orderId]);
        await client.query("commit");
        return {
          orderMissing: false,
          fulfillmentOrders: foApplied,
          fulfillments: fApplied,
          deletedFulfillmentOrders: deletedFos.rowCount ?? 0,
          deletedFulfillments,
        };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
