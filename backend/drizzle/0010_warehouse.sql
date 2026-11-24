CREATE TABLE "stock_push_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"push_id" bigint NOT NULL,
	"inventory_item_shopify_id" text NOT NULL,
	"location_shopify_id" text,
	"sku" text,
	"from_quantity" integer,
	"to_quantity" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"result" text NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_pushes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"request" jsonb NOT NULL,
	"dry_run" boolean NOT NULL,
	"status" text NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_by_staff_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "warehouse_pushes_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "warehouse_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_reconcile_at" timestamp with time zone,
	"differences" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_stock" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"location_shopify_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" bigint,
	CONSTRAINT "warehouse_stock_sku_location_unique" UNIQUE("sku","location_shopify_id")
);
--> statement-breakpoint
ALTER TABLE "stock_push_log" ADD CONSTRAINT "stock_push_log_push_id_warehouse_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."warehouse_pushes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_pushes" ADD CONSTRAINT "warehouse_pushes_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_updated_by_staff_id_staff_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_push_log_push_idx" ON "stock_push_log" USING btree ("push_id");--> statement-breakpoint
CREATE INDEX "stock_push_log_item_idx" ON "stock_push_log" USING btree ("inventory_item_shopify_id");--> statement-breakpoint
CREATE INDEX "stock_push_log_created_idx" ON "stock_push_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "warehouse_pushes_status_idx" ON "warehouse_pushes" USING btree ("status");