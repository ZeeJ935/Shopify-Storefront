CREATE TABLE "fulfillment_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"fulfillment_order_shopify_id" text NOT NULL,
	"request" jsonb NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"shopify_fulfillment_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_actions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "fulfillment_order_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fulfillment_order_id" bigint NOT NULL,
	"shopify_id" text NOT NULL,
	"order_line_shopify_id" text,
	"inventory_item_id" text,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"remaining_quantity" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_order_lines_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
CREATE TABLE "fulfillment_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shopify_id" text NOT NULL,
	"order_id" bigint NOT NULL,
	"status" text NOT NULL,
	"request_status" text,
	"assigned_location_shopify_id" text,
	"fulfill_at" timestamp with time zone,
	"shopify_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_orders_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shopify_id" text NOT NULL,
	"order_id" bigint NOT NULL,
	"status" text NOT NULL,
	"tracking_company" text,
	"tracking_number" text,
	"tracking_url" text,
	"shopify_created_at" timestamp with time zone,
	"shopify_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillments_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillments_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fulfillment_order_lines" ADD CONSTRAINT "fulfillment_order_lines_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fulfillment_actions_status_idx" ON "fulfillment_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fulfillment_actions_fo_idx" ON "fulfillment_actions" USING btree ("fulfillment_order_shopify_id");--> statement-breakpoint
CREATE INDEX "fulfillment_order_lines_fo_idx" ON "fulfillment_order_lines" USING btree ("fulfillment_order_id");--> statement-breakpoint
CREATE INDEX "fulfillment_order_lines_order_line_idx" ON "fulfillment_order_lines" USING btree ("order_line_shopify_id");--> statement-breakpoint
CREATE INDEX "fulfillment_orders_order_idx" ON "fulfillment_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fulfillment_orders_status_idx" ON "fulfillment_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fulfillment_orders_location_idx" ON "fulfillment_orders" USING btree ("assigned_location_shopify_id");--> statement-breakpoint
CREATE INDEX "fulfillments_order_idx" ON "fulfillments" USING btree ("order_id");