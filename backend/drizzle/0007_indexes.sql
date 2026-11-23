DROP INDEX "inventory_level_history_item_idx";--> statement-breakpoint
DROP INDEX "orders_created_at_idx";--> statement-breakpoint
CREATE INDEX "inventory_level_history_item_created_idx" ON "inventory_level_history" USING btree ("item_shopify_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "order_lines_inventory_item_idx" ON "order_lines" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "order_lines_variant_idx" ON "order_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "orders_created_at_shopify_id_idx" ON "orders" USING btree ("created_at" DESC NULLS LAST,"shopify_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events" USING btree ("received_at");