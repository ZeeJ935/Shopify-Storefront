CREATE TABLE "locations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shopify_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"fulfills_online_orders" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shopify_id" text NOT NULL,
	"variant_id" text,
	"product_id" text,
	"sku" text,
	"tracked" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_shopify_id_unique" UNIQUE("shopify_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_levels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"inventory_item_id" bigint NOT NULL,
	"location_id" bigint NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"committed" integer DEFAULT 0 NOT NULL,
	"incoming" integer DEFAULT 0 NOT NULL,
	"shopify_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_level_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"inventory_item_id" bigint,
	"location_id" bigint,
	"item_shopify_id" text NOT NULL,
	"location_shopify_id" text NOT NULL,
	"available_before" integer NOT NULL,
	"available_after" integer NOT NULL,
	"source" text NOT NULL,
	"shopify_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_full_sync_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_level_history" ADD CONSTRAINT "inventory_level_history_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_level_history" ADD CONSTRAINT "inventory_level_history_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inventory_items_sku_idx" ON "inventory_items" USING btree ("sku");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_levels_item_location_unique" ON "inventory_levels" USING btree ("inventory_item_id","location_id");
--> statement-breakpoint
CREATE INDEX "inventory_levels_location_idx" ON "inventory_levels" USING btree ("location_id");
--> statement-breakpoint
CREATE INDEX "inventory_levels_item_idx" ON "inventory_levels" USING btree ("inventory_item_id");
--> statement-breakpoint
CREATE INDEX "inventory_level_history_item_idx" ON "inventory_level_history" USING btree ("item_shopify_id");
--> statement-breakpoint
CREATE INDEX "inventory_level_history_created_idx" ON "inventory_level_history" USING btree ("created_at");
