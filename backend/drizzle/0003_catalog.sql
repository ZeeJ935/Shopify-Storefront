-- Trigram index for title search (pg_trgm is a trusted extension: the database owner can create it).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "catalog_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_full_sync_at" timestamp with time zone,
	"best_selling_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_collections" (
	"collection_handle" text NOT NULL,
	"product_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "product_collections_collection_handle_product_id_pk" PRIMARY KEY("collection_handle","product_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"vendor" text NOT NULL,
	"product_type" text NOT NULL,
	"tags" text[] NOT NULL,
	"available" boolean NOT NULL,
	"min_price" numeric NOT NULL,
	"max_price" numeric NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"vendor_key" text NOT NULL,
	"type_key" text NOT NULL,
	"gender_tags" text[] NOT NULL,
	"gender_keys" text[] NOT NULL,
	"sizes" text[] NOT NULL,
	"size_keys" text[] NOT NULL,
	"color" text,
	"color_key" text,
	"on_sale" boolean NOT NULL,
	"catalog_position" integer NOT NULL,
	"best_selling_rank" integer,
	"title_group" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_collections_product_idx" ON "product_collections" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_vendor_key_idx" ON "products" USING btree ("vendor_key");--> statement-breakpoint
CREATE INDEX "products_type_key_idx" ON "products" USING btree ("type_key");--> statement-breakpoint
CREATE INDEX "products_color_key_idx" ON "products" USING btree ("color_key");--> statement-breakpoint
CREATE INDEX "products_min_price_idx" ON "products" USING btree ("min_price");--> statement-breakpoint
CREATE INDEX "products_created_at_idx" ON "products" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "products_catalog_position_idx" ON "products" USING btree ("catalog_position");--> statement-breakpoint
CREATE INDEX "products_best_selling_idx" ON "products" USING btree ("best_selling_rank");--> statement-breakpoint
CREATE INDEX "products_title_group_idx" ON "products" USING btree ("title_group");--> statement-breakpoint
CREATE INDEX "products_available_idx" ON "products" USING btree ("available");--> statement-breakpoint
CREATE INDEX "products_on_sale_idx" ON "products" USING btree ("on_sale");--> statement-breakpoint
CREATE INDEX "products_tags_gin" ON "products" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "products_gender_keys_gin" ON "products" USING gin ("gender_keys");--> statement-breakpoint
CREATE INDEX "products_size_keys_gin" ON "products" USING gin ("size_keys");--> statement-breakpoint
CREATE INDEX "products_title_trgm" ON "products" USING gin ("title" gin_trgm_ops);