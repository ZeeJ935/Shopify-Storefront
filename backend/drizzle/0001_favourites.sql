CREATE TABLE "favourites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourites_customer_product_unique" UNIQUE("customer_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "favourites_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favourites_customer_id_idx" ON "favourites" USING btree ("customer_id");