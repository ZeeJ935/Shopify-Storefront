CREATE TABLE "orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shopify_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"currency" text,
	"subtotal" numeric,
	"total" numeric,
	"tax" numeric,
	"discount" numeric,
	"financial_status" text,
	"fulfillment_status" text,
	"cancel_reason" text,
	"source_name" text,
	"test" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"shopify_id" text NOT NULL,
	"variant_id" text,
	"product_id" text,
	"inventory_item_id" text,
	"sku" text,
	"title" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"fulfillable_quantity" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric,
	"discounted_total" numeric,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
CREATE TABLE "orders_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_full_sync_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "orders_updated_at_idx" ON "orders" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "orders_financial_status_idx" ON "orders" USING btree ("financial_status");
--> statement-breakpoint
CREATE INDEX "orders_fulfillment_status_idx" ON "orders" USING btree ("fulfillment_status");
--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX "order_lines_sku_idx" ON "order_lines" USING btree ("sku");
