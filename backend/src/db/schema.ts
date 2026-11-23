import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

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
 * Topics with a handler are processed by the queue. Payload: catalog topics keep
 * the body; inventory/location/order/fulfillment topics keep `{ id }` only; topics
 * without a handler keep null — so customer or order data is never stored by accident.
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
    /** X-Shopify-Triggered-At when Shopify sent it (nullable for older rows). */
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    /** X-Shopify-Api-Version on the delivery (nullable for older rows). */
    apiVersion: text("api_version"),
  },
  (t) => [
    index("webhook_events_pending_idx").on(t.processedAt, t.failedAt),
    // Retention purge and age-based health checks.
    index("webhook_events_received_at_idx").on(t.receivedAt),
  ],
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

/** Shopify inventory locations (Admin API). */
export const locations = pgTable("locations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  shopifyId: text("shopify_id").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  fulfillsOnlineOrders: boolean("fulfills_online_orders").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Inventory items (one per product variant). */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shopifyId: text("shopify_id").notNull().unique(),
    variantId: text("variant_id"),
    productId: text("product_id"),
    sku: text("sku"),
    tracked: boolean("tracked").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_items_sku_idx").on(t.sku)],
);

/** Quantities for one inventory item at one location. */
export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    inventoryItemId: bigint("inventory_item_id", { mode: "number" })
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    locationId: bigint("location_id", { mode: "number" })
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    available: integer("available").notNull().default(0),
    onHand: integer("on_hand").notNull().default(0),
    committed: integer("committed").notNull().default(0),
    incoming: integer("incoming").notNull().default(0),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A unique index (not a constraint) — that is what migration 0005 created.
    uniqueIndex("inventory_levels_item_location_unique").on(t.inventoryItemId, t.locationId),
    index("inventory_levels_location_idx").on(t.locationId),
    index("inventory_levels_item_idx").on(t.inventoryItemId),
  ],
);

/**
 * Audit of available-quantity changes. FKs SET NULL on delete so history survives;
 * shopify ids stay on the row for identification after the parent is gone.
 */
export const inventoryLevelHistory = pgTable(
  "inventory_level_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    inventoryItemId: bigint("inventory_item_id", { mode: "number" }).references(() => inventoryItems.id, {
      onDelete: "set null",
    }),
    locationId: bigint("location_id", { mode: "number" }).references(() => locations.id, { onDelete: "set null" }),
    itemShopifyId: text("item_shopify_id").notNull(),
    locationShopifyId: text("location_shopify_id").notNull(),
    availableBefore: integer("available_before").notNull(),
    availableAfter: integer("available_after").notNull(),
    source: text("source").notNull(),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Item detail: history for one item, newest first (plain DESC = NULLS FIRST).
    index("inventory_level_history_item_created_idx").on(t.itemShopifyId, t.createdAt.desc().nullsFirst()),
    index("inventory_level_history_created_idx").on(t.createdAt),
  ],
);

/** One row: when the last inventory full sync finished. */
export const inventoryState = pgTable("inventory_state", {
  id: integer("id").primaryKey().default(1),
  lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
});

/**
 * Shopify orders without personal data (no customer, email, phone, address, notes).
 * Money amounts are shop currency; currency code lives on the order row.
 */
export const orders = pgTable(
  "orders",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shopifyId: text("shopify_id").notNull().unique(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    currency: text("currency"),
    subtotal: numeric("subtotal"),
    total: numeric("total"),
    tax: numeric("tax"),
    discount: numeric("discount"),
    financialStatus: text("financial_status"),
    fulfillmentStatus: text("fulfillment_status"),
    cancelReason: text("cancel_reason"),
    sourceName: text("source_name"),
    test: boolean("test").notNull().default(false),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last time fulfillment orders + fulfillments were refreshed for this order; null = never. */
    fulfillmentsSyncedAt: timestamp("fulfillments_synced_at", { withTimezone: true }),
  },
  (t) => [
    index("orders_updated_at_idx").on(t.updatedAt),
    // Matches the list ORDER BY exactly (plain DESC = NULLS FIRST in Postgres).
    index("orders_created_at_shopify_id_idx").on(t.createdAt.desc().nullsLast(), t.shopifyId.desc().nullsFirst()),
    index("orders_financial_status_idx").on(t.financialStatus),
    index("orders_fulfillment_status_idx").on(t.fulfillmentStatus),
  ],
);

/** Line items for an order. Cascades when the order is deleted. */
export const orderLines = pgTable(
  "order_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    shopifyId: text("shopify_id").notNull().unique(),
    variantId: text("variant_id"),
    productId: text("product_id"),
    inventoryItemId: text("inventory_item_id"),
    sku: text("sku"),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull().default(0),
    fulfillableQuantity: integer("fulfillable_quantity").notNull().default(0),
    unitPrice: numeric("unit_price"),
    discountedTotal: numeric("discounted_total"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("order_lines_order_idx").on(t.orderId),
    index("order_lines_sku_idx").on(t.sku),
    // Fulfillment and stock lookups by variant / inventory item.
    index("order_lines_inventory_item_idx").on(t.inventoryItemId),
    index("order_lines_variant_idx").on(t.variantId),
  ],
);

/** One row: when the last orders full sync finished. */
export const ordersState = pgTable("orders_state", {
  id: integer("id").primaryKey().default(1),
  lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
});

/**
 * Shopify fulfillment orders (Admin API). No destination, delivery address or contact
 * fields are requested or stored — staff fetch those live from Shopify.
 */
export const fulfillmentOrders = pgTable(
  "fulfillment_orders",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shopifyId: text("shopify_id").notNull().unique(),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    requestStatus: text("request_status"),
    assignedLocationShopifyId: text("assigned_location_shopify_id"),
    fulfillAt: timestamp("fulfill_at", { withTimezone: true }),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fulfillment_orders_order_idx").on(t.orderId),
    index("fulfillment_orders_status_idx").on(t.status),
    index("fulfillment_orders_location_idx").on(t.assignedLocationShopifyId),
  ],
);

/** Lines of a fulfillment order. Cascades with the fulfillment order. */
export const fulfillmentOrderLines = pgTable(
  "fulfillment_order_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    fulfillmentOrderId: bigint("fulfillment_order_id", { mode: "number" })
      .notNull()
      .references(() => fulfillmentOrders.id, { onDelete: "cascade" }),
    shopifyId: text("shopify_id").notNull().unique(),
    /** order_lines.shopify_id (LineItem GID). */
    orderLineShopifyId: text("order_line_shopify_id"),
    inventoryItemId: text("inventory_item_id"),
    totalQuantity: integer("total_quantity").notNull().default(0),
    remainingQuantity: integer("remaining_quantity").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fulfillment_order_lines_fo_idx").on(t.fulfillmentOrderId),
    index("fulfillment_order_lines_order_line_idx").on(t.orderLineShopifyId),
  ],
);

/** Fulfillments (shipments) of an order, with the first tracking entry. Cascades with the order. */
export const fulfillments = pgTable(
  "fulfillments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shopifyId: text("shopify_id").notNull().unique(),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    trackingCompany: text("tracking_company"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shopifyCreatedAt: timestamp("shopify_created_at", { withTimezone: true }),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fulfillments_order_idx").on(t.orderId)],
);

/**
 * Fulfillment requests made through this API (POST /v1/fulfillments): one row per
 * idempotency key, so a retried request never fulfills twice. `request` holds lines,
 * tracking and notify flag only — never addresses or contact details.
 */
export const fulfillmentActions = pgTable(
  "fulfillment_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    kind: text("kind").notNull(),
    fulfillmentOrderShopifyId: text("fulfillment_order_shopify_id").notNull(),
    request: jsonb("request").notNull(),
    dryRun: boolean("dry_run").notNull().default(false),
    /** pending | submitting (Shopify call may have been sent) | succeeded | failed | dry_run */
    status: text("status").notNull(),
    shopifyFulfillmentId: text("shopify_fulfillment_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fulfillment_actions_status_idx").on(t.status),
    index("fulfillment_actions_fo_idx").on(t.fulfillmentOrderShopifyId),
  ],
);
