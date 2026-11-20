import { bigserial, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

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
