import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * One row per Shopify customer the storefront has sent us.
 * `customer_id` is the ID token's `sub` (Shopify's numeric customer ID, as text).
 */
export const customers = pgTable("customers", {
  customerId: text("customer_id").primaryKey(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * When this customer's favourites became owned by Postgres: after the one-time
   * import from the Shopify metafield, or the first save. Null = never imported.
   * Separates "no favourites" from "not imported yet".
   */
  favouritesImportedAt: timestamp("favourites_imported_at", { withTimezone: true }),
});

/** A customer's favourite products, in the order they were added (created_at, id). */
export const favourites = pgTable(
  "favourites",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.customerId, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("favourites_customer_product_unique").on(t.customerId, t.productId),
    index("favourites_customer_id_idx").on(t.customerId),
  ],
);

/**
 * Every Shopify webhook we accepted (valid signature), once per webhook ID.
 * Catalog topics are processed by the queue; other topics are only recorded,
 * without their payload, so customer or order data is never stored by accident.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    webhookId: text("webhook_id").notNull().unique(),
    topic: text("topic").notNull(),
    shopDomain: text("shop_domain").notNull(),
    payload: jsonb("payload"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** Set when the last allowed attempt failed; last_error keeps why. */
    failedAt: timestamp("failed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("webhook_events_pending_idx").on(t.processedAt, t.failedAt)],
);

/**
 * The product catalog, synced from the Storefront API (webhooks + nightly full sync).
 * `data` is the normalized ProductListItem the storefront renders; the other
 * columns are what the catalog filters and sorts on (keys are lower-cased and trimmed).
 */
export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull().unique(),
    title: text("title").notNull(),
    vendor: text("vendor").notNull(),
    productType: text("product_type").notNull(),
    tags: text("tags").array().notNull(),
    available: boolean("available").notNull(),
    minPrice: numeric("min_price").notNull(),
    maxPrice: numeric("max_price").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    data: jsonb("data").notNull(),
    // Derived for filters, facets and sorting (see src/catalog/derive.ts).
    vendorKey: text("vendor_key").notNull(),
    typeKey: text("type_key").notNull(),
    genderTags: text("gender_tags").array().notNull(),
    genderKeys: text("gender_keys").array().notNull(),
    sizes: text("sizes").array().notNull(),
    sizeKeys: text("size_keys").array().notNull(),
    color: text("color"),
    colorKey: text("color_key"),
    onSale: boolean("on_sale").notNull(),
    /** Index in Shopify's catalog order; breaks ties the way the old in-memory sort did. */
    catalogPosition: integer("catalog_position").notNull(),
    /** Position in Shopify's best-selling order; null when not ranked. */
    bestSellingRank: integer("best_selling_rank"),
    /** Name-sort group: equal titles (ignoring case and accents) share a group. */
    titleGroup: integer("title_group").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_vendor_key_idx").on(t.vendorKey),
    index("products_type_key_idx").on(t.typeKey),
    index("products_color_key_idx").on(t.colorKey),
    index("products_min_price_idx").on(t.minPrice),
    index("products_created_at_idx").on(t.createdAt),
    index("products_catalog_position_idx").on(t.catalogPosition),
    index("products_best_selling_idx").on(t.bestSellingRank),
    index("products_title_group_idx").on(t.titleGroup),
    index("products_available_idx").on(t.available),
    index("products_on_sale_idx").on(t.onSale),
    index("products_tags_gin").using("gin", t.tags),
    index("products_gender_keys_gin").using("gin", t.genderKeys),
    index("products_size_keys_gin").using("gin", t.sizeKeys),
    index("products_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

/** Membership and order of the collections the storefront browses. */
export const productCollections = pgTable(
  "product_collections",
  {
    collectionHandle: text("collection_handle").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionHandle, t.productId] }), index("product_collections_product_idx").on(t.productId)],
);

/** One row: when the last full sync finished, and whether a best-selling order exists. */
export const catalogState = pgTable("catalog_state", {
  id: integer("id").primaryKey().default(1),
  lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
  bestSellingCount: integer("best_selling_count").notNull().default(0),
});
